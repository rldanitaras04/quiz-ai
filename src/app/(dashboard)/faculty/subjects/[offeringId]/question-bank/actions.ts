'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isFacultyOfOffering, isFacultyOfSubject } from '@/lib/auth';
import { recordAuditLog } from '@/lib/audit';
import type { QuestionType, Difficulty, BloomLevel, QuestionBankItem } from '@/lib/types';
import { parseExamText, type ParsedExamItem } from '@/lib/import/exam-parse';
import { extractFromDOCX, extractFromPDF, extractFromTXT } from '@/lib/ai/text-extraction';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

async function resolveSubjectId(supabase: Awaited<ReturnType<typeof createClient>>, offeringId: string): Promise<string> {
  const { data, error } = await supabase
    .from('subject_offerings')
    .select('subject_id')
    .eq('id', offeringId)
    .single();
  if (error || !data) throw new Error('Subject offering not found');
  return data.subject_id as string;
}

export interface QuestionBankFilters {
  topicId?: string | null;
  questionType?: QuestionType;
  difficulty?: Difficulty;
  bloomLevel?: BloomLevel;
  search?: string;
  topicIds?: string[];
}

export async function getQuestionBank(
  offeringId: string,
  filters: QuestionBankFilters = {}
): Promise<QuestionBankItem[]> {
  const { supabase, userId } = await requireUser();
  const subjectId = await resolveSubjectId(supabase, offeringId);
  const authorized =
    (await isFacultyOfOffering(supabase, userId, offeringId)) ||
    (await isFacultyOfSubject(supabase, userId, subjectId));
  if (!authorized) {
    throw new Error('Not authorized for this offering');
  }

  let query = supabase
    .from('question_bank')
    .select(`
      id, subject_id, topic_id, question_type, question_text, difficulty, bloom_level, points, image_url, image_storage_path, source_question_id, source_metadata, created_by, status, usage_count, last_used_at, created_at, updated_at,
      topic:topics(id, title, description),
      question_bank_choices(id, bank_question_id, choice_key, choice_text, position),
      question_bank_answer_keys(id, bank_question_id, correct_choice_id, canonical_answer, accepted_answers)
    `)
    .eq('subject_id', subjectId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (filters.topicId) query = query.eq('topic_id', filters.topicId);
  if (filters.topicIds && filters.topicIds.length > 0) query = query.in('topic_id', filters.topicIds);
  if (filters.questionType) query = query.eq('question_type', filters.questionType);
  if (filters.difficulty) query = query.eq('difficulty', filters.difficulty);
  if (filters.bloomLevel) query = query.eq('bloom_level', filters.bloomLevel);
  if (filters.search?.trim()) query = query.ilike('question_text', `%${filters.search.trim()}%`);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  return (data ?? []).map((row: any) => ({
    id: row.id,
    subject_id: row.subject_id,
    topic_id: row.topic_id,
    topic: row.topic,
    question_type: row.question_type,
    question_text: row.question_text,
    difficulty: row.difficulty,
    bloom_level: row.bloom_level,
    points: row.points,
    image_url: row.image_url,
    image_storage_path: row.image_storage_path,
    source_question_id: row.source_question_id,
    source_metadata: row.source_metadata,
    created_by: row.created_by,
    status: row.status,
    usage_count: row.usage_count,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    question_bank_choices: row.question_bank_choices ?? [],
    choices: (row.question_bank_choices ?? []).slice().sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)),
    question_bank_answer_keys: Array.isArray(row.question_bank_answer_keys) ? row.question_bank_answer_keys[0] ?? null : row.question_bank_answer_keys ?? null,
    correct_choice_id: (Array.isArray(row.question_bank_answer_keys) ? row.question_bank_answer_keys[0]?.correct_choice_id : row.question_bank_answer_keys?.correct_choice_id) ?? null,
    canonical_answer: (Array.isArray(row.question_bank_answer_keys) ? row.question_bank_answer_keys[0]?.canonical_answer : row.question_bank_answer_keys?.canonical_answer) ?? null,
  })) as unknown as QuestionBankItem[];
}

export async function getQuestionBankStats(
  offeringId: string
): Promise<{ total: number; byTopic: Record<string, number>; byType: Record<string, number> }> {
  const items = await getQuestionBank(offeringId);
  const byTopic: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const item of items) {
    const t = item.topic_id ?? '__uncategorized';
    byTopic[t] = (byTopic[t] ?? 0) + 1;
    byType[item.question_type] = (byType[item.question_type] ?? 0) + 1;
  }
  return { total: items.length, byTopic, byType };
}

export async function createBankItem(
  offeringId: string,
  data: {
    topic_id?: string | null;
    question_type: QuestionType;
    question_text: string;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number;
    image_url?: string | null;
    image_storage_path?: string | null;
    choices?: { choice_key: string; choice_text: string }[];
    correct_choice_key?: string;
    canonical_answer?: string;
    accepted_answers?: string[];
  }
): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  const subjectId = await resolveSubjectId(supabase, offeringId);
  const authorized =
    (await isFacultyOfOffering(supabase, userId, offeringId)) ||
    (await isFacultyOfSubject(supabase, userId, subjectId));
  if (!authorized) {
    throw new Error('Not authorized for this offering');
  }
  const text = data.question_text?.trim();
  if (!text) throw new Error('Question text is required');
  if (data.topic_id) {
    const { data: topic } = await supabase.from('topics').select('id, subject_id').eq('id', data.topic_id).single();
    if (!topic || topic.subject_id !== subjectId) throw new Error('Invalid topic for this subject');
  }

  const { data: inserted, error } = await supabase
    .from('question_bank')
    .insert({
      subject_id: subjectId,
      topic_id: data.topic_id ?? null,
      question_type: data.question_type,
      question_text: text,
      difficulty: data.difficulty,
      bloom_level: data.bloom_level,
      points: data.points,
      image_url: data.image_url ?? null,
      image_storage_path: data.image_storage_path ?? null,
      created_by: userId,
      status: 'active',
    })
    .select('id')
    .single();
  if (error || !inserted) throw new Error(error?.message ?? 'Failed to create bank item');

  if (data.choices && data.choices.length > 0) {
    const { data: choices, error: cErr } = await supabase
      .from('question_bank_choices')
      .insert(
        data.choices.map((c, idx) => ({
          bank_question_id: inserted.id,
          choice_key: c.choice_key,
          choice_text: c.choice_text,
          position: idx,
        }))
      )
      .select('id, choice_key');
    if (cErr) throw new Error(cErr.message);

    if (data.correct_choice_key && choices) {
      const correct = choices.find(c => c.choice_key === data.correct_choice_key);
      if (correct) {
        await supabase.from('question_bank_answer_keys').insert({
          bank_question_id: inserted.id,
          correct_choice_id: correct.id,
          updated_by: userId,
        });
      }
    }
  } else if (data.question_type === 'true_false') {
    const defaults = [
      { bank_question_id: inserted.id, choice_key: 'T', choice_text: 'True', position: 0 },
      { bank_question_id: inserted.id, choice_key: 'F', choice_text: 'False', position: 1 },
    ];
    const { data: choices, error: cErr } = await supabase
      .from('question_bank_choices')
      .insert(defaults)
      .select('id, choice_key');
    if (cErr) throw new Error(cErr.message);
    const correctKey = data.correct_choice_key || 'T';
    const correct = choices?.find(c => c.choice_key === correctKey);
    if (correct) {
      await supabase.from('question_bank_answer_keys').insert({
        bank_question_id: inserted.id,
        correct_choice_id: correct.id,
        updated_by: userId,
      });
    }
  }

  if (data.question_type === 'identification' && data.canonical_answer) {
    await supabase.from('question_bank_answer_keys').insert({
      bank_question_id: inserted.id,
      canonical_answer: data.canonical_answer.trim(),
      accepted_answers: data.accepted_answers ?? [],
      updated_by: userId,
    });
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'question_bank',
    entityId: inserted.id,
    metadata: { subject_id: subjectId, topic_id: data.topic_id },
  });
  return { id: inserted.id };
}

/**
 * Extract text from an uploaded ready-made exam (.docx / .txt / .md / .csv / .pdf).
 * Parsing to items happens client-side (or via previewExamImport) so faculty can
 * review before anything is written to the bank.
 */
export async function extractExamFile(
  fileName: string,
  fileBytes: ArrayBuffer
): Promise<{ text: string }> {
  await requireUser();
  const lower = fileName.toLowerCase();
  const buf = Buffer.from(fileBytes);
  let text: string;
  if (lower.endsWith('.docx')) {
    text = await extractFromDOCX(buf);
  } else if (lower.endsWith('.pdf')) {
    text = await extractFromPDF(buf);
  } else if (lower.endsWith('.csv') || lower.endsWith('.txt') || lower.endsWith('.md')) {
    text = await extractFromTXT(buf);
  } else {
    throw new Error('Unsupported file type. Use .docx, .pdf, .txt, .md, or .csv');
  }
  if (!text.trim()) throw new Error('Could not extract text from that file');
  return { text };
}

/** Server-side parse for paste preview (same parser as the client). */
export async function previewExamImport(text: string): Promise<{
  items: ParsedExamItem[];
  errors: string[];
}> {
  await requireUser();
  return parseExamText(text);
}


/**
 * Insert a parsed ready-made exam into the question bank for this subject.
 * Authorization + topic checks match `createBankItem`.
 */
export async function importExamToBank(
  offeringId: string,
  items: ParsedExamItem[],
  options: { topic_id?: string | null; source_filename?: string } = {}
): Promise<{ imported: number; errors: string[] }> {
  const { supabase, userId } = await requireUser();
  const subjectId = await resolveSubjectId(supabase, offeringId);
  const authorized =
    (await isFacultyOfOffering(supabase, userId, offeringId)) ||
    (await isFacultyOfSubject(supabase, userId, subjectId));
  if (!authorized) throw new Error('Not authorized for this offering');

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No questions to import');
  }
  if (items.length > 200) {
    throw new Error('Import is limited to 200 questions at a time');
  }

  const topicId = options.topic_id || null;
  if (topicId) {
    const { data: topic } = await supabase
      .from('topics')
      .select('id, subject_id')
      .eq('id', topicId)
      .single();
    if (!topic || topic.subject_id !== subjectId) {
      throw new Error('Invalid topic for this subject');
    }
  }

  const errors: string[] = [];
  let imported = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const text = item.question_text?.trim();
    if (!text) {
      errors.push(`Item ${i + 1}: missing question text.`);
      continue;
    }

    try {
      const created = await createBankItem(offeringId, {
        topic_id: topicId,
        question_type: item.question_type,
        question_text: text,
        difficulty: item.difficulty || 'moderate',
        bloom_level: item.bloom_level || 'understand',
        points: item.points || 1,
        choices: item.choices,
        correct_choice_key: item.correct_choice_key,
        canonical_answer: item.canonical_answer,
      });

      // Provenance for the import (file / paste).
      if (options.source_filename || options.topic_id === undefined) {
        await supabase
          .from('question_bank')
          .update({
            source_metadata: {
              imported_from: 'exam_import',
              original_filename: options.source_filename ?? null,
              imported_at: new Date().toISOString(),
              import_index: i,
            },
          })
          .eq('id', created.id);
      }
      imported += 1;
    } catch (e) {
      errors.push(`Item ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  revalidatePath(`/faculty/subjects/${offeringId}/question-bank`);
  revalidatePath('/faculty/subjects');

  if (imported === 0) {
    throw new Error(errors[0] ?? 'No questions were imported');
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'question_bank',
    entityId: `import-${imported}`,
    metadata: {
      subject_id: subjectId,
      topic_id: topicId,
      imported_count: imported,
      source_filename: options.source_filename ?? null,
    },
  });

  return { imported, errors };
}

export async function deleteBankItem(bankItemId: string) {
  const { supabase, userId } = await requireUser();
  const { data: existing } = await supabase.from('question_bank').select('id').eq('id', bankItemId).single();
  if (!existing) throw new Error('Bank item not found');
  const { error } = await supabase.from('question_bank').delete().eq('id', bankItemId);
  if (error) throw new Error(error.message);
  await recordAuditLog({ actorUserId: userId, action: 'delete', entityType: 'question_bank', entityId: bankItemId, metadata: {} });
  return { success: true };
}

/**
 * Record that bank items were used (wizard import): bumps `usage_count` and
 * `last_used_at`. Best-effort stats — callers may swallow failures.
 * Ownership is verified against the offering's subject before the admin client
 * (explicit authz, then elevated write — see createAdminClient contract).
 */
export async function touchBankItems(
  offeringId: string,
  bankIds: string[]
): Promise<{ count: number }> {
  if (!bankIds || bankIds.length === 0) return { count: 0 };
  const { supabase, userId } = await requireUser();
  const subjectId = await resolveSubjectId(supabase, offeringId);
  const authorized =
    (await isFacultyOfOffering(supabase, userId, offeringId)) ||
    (await isFacultyOfSubject(supabase, userId, subjectId));
  if (!authorized) {
    throw new Error('Not authorized for this offering');
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from('question_bank')
    .select('id, usage_count')
    .eq('subject_id', subjectId)
    .in('id', bankIds);
  if (!rows || rows.length === 0) return { count: 0 };

  const now = new Date().toISOString();
  let count = 0;
  for (const row of rows) {
    const { error } = await admin
      .from('question_bank')
      .update({ usage_count: (row.usage_count ?? 0) + 1, last_used_at: now })
      .eq('id', row.id);
    if (!error) count++;
  }
  return { count };
}

export async function saveAssessmentQuestionToBank(
  questionId: string
): Promise<{ id: string }> {
  const { supabase, userId } = await requireUser();
  // Resolve question → version → assessment → subject
  const { data: q } = await supabase
    .from('questions')
    .select('id, assessment_version_id, question_type, question_text, difficulty, bloom_level, points, topic_id, image_url, image_storage_path, question_choices(id, choice_key, choice_text, position), answer_keys:answer_keys(correct_choice_id, canonical_answer, accepted_answers)')
    .eq('id', questionId)
    .single();
  if (!q) throw new Error('Question not found');

  const { data: ver } = await supabase
    .from('assessment_versions')
    .select('assessment_id')
    .eq('id', q.assessment_version_id)
    .single();
  if (!ver) throw new Error('Version not found');

  const { data: assess } = await supabase
    .from('assessments')
    .select('subject_offering_id')
    .eq('id', ver.assessment_id)
    .single();
  if (!assess) throw new Error('Assessment not found');

  // Subject lives on the offering (assessments table has no subject_id).
  let subjectId: string | null = null;
  if (assess.subject_offering_id) {
    const { data: off } = await supabase
      .from('subject_offerings')
      .select('subject_id')
      .eq('id', assess.subject_offering_id)
      .single();
    subjectId = off?.subject_id ?? null;
  }
  if (!subjectId) throw new Error('Cannot determine subject for bank save');

  // Check faculty permission: offering-scoped or any section of the subject
  // (sibling sections share the bank and subject-level assessments).
  if (assess.subject_offering_id) {
    const authorized =
      (await isFacultyOfOffering(supabase, userId, assess.subject_offering_id)) ||
      (subjectId && (await isFacultyOfSubject(supabase, userId, subjectId)));
    if (!authorized) {
      throw new Error('Not authorized');
    }
  }

  const answerKey = Array.isArray((q as any).answer_keys) ? (q as any).answer_keys[0] : (q as any).answer_keys;
  const choices = (q as any).question_choices as Array<{ id: string; choice_key: string; choice_text: string; position: number }>;

  const { data: inserted, error } = await supabase
    .from('question_bank')
    .insert({
      subject_id: subjectId,
      topic_id: (q as any).topic_id ?? null,
      question_type: q.question_type,
      question_text: q.question_text,
      difficulty: q.difficulty,
      bloom_level: q.bloom_level,
      points: q.points,
      image_url: (q as any).image_url ?? null,
      image_storage_path: (q as any).image_storage_path ?? null,
      source_question_id: q.id,
      source_metadata: { copied_from_assessment: ver.assessment_id },
      created_by: userId,
      status: 'active',
    })
    .select('id')
    .single();
  if (error || !inserted) throw new Error(error?.message ?? 'Failed to save to bank');

  if ((q.question_type === 'multiple_choice' || q.question_type === 'true_false') && choices?.length) {
    const { data: bankChoices, error: cErr } = await supabase
      .from('question_bank_choices')
      .insert(choices.map((c, idx) => ({
        bank_question_id: inserted.id,
        choice_key: c.choice_key,
        choice_text: c.choice_text,
        position: idx,
      })))
      .select('id, choice_key');
    if (cErr) throw new Error(cErr.message);
    if (answerKey?.correct_choice_id && bankChoices) {
      const originalCorrect = choices.find(c => c.id === answerKey.correct_choice_id);
      if (originalCorrect) {
        const bankCorrect = bankChoices.find(c => c.choice_key === originalCorrect.choice_key);
        if (bankCorrect) {
          await supabase.from('question_bank_answer_keys').insert({
            bank_question_id: inserted.id,
            correct_choice_id: bankCorrect.id,
            updated_by: userId,
          });
        }
      }
    }
  } else if (q.question_type === 'identification' && answerKey?.canonical_answer) {
    await supabase.from('question_bank_answer_keys').insert({
      bank_question_id: inserted.id,
      canonical_answer: answerKey.canonical_answer,
      accepted_answers: answerKey.accepted_answers ?? [],
      updated_by: userId,
    });
  }

  await recordAuditLog({ actorUserId: userId, action: 'create', entityType: 'question_bank', entityId: inserted.id, metadata: { source_question_id: q.id } });
  return { id: inserted.id };
}

interface AssessmentQuestionRow {
  id: string;
  question_type: QuestionType;
  question_text: string;
  difficulty: Difficulty;
  bloom_level: BloomLevel;
  points: number;
  topic_id: string | null;
  image_url: string | null;
  image_storage_path: string | null;
  position: number;
  question_choices?: { id: string; choice_key: string; choice_text: string; position: number }[];
  answer_keys?: { correct_choice_id: string | null; canonical_answer: string | null; accepted_answers: string[] | null } | { correct_choice_id: string | null; canonical_answer: string | null; accepted_answers: string[] | null }[] | null;
}

/**
 * Bulk "save this assessment's questions to the question bank" — the explicit
 * opt-in from the wizard's Approve step. Copies the current version's questions
 * (with choices + answer keys) as bank items, skipping any whose
 * `source_question_id` already exists for this subject (idempotent — approve
 * re-saves replace `questions` rows, so re-running never duplicates).
 * Authorization matches `saveAssessmentQuestionToBank`.
 */
export async function saveAssessmentQuestionsToBank(
  assessmentId: string
): Promise<{ saved: number; skipped: number }> {
  const { supabase, userId } = await requireUser();

  const { data: assess, error: aErr } = await supabase
    .from('assessments')
    .select('id, subject_offering_id, current_version_id')
    .eq('id', assessmentId)
    .single();
  if (aErr || !assess) throw new Error('Assessment not found');

  let subjectId: string | null = null;
  if (assess.subject_offering_id) {
    const { data: off } = await supabase
      .from('subject_offerings')
      .select('subject_id')
      .eq('id', assess.subject_offering_id)
      .single();
    subjectId = off?.subject_id ?? null;
  }
  if (!subjectId) throw new Error('Cannot determine subject for bank save');

  const authorized =
    (assess.subject_offering_id
      ? await isFacultyOfOffering(supabase, userId, assess.subject_offering_id)
      : false) || (await isFacultyOfSubject(supabase, userId, subjectId));
  if (!authorized) throw new Error('Not authorized');

  if (!assess.current_version_id) return { saved: 0, skipped: 0 };

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('id, question_type, question_text, difficulty, bloom_level, points, topic_id, image_url, image_storage_path, position, question_choices(id, choice_key, choice_text, position), answer_keys(correct_choice_id, canonical_answer, accepted_answers)')
    .eq('assessment_version_id', assess.current_version_id)
    .order('position', { ascending: true });
  if (qErr) throw new Error(qErr.message);
  const rows = (questions ?? []) as unknown as AssessmentQuestionRow[];
  if (rows.length === 0) return { saved: 0, skipped: 0 };

  // Idempotency: skip questions already copied into this subject's bank.
  const { data: existing } = await supabase
    .from('question_bank')
    .select('source_question_id')
    .eq('subject_id', subjectId)
    .in('source_question_id', rows.map((r) => r.id));
  const already = new Set(
    (existing ?? []).map((r) => (r as { source_question_id: string }).source_question_id)
  );
  const toInsert = rows.filter((r) => !already.has(r.id));
  if (toInsert.length === 0) return { saved: 0, skipped: already.size };

  const { data: inserted, error: iErr } = await supabase
    .from('question_bank')
    .insert(
      toInsert.map((r) => ({
        subject_id: subjectId,
        topic_id: r.topic_id ?? null,
        question_type: r.question_type,
        question_text: r.question_text,
        difficulty: r.difficulty,
        bloom_level: r.bloom_level,
        points: r.points,
        image_url: r.image_url ?? null,
        image_storage_path: r.image_storage_path ?? null,
        source_question_id: r.id,
        source_metadata: { copied_from_assessment: assessmentId },
        created_by: userId,
        status: 'active',
      }))
    )
    .select('id, source_question_id');
  if (iErr || !inserted) throw new Error(iErr?.message ?? 'Failed to save to bank');

  for (const bank of inserted) {
    const src = toInsert.find((r) => r.id === bank.source_question_id);
    if (!src) continue;

    const akRaw = src.answer_keys;
    const answerKey = Array.isArray(akRaw) ? akRaw[0] : akRaw;
    const choices = src.question_choices ?? [];

    if (
      (src.question_type === 'multiple_choice' || src.question_type === 'true_false') &&
      choices.length > 0
    ) {
      const { data: bankChoices, error: cErr } = await supabase
        .from('question_bank_choices')
        .insert(
          choices.map((c) => ({
            bank_question_id: bank.id,
            choice_key: c.choice_key,
            choice_text: c.choice_text,
            position: c.position ?? 0,
          }))
        )
        .select('id, choice_key');
      if (cErr) throw new Error(cErr.message);
      if (answerKey?.correct_choice_id && bankChoices) {
        const original = choices.find((c) => c.id === answerKey.correct_choice_id);
        const bankCorrect = original
          ? bankChoices.find((bc) => bc.choice_key === original.choice_key)
          : undefined;
        if (bankCorrect) {
          await supabase.from('question_bank_answer_keys').insert({
            bank_question_id: bank.id,
            correct_choice_id: bankCorrect.id,
            updated_by: userId,
          });
        }
      }
    } else if (src.question_type === 'identification' && answerKey?.canonical_answer) {
      await supabase.from('question_bank_answer_keys').insert({
        bank_question_id: bank.id,
        canonical_answer: answerKey.canonical_answer,
        accepted_answers: answerKey.accepted_answers ?? [],
        updated_by: userId,
      });
    }
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'question_bank',
    entityId: `assessment-${assessmentId}`,
    metadata: {
      subject_id: subjectId,
      assessment_id: assessmentId,
      saved_count: inserted.length,
      skipped_count: already.size,
    },
  });

  if (assess.subject_offering_id) {
    revalidatePath(`/faculty/subjects/${assess.subject_offering_id}/question-bank`);
  }
  revalidatePath('/faculty/subjects');

  return { saved: inserted.length, skipped: already.size };
}
