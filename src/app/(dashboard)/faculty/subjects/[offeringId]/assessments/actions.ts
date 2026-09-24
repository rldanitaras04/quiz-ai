'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyOfferingStudents } from '@/lib/notifications';
import { recordAuditLog } from '@/lib/audit';
import {
  getFacultyAssessment,
  getFacultyAssessmentForQuestion,
  isFacultyOfOffering,
  isFacultyOfSubject,
  type FacultyAssessment,
} from '@/lib/auth';
import type {
  Assessment,
  Question,
  QuestionType,
  Difficulty,
  BloomLevel,
} from '@/lib/types';
import { type ParsedExamItem } from '@/lib/import/exam-parse';

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
 * Throws unless the user may create assessments rooted at this offering:
 * faculty on the offering itself, or faculty on any section of its subject
 * (subject-scoped creation stamps an arbitrary primary offering).
 */
async function requireOfferingFaculty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  offeringId: string
): Promise<void> {
  if (await isFacultyOfOffering(supabase, userId, offeringId)) return;

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject_id')
    .eq('id', offeringId)
    .maybeSingle();

  if (offering?.subject_id && (await isFacultyOfSubject(supabase, userId, offering.subject_id))) {
    return;
  }

  throw new Error('Subject offering not found or you are not assigned to it');
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
  revalidatePath('/faculty/subjects');
  // Subject-scoped list + detail under /faculty/subjects/subject/[subjectId]/...
  revalidatePath('/faculty/subjects/subject/[subjectId]', 'page');
  revalidatePath('/faculty/subjects/subject/[subjectId]/assessments/[assessmentId]', 'page');
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

export async function retrySourceMaterial(sourceId: string) {
  const { supabase, userId } = await requireUser();

  const { data: source, error: fetchError } = await supabase
    .from('source_materials')
    .select('id, subject_offering_id, storage_path, mime_type, processing_status')
    .eq('id', sourceId)
    .single();

  if (fetchError || !source) throw new Error('Source material not found');
  if (source.processing_status !== 'failed') throw new Error('Only failed materials can be retried');

  if (!(await isFacultyOfOffering(supabase, userId, source.subject_offering_id))) {
    throw new Error('Not authorized');
  }

  if (!source.storage_path) throw new Error('No storage path found');

  const { data: fileData, error: downloadError } = await supabase.storage
    .from('source-materials')
    .download(source.storage_path);

  if (downloadError || !fileData) throw new Error('Failed to download file from storage');

  const arrayBuffer = await fileData.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { extractAndStoreSource } = await import('@/lib/ai');
  extractAndStoreSource(source.id, buffer, source.mime_type).catch((error) => {
    console.error('Background reprocessing error:', error);
  });

  return { success: true };
}

export async function deleteSourceMaterial(sourceId: string) {
  const { supabase, userId } = await requireUser();

  const { data: source, error: fetchError } = await supabase
    .from('source_materials')
    .select('id, subject_offering_id, storage_path')
    .eq('id', sourceId)
    .single();

  if (fetchError || !source) throw new Error('Source material not found');

  if (!(await isFacultyOfOffering(supabase, userId, source.subject_offering_id))) {
    throw new Error('Not authorized');
  }

  if (source.storage_path) {
    await supabase.storage.from('source-materials').remove([source.storage_path]);
  }

  const { error } = await supabase
    .from('source_materials')
    .delete()
    .eq('id', sourceId);

  if (error) throw new Error(error.message);
  return { success: true };
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
  topicId: string | null;
  topicTitle: string | null;
  imageUrl: string | null;
  imageStoragePath: string | null;
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
  /** All versions of this assessment (newest first). */
  versions: {
    id: string;
    versionNumber: number;
    status: string;
    totalItems: number;
    totalPoints: number;
  }[];
  /** Deployments attached to this assessment. */
  deployments: AssessmentDeploymentSummary[];
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
        id, position, question_type, question_text, difficulty, bloom_level, points, is_ai_generated, topic_id, image_url, image_storage_path, topic:topics(id, title),
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

      const topic = (row.topic as { id: string; title: string } | null) ?? null;
      return {
        id: row.id as string,
        position: (row.position as number | null) ?? null,
        question_type: row.question_type as QuestionType,
        question_text: row.question_text as string,
        difficulty: row.difficulty as Difficulty,
        bloom_level: row.bloom_level as BloomLevel,
        points: (row.points as number) ?? 0,
        is_ai_generated: Boolean(row.is_ai_generated),
        topicId: (row.topic_id as string | null) ?? topic?.id ?? null,
        topicTitle: topic?.title ?? null,
        imageUrl: (row.image_url as string | null) ?? null,
        imageStoragePath: (row.image_storage_path as string | null) ?? null,
        choices,
        correctChoiceId: answerKey?.correct_choice_id ?? null,
        canonicalAnswer: answerKey?.canonical_answer ?? null,
        acceptedAnswers: answerKey?.accepted_answers ?? null,
      };
    });
  }

  // Fetch all versions for the version history display.
  const { data: versionRows } = await supabase
    .from('assessment_versions')
    .select('id, version_number, status, total_items, total_points')
    .eq('assessment_id', assessmentId)
    .order('version_number', { ascending: false });

  const allVersions = (versionRows ?? []).map((v: Record<string, unknown>) => ({
    id: v.id as string,
    versionNumber: v.version_number as number,
    status: v.status as string,
    totalItems: (v.total_items as number) ?? 0,
    totalPoints: (v.total_points as number) ?? 0,
  }));

  // Fetch deployments for the deploy status display.
  const { data: deploymentRows } = await supabase
    .from('assessment_deployments')
    .select(`
      id,
      status,
      opens_at,
      closes_at,
      duration_minutes,
      attempt_limit,
      assessment_version:assessment_versions(version_number, total_items, total_points)
    `)
    .eq('assessment_id', assessmentId)
    .order('created_at', { ascending: false });

  const assessmentDeployments: AssessmentDeploymentSummary[] = (deploymentRows ?? []).map(
    (d: Record<string, unknown>) => {
      const ver = d.assessment_version as
        | { version_number?: number; total_items?: number; total_points?: number }
        | null;
      return {
        id: d.id as string,
        status: d.status as string,
        opens_at: d.opens_at as string,
        closes_at: d.closes_at as string,
        duration_minutes: d.duration_minutes as number,
        attempt_limit: d.attempt_limit as number,
        version_number: ver?.version_number ?? 0,
        total_items: ver?.total_items ?? 0,
        total_points: ver?.total_points ?? 0,
      };
    }
  );

  return {
    id: assessment.id,
    title: assessment.title,
    status: assessment.status,
    instructions,
    subjectOfferingId: assessment.subjectOfferingId,
    questionsLocked,
    version,
    questions,
    versions: allVersions,
    deployments: assessmentDeployments,
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

/**
 * Deletes one or more assessments for faculty on their offerings.
 *
 * Each row is authorized and attempt-checked the same way as `deleteAssessment`.
 * Rows that cannot be deleted (not owned, student attempts exist) are reported
 * in `failed` so a bulk run is not all-or-nothing when only some are blocked.
 */
export async function deleteAssessments(
  assessmentIds: string[]
): Promise<{
  deleted: string[];
  failed: { id: string; title: string; error: string }[];
}> {
  const { supabase, userId } = await requireUser();

  const ids = [...new Set(assessmentIds.filter(Boolean))];
  if (ids.length === 0) throw new Error('No assessments selected');

  const deleted: string[] = [];
  const failed: { id: string; title: string; error: string }[] = [];

  for (const assessmentId of ids) {
    let title = assessmentId;
    try {
      const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
      if (!assessment) {
        throw new Error('Not found or you are not assigned to its offering');
      }
      title = assessment.title;

      const { data: deployments } = await supabase
        .from('assessment_deployments')
        .select('id')
        .eq('assessment_id', assessmentId);

      const deploymentIds = (deployments ?? []).map((d) => d.id);
      if (deploymentIds.length > 0) {
        const { count } = await supabase
          .from('exam_attempts')
          .select('id', { count: 'exact', head: true })
          .in('deployment_id', deploymentIds);

        if (count && count > 0) {
          throw new Error(
            `Has ${count} student attempt${count === 1 ? '' : 's'} — close and clear attempts first`
          );
        }
      }

      const { error } = await supabase.from('assessments').delete().eq('id', assessmentId);
      if (error) throw new Error(error.message);

      const { data: remaining } = await supabase
        .from('assessments')
        .select('id')
        .eq('id', assessmentId)
        .maybeSingle();
      if (remaining) throw new Error('Could not delete (RLS blocked the write)');

      await recordAuditLog({
        actorUserId: userId,
        action: 'delete',
        entityType: 'assessment',
        entityId: assessmentId,
        metadata: {
          title: assessment.title,
          status: assessment.status,
          subject_offering_id: assessment.subjectOfferingId,
          bulk: ids.length > 1,
        },
      });

      revalidateAssessment(assessment.subjectOfferingId, assessmentId);
      deleted.push(assessmentId);
    } catch (e) {
      failed.push({
        id: assessmentId,
        title,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  }

  if (deleted.length > 0) {
    revalidatePath('/faculty/subjects');
    revalidatePath('/faculty/subjects/subject/[subjectId]', 'page');
    revalidatePath('/faculty/subjects/subject/[subjectId]/assessments/[assessmentId]', 'page');
  }

  return { deleted, failed };
}

/**
 * Single-assessment delete (wrapper around the bulk path).
 */
export async function deleteAssessment(assessmentId: string): Promise<{ success: true }> {
  const result = await deleteAssessments([assessmentId]);
  if (result.failed.length > 0) {
    throw new Error(result.failed[0].error);
  }
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
  revalidatePath('/student');
  revalidatePath('/notifications');
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
    topic_id?: string | null;
    image_url?: string | null;
    image_storage_path?: string | null;
    question_choices?: { choice_key: string; choice_text: string; is_correct?: boolean }[];
    canonical_answer?: string;
    accepted_answers?: string[];
    sourceChunkIds?: string[];
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

// ---------------------------------------------------------------------------
// Version management
// ---------------------------------------------------------------------------

/**
 * Creates a new draft version of an assessment. Used when the current version
 * is published or deployed and faculty want to revise questions without
 * affecting existing deployments.
 *
 * The new version inherits the previous version's instructions, generation
 * config, **and questions** (deep-copied with choices + answer keys). Faculty
 * can then add, edit, delete, or import ready-made items on the new draft.
 * The assessment status resets to `draft`.
 */
export async function createNewVersion(
  assessmentId: string
): Promise<{ success: boolean; versionId?: string; copiedQuestions?: number; error?: string }> {
  try {
    const { supabase, userId } = await requireUser();

    const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
    if (!assessment) {
      return { success: false, error: 'Assessment not found or you are not assigned to its offering' };
    }

    // Determine the next version number.
    const { data: existingVersions } = await supabase
      .from('assessment_versions')
      .select('version_number')
      .eq('assessment_id', assessmentId)
      .order('version_number', { ascending: false })
      .limit(1);

    const nextVersionNumber = (existingVersions?.[0]?.version_number ?? 0) + 1;

    // Copy instructions and generation config from the current version.
    let instructions: string | null = null;
    let generationConfig: Record<string, unknown> | null = null;

    if (assessment.currentVersionId) {
      const { data: currentVersion } = await supabase
        .from('assessment_versions')
        .select('instructions, generation_config')
        .eq('id', assessment.currentVersionId)
        .maybeSingle();

      instructions = currentVersion?.instructions ?? null;
      generationConfig = (currentVersion?.generation_config as Record<string, unknown>) ?? null;
    }

    // Create the new version.
    const { data: newVersion, error: verErr } = await supabase
      .from('assessment_versions')
      .insert({
        assessment_id: assessmentId,
        version_number: nextVersionNumber,
        status: 'draft',
        instructions,
        generation_config: generationConfig,
        total_items: 0,
        total_points: 0,
      })
      .select('id')
      .single();

    if (verErr || !newVersion) {
      return { success: false, error: verErr?.message ?? 'Failed to create version' };
    }

    // Point the assessment at the new version and reset status to draft.
    const { error: updateErr } = await supabase
      .from('assessments')
      .update({
        current_version_id: newVersion.id,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', assessmentId);

    if (updateErr) {
      return { success: false, error: updateErr.message };
    }

    // Deep-copy questions (with choices + answer keys) from the previous version
    // so faculty start from the recent set and can add/edit/delete/import on top.
    let copiedQuestions = 0;
    if (assessment.currentVersionId) {
      const copyResult = await seedVersionQuestions(
        supabase,
        assessment.currentVersionId,
        newVersion.id,
        userId
      );
      if (copyResult.error) {
        return { success: false, error: copyResult.error };
      }
      copiedQuestions = copyResult.copied;
    }

    await refreshVersionTotals(supabase, newVersion.id);

    await recordAuditLog({
      actorUserId: userId,
      action: 'create',
      entityType: 'assessment_version',
      entityId: newVersion.id,
      metadata: {
        assessment_id: assessmentId,
        version_number: nextVersionNumber,
        copied_from: assessment.currentVersionId,
        copied_questions: copiedQuestions,
      },
    });

    revalidateAssessment(assessment.subjectOfferingId, assessmentId);
    return { success: true, versionId: newVersion.id, copiedQuestions };
  } catch {
    return { success: false, error: 'Failed to create new version' };
  }
}

/**
 * Deep-copies questions from `sourceVersionId` into `targetVersionId`,
 * preserving positions, choices, and answer keys (remapping choice ids).
 *
 * Returns `{ copied }` on success or `{ error }` so callers can surface
 * partial failures without throwing past their own result wrappers.
 */
async function seedVersionQuestions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceVersionId: string,
  targetVersionId: string,
  userId: string
): Promise<{ copied: number; error?: string }> {
  const { data: sourceQuestions, error: fetchErr } = await supabase
    .from('questions')
    .select(
      `id, question_type, question_text, difficulty, bloom_level, points, position,
       status, topic_id, image_url, image_storage_path, generation_metadata, is_ai_generated,
       question_choices(id, choice_key, choice_text, position),
       answer_keys(correct_choice_id, canonical_answer, accepted_answers, scoring_config)`
    )
    .eq('assessment_version_id', sourceVersionId)
    .order('position', { ascending: true });

  if (fetchErr) {
    return { copied: 0, error: `Failed to read previous version questions: ${fetchErr.message}` };
  }
  if (!sourceQuestions || sourceQuestions.length === 0) {
    return { copied: 0 };
  }

  let copied = 0;
  for (const sq of sourceQuestions) {
    const q = sq as unknown as {
      question_type: QuestionType;
      question_text: string;
      difficulty: Difficulty;
      bloom_level: BloomLevel;
      points: number;
      position: number;
      status: string;
      topic_id: string | null;
      image_url: string | null;
      image_storage_path: string | null;
      generation_metadata: Record<string, unknown> | null;
      is_ai_generated: boolean;
      question_choices: { id: string; choice_key: string; choice_text: string; position: number }[] | { id: string; choice_key: string; choice_text: string; position: number };
      answer_keys: {
        correct_choice_id: string | null;
        canonical_answer: string | null;
        accepted_answers: string[] | null;
        scoring_config: Record<string, unknown> | null;
      } | {
        correct_choice_id: string | null;
        canonical_answer: string | null;
        accepted_answers: string[] | null;
        scoring_config: Record<string, unknown> | null;
      }[] | null;
    };

    const choices = Array.isArray(q.question_choices)
      ? q.question_choices
      : q.question_choices
        ? [q.question_choices]
        : [];
    const answerKey = Array.isArray(q.answer_keys)
      ? q.answer_keys[0]
      : q.answer_keys;

    const { data: newQ, error: qErr } = await supabase
      .from('questions')
      .insert({
        assessment_version_id: targetVersionId,
        question_type: q.question_type,
        question_text: q.question_text,
        difficulty: q.difficulty,
        bloom_level: q.bloom_level,
        points: q.points,
        position: q.position,
        status: q.status || 'active',
        topic_id: q.topic_id ?? null,
        image_url: q.image_url ?? null,
        image_storage_path: q.image_storage_path ?? null,
        generation_metadata: q.generation_metadata ?? null,
        is_ai_generated: q.is_ai_generated ?? false,
        created_by: userId,
      })
      .select('id')
      .single();

    if (qErr || !newQ) {
      return { copied, error: `Failed to copy question ${q.question_text.slice(0, 40)}: ${qErr?.message ?? 'unknown'}` };
    }

    if (choices.length > 0) {
      const sorted = [...choices].sort((a, b) => a.position - b.position);
      const { data: newChoices, error: cErr } = await supabase
        .from('question_choices')
        .insert(
          sorted.map((c) => ({
            question_id: newQ.id,
            choice_key: c.choice_key,
            choice_text: c.choice_text,
            position: c.position,
          }))
        )
        .select('id, choice_key');

      if (cErr) {
        return { copied, error: `Failed to copy choices: ${cErr.message}` };
      }

      if (answerKey) {
        const oldCorrectId = answerKey.correct_choice_id;
        const oldCorrect = oldCorrectId
          ? sorted.find((c) => c.id === oldCorrectId)
          : undefined;
        const newCorrect = oldCorrect && newChoices
          ? newChoices.find((c) => c.choice_key === oldCorrect.choice_key)
          : undefined;

        const { error: kErr } = await supabase.from('answer_keys').insert({
          question_id: newQ.id,
          correct_choice_id: newCorrect?.id ?? null,
          canonical_answer: answerKey.canonical_answer,
          accepted_answers: answerKey.accepted_answers,
          scoring_config: answerKey.scoring_config,
          updated_by: userId,
        });
        if (kErr) {
          return { copied, error: `Failed to copy answer key: ${kErr.message}` };
        }
      }
    } else if (answerKey) {
      // Identification / TF without choices still carries canonical answer.
      const { error: kErr } = await supabase.from('answer_keys').insert({
        question_id: newQ.id,
        correct_choice_id: null,
        canonical_answer: answerKey.canonical_answer,
        accepted_answers: answerKey.accepted_answers,
        scoring_config: answerKey.scoring_config,
        updated_by: userId,
      });
      if (kErr) {
        return { copied, error: `Failed to copy answer key: ${kErr.message}` };
      }
    }

    copied += 1;
  }

  return { copied };
}

/**
 * Discards a single **draft** version (e.g. an accidental “New version”).
 *
 * Only draft versions are removable — published/approved history and any
 * version that has deployments or attempts stay. When the discarded version
 * is current, the assessment repoints to the next remaining version (if any)
 * and its status is restored from that version so a published assessment is
 * not stuck in draft after a cancelled revision.
 */
export async function deleteAssessmentVersion(
  assessmentId: string,
  versionId: string
): Promise<{ success: boolean; restoredVersionId?: string | null; error?: string }> {
  try {
    const { supabase, userId } = await requireUser();

    const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
    if (!assessment) {
      return { success: false, error: 'Assessment not found or you are not assigned to its offering' };
    }

    const { data: version } = await supabase
      .from('assessment_versions')
      .select('id, status, version_number')
      .eq('id', versionId)
      .eq('assessment_id', assessmentId)
      .maybeSingle();

    if (!version) {
      return { success: false, error: 'Version not found for this assessment' };
    }
    if (version.status !== 'draft') {
      return {
        success: false,
        error: 'Only draft versions can be discarded. Published or approved history is kept.',
      };
    }

    // Guard: a version with deployments/attempts must never be removed.
    const [{ count: depCount }, { count: attemptCount }] = await Promise.all([
      supabase
        .from('assessment_deployments')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_version_id', versionId),
      supabase
        .from('exam_attempts')
        .select('id', { count: 'exact', head: true })
        .eq('assessment_version_id', versionId),
    ]);
    if ((depCount ?? 0) > 0) {
      return { success: false, error: 'This version has deployments — archive or close them before discarding.' };
    }
    if ((attemptCount ?? 0) > 0) {
      return { success: false, error: 'Students have attempts on this version — it cannot be discarded.' };
    }

    const { data: allOthers } = await supabase
      .from('assessment_versions')
      .select('id, status, version_number')
      .eq('assessment_id', assessmentId)
      .neq('id', versionId)
      .order('version_number', { ascending: false });

    if (!allOthers || allOthers.length === 0) {
      return {
        success: false,
        error: 'This is the assessment’s only version. Delete the assessment instead.',
      };
    }

    const isCurrent = assessment.currentVersionId === versionId;
    const nextCurrent = allOthers[0];
    const restoredVersionId = isCurrent ? nextCurrent.id : assessment.currentVersionId;

    if (isCurrent) {
      // Restore assessment status from the version we are falling back to
      // (createNewVersion forces draft; discarding the draft undoes that).
      const restoredStatus =
        nextCurrent.status === 'published'
          ? 'published'
          : nextCurrent.status === 'approved'
            ? 'approved'
            : 'draft';

      const { error: repointErr } = await supabase
        .from('assessments')
        .update({
          current_version_id: nextCurrent.id,
          status: restoredStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', assessmentId);

      if (repointErr) {
        return { success: false, error: repointErr.message };
      }
    }

    // Cascades questions, choices, and answer keys.
    const { error: delErr } = await supabase
      .from('assessment_versions')
      .delete()
      .eq('id', versionId)
      .eq('assessment_id', assessmentId);

    if (delErr) {
      return { success: false, error: delErr.message };
    }

    // Confirm the row is gone (RLS can silently no-op).
    const { data: stillThere } = await supabase
      .from('assessment_versions')
      .select('id')
      .eq('id', versionId)
      .maybeSingle();
    if (stillThere) {
      return { success: false, error: 'Could not discard (RLS blocked the write)' };
    }

    await recordAuditLog({
      actorUserId: userId,
      action: 'delete',
      entityType: 'assessment_version',
      entityId: versionId,
      metadata: {
        assessment_id: assessmentId,
        version_number: version.version_number,
        was_current: isCurrent,
        restored_version_id: isCurrent ? nextCurrent.id : null,
      },
    });

    revalidateAssessment(assessment.subjectOfferingId, assessmentId);
    return { success: true, restoredVersionId };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Failed to discard version',
    };
  }
}

// ---------------------------------------------------------------------------
// Deployment status for assessment detail
// ---------------------------------------------------------------------------

export interface AssessmentDeploymentSummary {
  id: string;
  status: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempt_limit: number;
  version_number: number;
  total_items: number;
  total_points: number;
}

/**
 * Fetches deployments attached to an assessment, for display on the detail page.
 */
export async function getAssessmentDeployments(
  assessmentId: string
): Promise<AssessmentDeploymentSummary[]> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) return [];

  const { data: deployments } = await supabase
    .from('assessment_deployments')
    .select(`
      id,
      status,
      opens_at,
      closes_at,
      duration_minutes,
      attempt_limit,
      assessment_version:assessment_versions(version_number, total_items, total_points)
    `)
    .eq('assessment_id', assessmentId)
    .order('created_at', { ascending: false });

  return (deployments ?? []).map((d: Record<string, unknown>) => {
    const version = d.assessment_version as
      | { version_number?: number; total_items?: number; total_points?: number }
      | null;
    return {
      id: d.id as string,
      status: d.status as string,
      opens_at: d.opens_at as string,
      closes_at: d.closes_at as string,
      duration_minutes: d.duration_minutes as number,
      attempt_limit: d.attempt_limit as number,
      version_number: version?.version_number ?? 0,
      total_items: version?.total_items ?? 0,
      total_points: version?.total_points ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Source traceability
// ---------------------------------------------------------------------------

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

export type TosExportData = import('@/lib/export/tos-doc').TosExportData;

/**
 * Derived Table of Specifications for the assessment's current version:
 * questions grouped by topic × type × difficulty × Bloom level, with summary
 * rollups. Read-only; gated the same way as `getAssessmentDetail`.
 */
export async function getAssessmentTosExport(
  assessmentId: string
): Promise<{ data: TosExportData | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) return { data: null, error: 'Not authorized' };
  if (!assessment.currentVersionId) {
    return { data: null, error: 'This assessment has no current version yet.' };
  }

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('question_type, difficulty, bloom_level, points, topic:topics(title)')
    .eq('assessment_version_id', assessment.currentVersionId);

  if (qErr) return { data: null, error: qErr.message };

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject:subjects(code, title), section:sections(name)')
    .eq('id', assessment.subjectOfferingId)
    .maybeSingle();

  const subject = offering?.subject
    ? Array.isArray(offering.subject)
      ? offering.subject[0]
      : offering.subject
    : null;
  const section = offering?.section
    ? Array.isArray(offering.section)
      ? offering.section[0]
      : offering.section
    : null;
  const subjectLabel = subject
    ? `${subject.code}${section ? ` - ${section.name}` : ''}`
    : null;

  const typeOrder: QuestionType[] = ['multiple_choice', 'identification', 'true_false'];
  const diffOrder: Difficulty[] = ['easy', 'moderate', 'difficult'];
  const bloomOrder: BloomLevel[] = [
    'remember',
    'understand',
    'apply',
    'analyze',
    'evaluate',
    'create',
  ];

  const byType = Object.fromEntries(typeOrder.map((t) => [t, 0])) as Record<QuestionType, number>;
  const byDifficulty = Object.fromEntries(diffOrder.map((d) => [d, 0])) as Record<Difficulty, number>;
  const byBloom = Object.fromEntries(bloomOrder.map((b) => [b, 0])) as Record<BloomLevel, number>;
  const byTopicMap = new Map<string, number>();
  const cellMap = new Map<string, TosExportRow>();

  type TosExportRow = import('@/lib/export/tos-doc').TosExportRow;

  for (const row of (questions ?? []) as Array<{
    question_type: QuestionType;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number | null;
    topic: { title: string } | { title: string }[] | null;
  }>) {
    const topicTitle =
      (Array.isArray(row.topic) ? row.topic[0]?.title : row.topic?.title) ?? 'General';
    const count = 1;

    byType[row.question_type] = (byType[row.question_type] ?? 0) + count;
    byDifficulty[row.difficulty] = (byDifficulty[row.difficulty] ?? 0) + count;
    byBloom[row.bloom_level] = (byBloom[row.bloom_level] ?? 0) + count;
    byTopicMap.set(topicTitle, (byTopicMap.get(topicTitle) ?? 0) + count);

    const key = [topicTitle, row.question_type, row.difficulty, row.bloom_level].join('|');
    const existing = cellMap.get(key);
    if (existing) existing.count += count;
    else {
      cellMap.set(key, {
        topic: topicTitle,
        question_type: row.question_type,
        difficulty: row.difficulty,
        bloom_level: row.bloom_level,
        count,
      });
    }
  }

  const totalItems = (questions ?? []).length;
  const totalPoints = (questions ?? []).reduce((sum, q) => sum + ((q as { points?: number | null }).points ?? 0), 0);

  const rows = [...cellMap.values()].sort((a, b) => {
    const topicCmp = a.topic.localeCompare(b.topic);
    if (topicCmp !== 0) return topicCmp;
    const typeCmp = typeOrder.indexOf(a.question_type) - typeOrder.indexOf(b.question_type);
    if (typeCmp !== 0) return typeCmp;
    const diffCmp = diffOrder.indexOf(a.difficulty) - diffOrder.indexOf(b.difficulty);
    if (diffCmp !== 0) return diffCmp;
    return bloomOrder.indexOf(a.bloom_level) - bloomOrder.indexOf(b.bloom_level);
  });

  return {
    data: {
      assessmentTitle: assessment.title,
      subjectLabel,
      totalItems,
      totalPoints,
      rows,
      byType,
      byDifficulty,
      byBloom,
      byTopic: [...byTopicMap.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => a.topic.localeCompare(b.topic)),
    },
  };
}

/**
 * Import ready-made exam items (pasted or uploaded) into the assessment's
 * **current draft version**. Does NOT replace existing questions — appends
 * after the current max position. Uses the same authz + editability guards
 * as `addQuestion`.
 */
export async function importExamIntoVersion(
  assessmentId: string,
  items: ParsedExamItem[],
  options: { topic_id?: string | null; source_filename?: string } = {}
): Promise<{ imported: number; errors: string[] }> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) {
    throw new Error('Assessment not found or you are not assigned to its offering');
  }
  if (!assessment.currentVersionId) throw new Error('No version found');

  await assertQuestionsEditable(supabase, assessment);

  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('No questions to import');
  }
  if (items.length > 200) {
    throw new Error('Import is limited to 200 questions at a time');
  }

  const versionId = assessment.currentVersionId;
  const topicId = options.topic_id || null;

  if (topicId) {
    const { data: topic } = await supabase
      .from('topics')
      .select('id, subject_id')
      .eq('id', topicId)
      .single();
    const { data: offering } = await supabase
      .from('subject_offerings')
      .select('subject_id')
      .eq('id', assessment.subjectOfferingId)
      .single();
    if (!topic || !offering || topic.subject_id !== offering.subject_id) {
      throw new Error('Invalid topic for this subject');
    }
  }

  const { data: maxPos } = await supabase
    .from('questions')
    .select('position')
    .eq('assessment_version_id', versionId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  let nextPosition = (maxPos?.position || 0) + 1;
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
      const { data: question, error: qErr } = await supabase
        .from('questions')
        .insert({
          assessment_version_id: versionId,
          question_type: item.question_type,
          question_text: text,
          difficulty: item.difficulty || 'moderate',
          bloom_level: item.bloom_level || 'understand',
          points: item.points || 1,
          position: nextPosition,
          status: 'active',
          created_by: userId,
          is_ai_generated: false,
          topic_id: topicId,
          image_url: null,
          image_storage_path: null,
        })
        .select('id')
        .single();

      if (qErr || !question) {
        errors.push(`Item ${i + 1}: ${qErr?.message ?? 'failed to insert'}`);
        continue;
      }

      if (
        (item.question_type === 'multiple_choice' || item.question_type === 'true_false') &&
        item.choices &&
        item.choices.length > 0
      ) {
        const sorted = [...item.choices];
        const { data: choices, error: cErr } = await supabase
          .from('question_choices')
          .insert(
            sorted.map((c, ci) => ({
              question_id: question.id,
              choice_key: c.choice_key,
              choice_text: c.choice_text,
              position: ci,
            }))
          )
          .select('id, choice_key');
        if (cErr) {
          errors.push(`Item ${i + 1}: choices failed (${cErr.message})`);
          imported += 1; // question row exists; faculty can fix choices in editor
          nextPosition += 1;
          continue;
        }

        const correct = item.correct_choice_key
          ? choices?.find((c) => c.choice_key === item.correct_choice_key)
          : undefined;
        if (correct) {
          await supabase.from('answer_keys').insert({
            question_id: question.id,
            correct_choice_id: correct.id,
            updated_by: userId,
          });
        }
      } else if (item.question_type === 'identification' && item.canonical_answer) {
        await supabase.from('answer_keys').insert({
          question_id: question.id,
          canonical_answer: item.canonical_answer,
          accepted_answers: [],
          updated_by: userId,
        });
      }

      imported += 1;
      nextPosition += 1;
    } catch (e) {
      errors.push(`Item ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
    }
  }

  if (imported === 0) {
    throw new Error(errors[0] ?? 'No questions were imported');
  }

  await refreshVersionTotals(supabase, versionId);

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'question',
    entityId: `import-${imported}`,
    metadata: {
      assessment_id: assessmentId,
      version_id: versionId,
      imported_count: imported,
      source_filename: options.source_filename ?? null,
    },
  });

  revalidateAssessment(assessment.subjectOfferingId, assessmentId);

  return { imported, errors };
}
