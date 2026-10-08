// Shared helpers for the assessment actions. Split out of the former single
// actions.ts; every block is otherwise unchanged.
//
// Deliberately NOT a `use server` module: a `use server` file may only export
// async functions, and revalidateAssessment() is synchronous. Nothing here is
// callable from the client — only the sibling action modules import it.

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isFacultyOfOffering, isFacultyOfSubject, type FacultyAssessment } from '@/lib/auth';

/**
 * Session client + authenticated user id, for the actions below.
 *
 * Authorization is separate and explicit: every mutation resolves the
 * assessment through `getFacultyAssessment`/`getFacultyAssessmentForQuestion`,
 * which fail when the caller is not faculty on the owning offering. RLS still
 * backstops the writes, but an action must not report success for a write RLS
 * silently dropped.
 */
export async function requireUser(): Promise<{
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
export async function requireOfferingFaculty(
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
export async function isQuestionsLocked(
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
export async function assertQuestionsEditable(
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
export async function refreshVersionTotals(
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
export function revalidateAssessment(offeringId: string, assessmentId?: string): void {
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

