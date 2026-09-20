'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyOfferingStudents } from '@/lib/notifications';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOffering } from '@/lib/auth';
import type { CreateDeploymentInput } from '@/lib/types';

/** Fields a client may set on an existing deployment (everything else is fixed). */
const UPDATABLE_CONFIG_KEYS: readonly (keyof CreateDeploymentInput)[] = [
  'assessment_version_id',
  'opens_at',
  'closes_at',
  'duration_minutes',
  'attempt_limit',
  'question_order_mode',
  'choice_order_mode',
  'score_release_mode',
  'show_raw_score',
  'show_percentage',
  'show_item_correctness',
  'show_correct_answers',
  'show_explanations',
  'requires_identity_verification',
];

/** Shared validation for the scheduling window. */
function validateWindow(opensAt: string, closesAt: string): string | null {
  const opens = new Date(opensAt);
  const closes = new Date(closesAt);
  if (Number.isNaN(opens.getTime()) || Number.isNaN(closes.getTime())) {
    return 'Enter a valid opening and closing time';
  }
  if (closes <= opens) return 'The closing time must be after the opening time';
  return null;
}

export async function createDeployment(
  assessmentId: string,
  offeringId: string,
  config: CreateDeploymentInput
): Promise<{ success: boolean; deploymentId?: string; error?: string }> {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    if (!(await isFacultyOfOffering(supabase, user.id, offeringId))) {
      return { success: false, error: 'Not authorized for this subject' };
    }

    const windowError = validateWindow(config.opens_at, config.closes_at);
    if (windowError) return { success: false, error: windowError };
    if (!Number.isInteger(config.duration_minutes) || config.duration_minutes < 1) {
      return { success: false, error: 'Duration must be at least 1 minute' };
    }
    if (!Number.isInteger(config.attempt_limit) || config.attempt_limit < 1) {
      return { success: false, error: 'The attempt limit must be at least 1' };
    }

    // The version must belong to this assessment (client payload is untrusted).
    const { data: version } = await supabase
      .from('assessment_versions')
      .select('id, assessment_id')
      .eq('id', config.assessment_version_id)
      .single();

    if (!version || version.assessment_id !== assessmentId) {
      return { success: false, error: 'Selected version does not belong to this assessment' };
    }

    // The assessment must live in this offering too, so a deployment can never
    // straddle two offerings.
    const { data: parent } = await supabase
      .from('assessments')
      .select('subject_offering_id')
      .eq('id', assessmentId)
      .maybeSingle();

    if (!parent || parent.subject_offering_id !== offeringId) {
      return { success: false, error: 'Assessment does not belong to this subject offering' };
    }

    const { data: deployment, error: insertError } = await supabase
      .from('assessment_deployments')
      .insert({
        assessment_id: assessmentId,
        assessment_version_id: config.assessment_version_id,
        subject_offering_id: offeringId,
        opens_at: config.opens_at,
        closes_at: config.closes_at,
        duration_minutes: config.duration_minutes,
        attempt_limit: config.attempt_limit,
        question_order_mode: config.question_order_mode,
        choice_order_mode: config.choice_order_mode,
        score_release_mode: config.score_release_mode,
        show_raw_score: config.show_raw_score,
        show_percentage: config.show_percentage,
        show_item_correctness: config.show_item_correctness,
        show_correct_answers: config.show_correct_answers,
        show_explanations: config.show_explanations,
        requires_identity_verification: config.requires_identity_verification,
        status: 'scheduled',
        created_by: user.id,
      })
      .select('id')
      .single();

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    // Notify the class about the schedule (best-effort: a notification failure
    // must not undo a created deployment).
    const { data: assessmentTitle } = await supabase
      .from('assessments')
      .select('title')
      .eq('id', assessmentId)
      .maybeSingle();

    await notifyOfferingStudents({
      offeringId,
      type: 'assessment_opened',
      title: 'New assessment scheduled',
      body: `${assessmentTitle?.title ?? 'An assessment'} opens ${new Date(config.opens_at).toLocaleString()} and closes ${new Date(config.closes_at).toLocaleString()}.`,
      data: { deployment_id: deployment.id, assessment_id: assessmentId },
    });

    await recordAuditLog({
      actorUserId: user.id,
      action: 'create',
      entityType: 'assessment_deployment',
      entityId: deployment.id,
      metadata: {
        assessment_id: assessmentId,
        subject_offering_id: offeringId,
        opens_at: config.opens_at,
        closes_at: config.closes_at,
      },
    });

    revalidatePath(`/faculty/subjects/${offeringId}/assessments/${assessmentId}`);
    revalidatePath(`/faculty/subjects/${offeringId}/deployments`);
    revalidatePath('/student/assessments');

    return { success: true, deploymentId: deployment.id };
  } catch {
    return { success: false, error: 'Failed to create deployment' };
  }
}

export async function updateDeployment(
  deploymentId: string,
  config: Partial<CreateDeploymentInput>
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data: deployment } = await supabase
      .from('assessment_deployments')
      .select('id, created_by, subject_offering_id')
      .eq('id', deploymentId)
      .single();

    if (!deployment) {
      return { success: false, error: 'Deployment not found' };
    }

    // Any faculty member assigned to the offering may adjust the deployment,
    // matching who is allowed to create and cancel one.
    if (!(await isFacultyOfOffering(supabase, user.id, deployment.subject_offering_id))) {
      return { success: false, error: 'Not authorized' };
    }

    // Only the schedulable fields are writable: spreading the raw payload would
    // let a caller move the deployment to another offering or assessment, or
    // flip its status directly.
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    for (const key of UPDATABLE_CONFIG_KEYS) {
      if (config[key] !== undefined) updates[key] = config[key];
    }

    if (typeof config.opens_at === 'string' && typeof config.closes_at === 'string') {
      const windowError = validateWindow(config.opens_at, config.closes_at);
      if (windowError) return { success: false, error: windowError };
    }

    if (config.assessment_version_id) {
      // The version must belong to the deployment's assessment.
      const { data: version } = await supabase
        .from('assessment_versions')
        .select('assessment_id')
        .eq('id', config.assessment_version_id)
        .single();

      const { data: currentDeployment } = await supabase
        .from('assessment_deployments')
        .select('assessment_id')
        .eq('id', deploymentId)
        .single();

      if (!version || !currentDeployment || version.assessment_id !== currentDeployment.assessment_id) {
        return { success: false, error: 'Selected version does not belong to this assessment' };
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('assessment_deployments')
      .update(updates)
      .eq('id', deploymentId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      return { success: false, error: updateError.message };
    }
    if (!updated) {
      return { success: false, error: 'That deployment no longer exists or you cannot modify it' };
    }

    await recordAuditLog({
      actorUserId: user.id,
      action: 'update',
      entityType: 'assessment_deployment',
      entityId: deploymentId,
      metadata: { fields: Object.keys(updates) },
    });

    revalidatePath(`/faculty/subjects/${deployment.subject_offering_id}/deployments`);

    return { success: true };
  } catch {
    return { success: false, error: 'Failed to update deployment' };
  }
}

/**
 * Release every scored-but-unreleased result for a deployment, per the
 * deployment's score-release policy ("manual release" / "after close" modes
 * had no implementation, so results produced by anything other than
 * `score_release_mode = 'immediate'` could never reach students).
 *
 * Runs with the service-role client because it must write `released_by`, and
 * insert notifications + audit rows — none of which the authenticated role may
 * write (see the REVOKEs in the security hardening migration). Authorization is
 * verified with the caller's own session first.
 */
export async function releaseResults(
  deploymentId: string
): Promise<{ success: boolean; released?: number; error?: string }> {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data: deployment } = await supabase
      .from('assessment_deployments')
      .select('id, subject_offering_id, assessment_version_id')
      .eq('id', deploymentId)
      .single();

    if (!deployment) {
      return { success: false, error: 'Deployment not found' };
    }

    const { data: assignment } = await supabase
      .from('faculty_assignments')
      .select('id')
      .eq('subject_offering_id', deployment.subject_offering_id)
      .eq('faculty_id', user.id)
      .maybeSingle();

    if (!assignment) {
      return { success: false, error: 'Not authorized for this offering' };
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: released, error: releaseError } = await admin
      .from('assessment_results')
      .update({
        status: 'released',
        released_at: now,
        released_by: user.id,
        updated_at: now,
      })
      .eq('deployment_id', deploymentId)
      .neq('status', 'released')
      .select('attempt_id, student_id');

    if (releaseError) {
      return { success: false, error: releaseError.message };
    }

    const rows = released ?? [];

    if (rows.length > 0) {
      const { data: assessmentVersion } = await admin
        .from('assessment_versions')
        .select('assessment:assessments(id, title)')
        .eq('id', deployment.assessment_version_id)
        .maybeSingle();

      const assessment = (assessmentVersion?.assessment ?? null) as
        | { id?: string; title?: string }
        | null;
      const title = assessment?.title ?? 'Your assessment';

      // One notification per student, even when they have several attempts.
      const byStudent = new Map<string, string>();
      for (const row of rows) {
        if (!byStudent.has(row.student_id)) byStudent.set(row.student_id, row.attempt_id);
      }

      await admin.from('notifications').insert(
        Array.from(byStudent.entries()).map(([studentId, attemptId]) => ({
          user_id: studentId,
          type: 'result_released',
          title: 'Result released',
          body: `Your result for ${title} is now available.`,
          data: {
            deployment_id: deploymentId,
            attempt_id: attemptId,
            assessment_id: assessment?.id ?? null,
          },
        }))
      );

      await recordAuditLog({
        actorUserId: user.id,
        action: 'release',
        entityType: 'assessment_deployment',
        entityId: deploymentId,
        metadata: { released_count: rows.length },
      });
    }

    revalidatePath(`/faculty/subjects/${deployment.subject_offering_id}/deployments`);

    return { success: true, released: rows.length };
  } catch {
    return { success: false, error: 'Failed to release results' };
  }
}

export async function cancelDeployment(
  deploymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: 'Unauthorized' };
    }

    const { data: deployment } = await supabase
      .from('assessment_deployments')
      .select('id, created_by, subject_offering_id')
      .eq('id', deploymentId)
      .single();

    if (!deployment) {
      return { success: false, error: 'Deployment not found' };
    }

    if (!(await isFacultyOfOffering(supabase, user.id, deployment.subject_offering_id))) {
      return { success: false, error: 'Not authorized' };
    }

    const { data: cancelled, error: updateError } = await supabase
      .from('assessment_deployments')
      .update({
        status: 'closed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deploymentId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      return { success: false, error: updateError.message };
    }
    if (!cancelled) {
      return { success: false, error: 'That deployment no longer exists or you cannot modify it' };
    }

    await recordAuditLog({
      actorUserId: user.id,
      action: 'update',
      entityType: 'assessment_deployment',
      entityId: deploymentId,
      metadata: { status: 'closed' },
    });

    revalidatePath(`/faculty/subjects/${deployment.subject_offering_id}/deployments`);
    revalidatePath('/student/assessments');

    return { success: true };
  } catch {
    return { success: false, error: 'Failed to cancel deployment' };
  }
}
