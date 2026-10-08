'use server';

// Question CRUD, question provenance and AI-generated question saves.
// Split out of the former single actions.ts; blocks are unchanged.

import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { getFacultyAssessment, getFacultyAssessmentForQuestion } from '@/lib/auth';
import type { Question, QuestionType, Difficulty, BloomLevel } from '@/lib/types';
import { requireUser, assertQuestionsEditable, refreshVersionTotals, revalidateAssessment } from './shared';

export async function addQuestion(
  assessmentId: string,
  data: {
    question_type: QuestionType;
    question_text: string;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number;
    topic_id?: string | null;
    image_url?: string | null;
    image_storage_path?: string | null;
    choices?: { choice_key: string; choice_text: string }[];
    canonical_answer?: string;
    accepted_answers?: string[];
    correct_choice_key?: string;
  }
) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');
  if (!assessment.currentVersionId) throw new Error('No version found');

  await assertQuestionsEditable(supabase, assessment);

  const versionId = assessment.currentVersionId;

  const questionText = data.question_text?.trim();
  if (!questionText) throw new Error('Question text is required');
  if (!Number.isFinite(data.points) || data.points < 1) {
    throw new Error('Points must be at least 1');
  }

  const { data: maxPos } = await supabase
    .from('questions')
    .select('position')
    .eq('assessment_version_id', versionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextPosition = (maxPos?.position || 0) + 1;

  const { data: question, error: qErr } = await supabase
    .from('questions')
    .insert({
      assessment_version_id: versionId,
      question_type: data.question_type,
      question_text: questionText,
      difficulty: data.difficulty,
      bloom_level: data.bloom_level,
      points: data.points,
      position: nextPosition,
      status: 'active',
      created_by: userId,
      is_ai_generated: false,
      topic_id: data.topic_id ?? null,
      image_url: data.image_url ?? null,
      image_storage_path: data.image_storage_path ?? null,
    })
    .select()
    .single();

  if (qErr || !question) throw new Error(qErr?.message || 'Failed to add question');

  if (data.choices && data.choices.length > 0) {
    const choiceInserts = data.choices.map((c, i) => ({
      question_id: question.id,
      choice_key: c.choice_key,
      choice_text: c.choice_text,
      position: i,
    }));

    const { data: choices, error: cErr } = await supabase
      .from('question_choices')
      .insert(choiceInserts)
      .select();

    if (cErr) throw new Error(cErr.message);

    if (data.correct_choice_key && choices) {
      const correctChoice = choices.find(c => c.choice_key === data.correct_choice_key);
      if (correctChoice) {
        await supabase.from('answer_keys').insert({
          question_id: question.id,
          correct_choice_id: correctChoice.id,
          updated_by: userId,
        });
      }
    }
  } else if (data.question_type === 'true_false') {
    // Ensure default True/False choices exist even if caller omitted them.
    const defaults = [
      { question_id: question.id, choice_key: 'T', choice_text: 'True', position: 0 },
      { question_id: question.id, choice_key: 'F', choice_text: 'False', position: 1 },
    ];
    const { data: choices, error: cErr } = await supabase
      .from('question_choices')
      .insert(defaults)
      .select();
    if (cErr) throw new Error(cErr.message);
    if (data.correct_choice_key && choices) {
      const correctChoice = choices.find(c => c.choice_key === data.correct_choice_key);
      if (correctChoice) {
        await supabase.from('answer_keys').insert({
          question_id: question.id,
          correct_choice_id: correctChoice.id,
          updated_by: userId,
        });
      }
    }
  }

  if (data.question_type === 'identification' && data.canonical_answer) {
    await supabase.from('answer_keys').insert({
      question_id: question.id,
      canonical_answer: data.canonical_answer,
      accepted_answers: data.accepted_answers || [],
      updated_by: userId,
    });
  }

  await refreshVersionTotals(supabase, versionId);

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'question',
    entityId: question.id,
    metadata: { assessment_id: assessmentId },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessment.id);
  return question as Question;
}

export async function updateQuestion(
  questionId: string,
  data: {
    question_type?: QuestionType;
    question_text?: string;
    difficulty?: Difficulty;
    bloom_level?: BloomLevel;
    points?: number;
    topic_id?: string | null;
    image_url?: string | null;
    image_storage_path?: string | null;
    choices?: { id?: string; choice_key: string; choice_text: string }[];
    correct_choice_key?: string;
    canonical_answer?: string;
    accepted_answers?: string[];
  }
) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessmentForQuestion(supabase, userId, questionId);
  if (!assessment) throw new Error('Question not found or you are not assigned to its offering');

  await assertQuestionsEditable(supabase, assessment);

  const questionText = data.question_text?.trim();
  if (data.question_text !== undefined && !questionText) {
    throw new Error('Question text cannot be empty');
  }
  if (data.points !== undefined && (!Number.isFinite(data.points) || data.points < 1)) {
    throw new Error('Points must be at least 1');
  }

  const updateFields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (data.question_type !== undefined) updateFields.question_type = data.question_type;
  if (questionText !== undefined) updateFields.question_text = questionText;
  if (data.difficulty !== undefined) updateFields.difficulty = data.difficulty;
  if (data.bloom_level !== undefined) updateFields.bloom_level = data.bloom_level;
  if (data.points !== undefined) updateFields.points = data.points;
  if (data.topic_id !== undefined) updateFields.topic_id = data.topic_id;
  if (data.image_url !== undefined) updateFields.image_url = data.image_url;
  if (data.image_storage_path !== undefined) updateFields.image_storage_path = data.image_storage_path;

  if (Object.keys(updateFields).length > 1) {
    const { data: updated, error } = await supabase
      .from('questions')
      .update(updateFields)
      .eq('id', questionId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error('That question no longer exists or you cannot modify it');
  }

  if (data.choices) {
    await supabase.from('question_choices').delete().eq('question_id', questionId);

    if (data.choices.length > 0) {
      const inserts = data.choices.map((c, i) => ({
        question_id: questionId,
        choice_key: c.choice_key,
        choice_text: c.choice_text,
        position: i,
      }));

      const { data: savedChoices } = await supabase
        .from('question_choices')
        .insert(inserts)
        .select();

      await supabase.from('answer_keys').delete().eq('question_id', questionId);

      if (data.correct_choice_key && savedChoices) {
        const correct = savedChoices.find(c => c.choice_key === data.correct_choice_key);
        if (correct) {
          await supabase.from('answer_keys').insert({
            question_id: questionId,
            correct_choice_id: correct.id,
            updated_by: userId,
          });
        }
      }
    }
  }

  if (data.canonical_answer !== undefined) {
    await supabase.from('answer_keys').delete().eq('question_id', questionId);
    await supabase.from('answer_keys').insert({
      question_id: questionId,
      canonical_answer: data.canonical_answer,
      accepted_answers: data.accepted_answers || [],
      updated_by: userId,
    });
  }

  // Points drive the version's cached totals, so refresh them when they move.
  if (data.points !== undefined) {
    const { data: question } = await supabase
      .from('questions')
      .select('assessment_version_id')
      .eq('id', questionId)
      .maybeSingle();

    if (question?.assessment_version_id) {
      await refreshVersionTotals(supabase, question.assessment_version_id);
    }
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'question',
    entityId: questionId,
    metadata: { assessment_id: assessment.id },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessment.id);
  return { success: true };
}

export async function deleteQuestion(questionId: string) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessmentForQuestion(supabase, userId, questionId);
  if (!assessment) throw new Error('Question not found or you are not assigned to its offering');

  await assertQuestionsEditable(supabase, assessment);

  const { data: question } = await supabase
    .from('questions')
    .select('assessment_version_id, position')
    .eq('id', questionId)
    .maybeSingle();

  const { data: deleted, error } = await supabase
    .from('questions')
    .delete()
    .eq('id', questionId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!deleted) throw new Error('That question no longer exists or you cannot delete it');

  if (question) {
    // Decrement position of all questions after the deleted one
    const { data: laterQuestions } = await supabase
      .from('questions')
      .select('id, position')
      .eq('assessment_version_id', question.assessment_version_id)
      .gt('position', question.position)
      .order('position', { ascending: true });

    if (laterQuestions) {
      for (const q of laterQuestions) {
        await supabase
          .from('questions')
          .update({ position: q.position - 1 })
          .eq('id', q.id);
      }
    }

    await refreshVersionTotals(supabase, question.assessment_version_id);
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'delete',
    entityType: 'question',
    entityId: questionId,
    metadata: { assessment_id: assessment.id },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessment.id);
  return { success: true };
}

// ---------------------------------------------------------------------------
// Table of Specifications (scope §10)
// ---------------------------------------------------------------------------

export async function saveGeneratedQuestions(
  assessmentId: string,
  questions: {
    question_type: QuestionType;
    question_text: string;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number;
    is_ai_generated?: boolean;
    topic_id?: string | null;
    image_url?: string | null;
    image_storage_path?: string | null;
    question_choices?: { choice_key: string; choice_text: string; is_correct?: boolean }[];
    canonical_answer?: string;
    accepted_answers?: string[];
    generation_metadata?: Record<string, unknown> | null;
    sourceChunkIds?: string[];
    /** Candidate embedding from the generate route — stored so later
     * duplicate checks can compare against this item (scope §13). */
    embedding?: number[] | null;
  }[]
): Promise<{ success: boolean; saved?: number; error?: string }> {
  if (!assessmentId) return { success: false, error: 'Missing assessment' };
  if (!questions || questions.length === 0) return { success: false, error: 'No questions to save' };

  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) return { success: false, error: 'Assessment not found or not authorized' };
  if (!assessment.currentVersionId) return { success: false, error: 'No version found' };

  const versionId = assessment.currentVersionId;

  // Idempotent re-save (wizard retry): clear any previous questions first.
  // Cascades remove choices and answer keys.
  const { error: delErr } = await supabase
    .from('questions')
    .delete()
    .eq('assessment_version_id', versionId);
  if (delErr) return { success: false, error: `Failed to reset questions: ${delErr.message}` };

  let saved = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.question_text?.trim()) continue;

    const { data: question, error: qErr } = await supabase
      .from('questions')
      .insert({
        assessment_version_id: versionId,
        question_type: q.question_type,
        question_text: q.question_text,
        difficulty: q.difficulty,
        bloom_level: q.bloom_level,
        points: q.points,
        position: i + 1,
        status: 'active',
        is_ai_generated: q.is_ai_generated ?? false,
        generation_metadata: q.generation_metadata ?? null,
        embedding: q.embedding ?? null,
        topic_id: q.topic_id ?? null,
        image_url: q.image_url ?? null,
        image_storage_path: q.image_storage_path ?? null,
        created_by: userId,
      })
      .select('id')
      .single();

    if (qErr || !question) return { success: false, error: `Failed to save question ${i + 1}: ${qErr?.message ?? 'unknown'}` };

    if (
      (q.question_type === 'multiple_choice' || q.question_type === 'true_false') &&
      q.question_choices &&
      q.question_choices.length > 0
    ) {
      const { data: choices, error: cErr } = await supabase
        .from('question_choices')
        .insert(q.question_choices.map((c, ci) => ({
          question_id: question.id,
          choice_key: c.choice_key,
          choice_text: c.choice_text,
          position: ci,
        })))
        .select('id, choice_key');

      if (cErr) return { success: false, error: `Failed to save choices for question ${i + 1}: ${cErr.message}` };

      const correct = q.question_choices.find((c) => c.is_correct);
      if (correct && choices) {
        const correctRow = choices.find((c) => c.choice_key === correct.choice_key);
        if (correctRow) {
          await supabase.from('answer_keys').insert({
            question_id: question.id,
            correct_choice_id: correctRow.id,
            updated_by: userId,
          });
        }
      }
    }

    if (q.question_type === 'identification' && q.canonical_answer?.trim()) {
      await supabase.from('answer_keys').insert({
        question_id: question.id,
        canonical_answer: q.canonical_answer,
        accepted_answers: q.accepted_answers ?? [],
        updated_by: userId,
      });
    }

    // Persist source traceability: link question to source chunks
    if (q.sourceChunkIds && q.sourceChunkIds.length > 0) {
      const sourceLinks = q.sourceChunkIds.map((chunkId, idx) => ({
        question_id: question.id,
        source_chunk_id: chunkId,
        relevance_score: 1.0 - (idx * 0.1), // First chunk is most relevant
        is_primary: idx === 0,
      }));
      await supabase.from('question_sources').insert(sourceLinks);
    }

    saved++;
  }

  await refreshVersionTotals(supabase, versionId);

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'assessment',
    entityId: assessment.id,
    metadata: { questions_saved: saved, replaced_previous_questions: true },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessment.id);
  return { success: true, saved };
}

export interface QuestionSourceInfo {
  question_id: string;
  source_chunk_id: string;
  source_material_id: string;
  source_material_title: string;
  chunk_content: string;
  relevance_score: number;
  is_primary: boolean;
}

/**
 * Fetch source material references for a question. Faculty can view which
 * source material and chunks grounded a particular question.
 */
export async function getSourceForQuestion(
  questionId: string
): Promise<{ data: QuestionSourceInfo[] | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  // Verify the question belongs to an assessment the faculty owns
  const assessment = await getFacultyAssessmentForQuestion(supabase, userId, questionId);
  if (!assessment) return { data: null, error: 'Not authorized' };

  const admin = createAdminClient();
  const { data: sources, error: srcErr } = await admin
    .from('question_sources')
    .select(`
      question_id,
      source_chunk_id,
      relevance_score,
      is_primary,
      source_chunks!inner (
        id,
        content,
        source_material_id,
        source_materials!inner (
          id,
          title
        )
      )
    `)
    .eq('question_id', questionId);

  if (srcErr) return { data: null, error: srcErr.message };
  if (!sources || sources.length === 0) return { data: [] };

  const result: QuestionSourceInfo[] = sources.map((s: Record<string, unknown>) => {
    const chunk = s.source_chunks as { content: string; source_material_id: string } | null;
    const material = (s.source_chunks as Record<string, unknown>)?.source_materials as { id: string; title: string } | null;
    return {
      question_id: s.question_id as string,
      source_chunk_id: s.source_chunk_id as string,
      source_material_id: material?.id ?? '',
      source_material_title: material?.title ?? 'Unknown',
      chunk_content: chunk?.content ?? '',
      relevance_score: s.relevance_score as number,
      is_primary: s.is_primary as boolean,
    };
  });

  return { data: result };
}

