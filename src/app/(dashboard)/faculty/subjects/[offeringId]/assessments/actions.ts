'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { notifyOfferingStudents } from '@/lib/notifications';
import { recordAuditLog } from '@/lib/audit';
import {
  getFacultyAssessment,
  getFacultyAssessmentForQuestion,
  isFacultyOfOffering,
  type FacultyAssessment,
} from '@/lib/auth';
import type {
  Assessment,
  Question,
  QuestionType,
  Difficulty,
  BloomLevel,
} from '@/lib/types';

/**
 * Session client + authenticated user id, for the actions below.
 *
 * Authorization is separate and explicit: every mutation resolves the
 * assessment through `getFacultyAssessment`/`getFacultyAssessmentForQuestion`,
 * which fail when the caller is not faculty on the owning offering. RLS still
 * backstops the writes, but an action must not report success for a write RLS
 * silently dropped.
 */
async function requireUser(): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

/**
 * Throws unless the user is faculty on the offering itself (used when creating
 * an assessment, where no assessment id exists yet).
 */
async function requireOfferingFaculty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  offeringId: string
): Promise<void> {
  if (!(await isFacultyOfOffering(supabase, userId, offeringId))) {
    throw new Error('Subject offering not found or you are not assigned to it');
  }
}

/**
 * True when the version's questions must not change any more.
 *
 * An attempt's `exam_manifests` row snapshots the question and choice ids at
 * start, and choice edits delete and re-insert rows (new ids), so rewriting a
 * version that students are already sitting would leave manifests pointing at
 * choices that no longer exist. Published or deployed versions are frozen.
 */
async function isQuestionsLocked(
  supabase: Awaited<ReturnType<typeof createClient>>,
  versionId: string | null
): Promise<boolean> {
  if (!versionId) return false;

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id')
    .eq('assessment_version_id', versionId)
    .limit(1)
    .maybeSingle();

  return Boolean(deployment);
}

/** Throws when a question mutation would rewrite a frozen version. */
async function assertQuestionsEditable(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assessment: FacultyAssessment
): Promise<void> {
  if (assessment.status === 'published') {
    throw new Error(
      'This assessment is published, so its questions are read-only. Editing them would invalidate attempts already taken.'
    );
  }

  if (await isQuestionsLocked(supabase, assessment.currentVersionId)) {
    throw new Error(
      'This version has already been deployed, so its questions are read-only. Editing them would break exams in progress.'
    );
  }
}

/**
 * Recomputes a version's cached item/point totals from its questions.
 *
 * `assessment_versions.total_items`/`total_points` are cached columns the list
 * and deploy screens read, so every question mutation has to refresh them.
 */
async function refreshVersionTotals(
  supabase: Awaited<ReturnType<typeof createClient>>,
  versionId: string
): Promise<void> {
  const [{ count }, { data: pointRows }] = await Promise.all([
    supabase
      .from('questions')
      .select('id', { count: 'exact', head: true })
      .eq('assessment_version_id', versionId),
    supabase.from('questions').select('points').eq('assessment_version_id', versionId),
  ]);

  await supabase
    .from('assessment_versions')
    .update({
      total_items: count || 0,
      total_points: pointRows?.reduce((sum, row) => sum + (row.points || 0), 0) || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', versionId);
}

/** Refreshes every faculty view that shows an assessment. */
function revalidateAssessment(offeringId: string, assessmentId?: string): void {
  revalidatePath(`/faculty/subjects/${offeringId}`);
  revalidatePath(`/faculty/subjects/${offeringId}/assessments`);
  if (assessmentId) {
    revalidatePath(`/faculty/subjects/${offeringId}/assessments/${assessmentId}`);
  }
}

export async function getSourceMaterials(offeringId: string) {
  const { supabase } = await requireUser();

  const { data, error } = await supabase
    .from('source_materials')
    .select('*')
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

// ---------------------------------------------------------------------------
// Detail loader
// ---------------------------------------------------------------------------

export interface AssessmentDetailChoice {
  id: string;
  choice_key: string;
  choice_text: string;
}

export interface AssessmentDetailQuestion {
  id: string;
  position: number | null;
  question_type: QuestionType;
  question_text: string;
  difficulty: Difficulty;
  bloom_level: BloomLevel;
  points: number;
  is_ai_generated: boolean;
  choices: AssessmentDetailChoice[];
  correctChoiceId: string | null;
  canonicalAnswer: string | null;
  acceptedAnswers: string[] | null;
}

export interface AssessmentDetail {
  id: string;
  title: string;
  status: string;
  instructions: string | null;
  subjectOfferingId: string;
  /**
   * True when questions can no longer be edited (published or deployed). The
   * client hides the controls; the actions re-check before writing.
   */
  questionsLocked: boolean;
  version: {
    id: string;
    versionNumber: number;
    status: string;
    totalItems: number;
    totalPoints: number;
  } | null;
  questions: AssessmentDetailQuestion[];
}

/**
 * Everything the assessment detail page renders: the assessment, its current
 * version, and its questions with choices and answer keys in position order.
 *
 * Returns null when the caller is not faculty on the owning offering, so the
 * page can 404 instead of exposing an assessment it may not read.
 */
export async function getAssessmentDetail(
  assessmentId: string
): Promise<AssessmentDetail | null> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) return null;

  const questionsLocked =
    assessment.status === 'published' ||
    (await isQuestionsLocked(supabase, assessment.currentVersionId));

  let version: AssessmentDetail['version'] = null;
  let instructions: string | null = null;
  let questions: AssessmentDetailQuestion[] = [];

  if (assessment.currentVersionId) {
    const { data: versionRow } = await supabase
      .from('assessment_versions')
      .select('id, version_number, status, total_items, total_points, instructions')
      .eq('id', assessment.currentVersionId)
      .maybeSingle();

    if (versionRow) {
      version = {
        id: versionRow.id,
        versionNumber: versionRow.version_number,
        status: versionRow.status,
        totalItems: versionRow.total_items ?? 0,
        totalPoints: versionRow.total_points ?? 0,
      };
      instructions = versionRow.instructions ?? null;
    }

    const { data: questionRows } = await supabase
      .from('questions')
      .select(`
        id, position, question_type, question_text, difficulty, bloom_level, points, is_ai_generated,
        question_choices(id, choice_key, choice_text, position),
        answer_key:answer_keys(correct_choice_id, canonical_answer, accepted_answers)
      `)
      .eq('assessment_version_id', assessment.currentVersionId)
      .order('position', { ascending: true });

    questions = (questionRows ?? []).map((row: Record<string, unknown>) => {
      const answerKey = (Array.isArray(row.answer_key) ? row.answer_key[0] : row.answer_key) as
        | {
            correct_choice_id?: string | null;
            canonical_answer?: string | null;
            accepted_answers?: string[] | null;
          }
        | null
        | undefined;

      const choices = ((row.question_choices ?? []) as Array<{
        id: string;
        choice_key: string;
        choice_text: string;
        position: number | null;
      }>)
        .slice()
        .sort(
          (a, b) =>
            (a.position ?? 0) - (b.position ?? 0) || a.choice_key.localeCompare(b.choice_key)
        )
        .map((choice) => ({
          id: choice.id,
          choice_key: choice.choice_key,
          choice_text: choice.choice_text,
        }));

      return {
        id: row.id as string,
        position: (row.position as number | null) ?? null,
        question_type: row.question_type as QuestionType,
        question_text: row.question_text as string,
        difficulty: row.difficulty as Difficulty,
        bloom_level: row.bloom_level as BloomLevel,
        points: (row.points as number) ?? 0,
        is_ai_generated: Boolean(row.is_ai_generated),
        choices,
        correctChoiceId: answerKey?.correct_choice_id ?? null,
        canonicalAnswer: answerKey?.canonical_answer ?? null,
        acceptedAnswers: answerKey?.accepted_answers ?? null,
      };
    });
  }

  return {
    id: assessment.id,
    title: assessment.title,
    status: assessment.status,
    instructions,
    subjectOfferingId: assessment.subjectOfferingId,
    questionsLocked,
    version,
    questions,
  };
}

export async function createAssessment(
  offeringId: string,
  data: {
    title: string;
    instructions?: string;
    assessment_category?: string;
  }
) {
  const { supabase, userId } = await requireUser();

  await requireOfferingFaculty(supabase, userId, offeringId);

  const title = data.title?.trim();
  if (!title) throw new Error('A title is required');
  if (title.length > 200) throw new Error('Title must be 200 characters or fewer');

  const { data: assessment, error: createErr } = await supabase
    .from('assessments')
    .insert({
      subject_offering_id: offeringId,
      created_by: userId,
      title: data.title,
      assessment_type: 'multiple_choice' as QuestionType,
      status: 'draft' as const,
    })
    .select()
    .single();

  if (createErr || !assessment) throw new Error(createErr?.message || 'Failed to create assessment');

  const { data: version, error: verErr } = await supabase
    .from('assessment_versions')
    .insert({
      assessment_id: assessment.id,
      version_number: 1,
      status: 'draft' as const,
      instructions: data.instructions || null,
      total_items: 0,
      total_points: 0,
      generation_config: data.assessment_category ? { assessment_category: data.assessment_category } : null,
    })
    .select()
    .single();

  if (verErr || !version) throw new Error(verErr?.message || 'Failed to create version');

  const { error: linkError } = await supabase
    .from('assessments')
    .update({ current_version_id: version.id })
    .eq('id', assessment.id);

  if (linkError) throw new Error(linkError.message);

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'assessment',
    entityId: assessment.id,
    metadata: { title, subject_offering_id: offeringId },
  });

  revalidateAssessment(offeringId, assessment.id);
  return assessment as Assessment;
}

export async function updateAssessment(
  assessmentId: string,
  data: {
    title?: string;
    instructions?: string;
  }
) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');

  if (data.title) {
    const title = data.title.trim();
    if (!title) throw new Error('A title is required');

    const { data: updated, error } = await supabase
      .from('assessments')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', assessmentId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!updated) throw new Error('That assessment no longer exists or you cannot modify it');
  }

  if (assessment.currentVersionId && data.instructions !== undefined) {
    const { error } = await supabase
      .from('assessment_versions')
      .update({ instructions: data.instructions, updated_at: new Date().toISOString() })
      .eq('id', assessment.currentVersionId)
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'assessment',
    entityId: assessment.id,
    metadata: { fields: Object.keys(data) },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessment.id);
  return { success: true };
}

export async function updateGenerationConfig(
  assessmentId: string,
  config: Record<string, unknown>
) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');

  if (!assessment.currentVersionId) throw new Error('No version found');

  const { data: updated, error } = await supabase
    .from('assessment_versions')
    .update({ generation_config: config, updated_at: new Date().toISOString() })
    .eq('id', assessment.currentVersionId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!updated) throw new Error('That assessment version no longer exists or you cannot modify it');

  return { success: true };
}

export async function addQuestion(
  assessmentId: string,
  data: {
    question_type: QuestionType;
    question_text: string;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number;
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

export async function approveAssessment(assessmentId: string) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');
  if (!assessment.currentVersionId) throw new Error('No version found');

  const { data: approved, error: assessErr } = await supabase
    .from('assessments')
    .update({ status: 'approved', updated_at: new Date().toISOString() })
    .eq('id', assessmentId)
    .select('id')
    .maybeSingle();

  if (assessErr) throw new Error(assessErr.message);
  if (!approved) throw new Error('That assessment no longer exists or you cannot modify it');

  const { error: verErr } = await supabase
    .from('assessment_versions')
    .update({
      status: 'approved',
      approved_by: userId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assessment.currentVersionId);
  if (verErr) throw new Error(verErr.message);

  await recordAuditLog({
    actorUserId: userId,
    action: 'approve',
    entityType: 'assessment',
    entityId: assessmentId,
    metadata: { title: assessment.title },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessment.id);
  return { success: true };
}

export async function publishAssessment(assessmentId: string) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');
  if (!assessment.currentVersionId) throw new Error('No version found');

  const { data: published, error: assessErr } = await supabase
    .from('assessments')
    .update({ status: 'published', updated_at: new Date().toISOString() })
    .eq('id', assessmentId)
    .select('id')
    .maybeSingle();

  if (assessErr) throw new Error(assessErr.message);
  if (!published) throw new Error('That assessment no longer exists or you cannot modify it');

  const { error: verErr } = await supabase
    .from('assessment_versions')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', assessment.currentVersionId);
  if (verErr) throw new Error(verErr.message);

  // Tell the class an assessment is coming (notifications are server-written
  // only; see lib/notifications.ts).
  await notifyOfferingStudents({
    offeringId: assessment.subjectOfferingId,
    type: 'assessment_published',
    title: 'New assessment published',
    body: `${assessment.title} has been published. Watch for its schedule.`,
    data: { assessment_id: assessmentId },
  });

  await recordAuditLog({
    actorUserId: userId,
    action: 'publish',
    entityType: 'assessment',
    entityId: assessmentId,
    metadata: { title: assessment.title },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessment.id);
  // Students see published assessments on their own list.
  revalidatePath('/student/assessments');
  return { success: true };
}

export async function saveGeneratedQuestions(
  assessmentId: string,
  questions: {
    question_type: QuestionType;
    question_text: string;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number;
    is_ai_generated?: boolean;
    question_choices?: { choice_key: string; choice_text: string; is_correct?: boolean }[];
    canonical_answer?: string;
    accepted_answers?: string[];
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
        created_by: userId,
      })
      .select('id')
      .single();

    if (qErr || !question) return { success: false, error: `Failed to save question ${i + 1}: ${qErr?.message ?? 'unknown'}` };

    if (q.question_type === 'multiple_choice' && q.question_choices && q.question_choices.length > 0) {
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

export async function triggerGeneration(
  assessmentId: string,
  config: {
    source_material_ids: string[];
    question_types: QuestionType[];
    count_per_type: Record<QuestionType, number>;
    difficulty_distribution: Record<Difficulty, number>;
    bloom_distribution: Record<BloomLevel, number>;
    custom_instructions?: string;
  }
) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');

  const { data: job, error: jobErr } = await supabase
    .from('assessment_generation_jobs')
    .insert({
      assessment_id: assessmentId,
      requested_by: userId,
      operation: 'generate_questions',
      status: 'queued',
      input_config: config,
    })
    .select()
    .single();

  if (jobErr || !job) throw new Error(jobErr?.message || 'Failed to create generation job');

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'assessment_generation_job',
    entityId: job.id,
    metadata: { assessment_id: assessmentId },
  });

  return job;
}
