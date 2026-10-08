'use server';

// Assessment CRUD and the assessment detail read.
// Split out of the former single actions.ts; blocks are unchanged.

import { revalidatePath } from 'next/cache';
import { recordAuditLog } from '@/lib/audit';
import { getFacultyAssessment } from '@/lib/auth';
import type { Assessment, QuestionType, Difficulty, BloomLevel } from '@/lib/types';
import { requireUser, requireOfferingFaculty, isQuestionsLocked, revalidateAssessment } from './shared';
import type { AssessmentDeploymentSummary } from './lifecycle';

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

