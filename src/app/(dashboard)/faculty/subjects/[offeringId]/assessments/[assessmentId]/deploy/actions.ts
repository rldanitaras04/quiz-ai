'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyOfferingStudents } from '@/lib/notifications';
import type { CreateDeploymentInput } from '@/lib/types';

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

    const { data: assignment } = await supabase
      .from('faculty_assignments')
      .select('id')
      .eq('subject_offering_id', offeringId)
      .eq('faculty_id', user.id)
      .single();

    if (!assignment) {
      return { success: false, error: 'Not authorized for this subject' };
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

    revalidatePath(`/faculty/subjects/${offeringId}/assessments/${assessmentId}`);
    revalidatePath(`/faculty/subjects/${offeringId}/deployments`);

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

    if (deployment.created_by !== user.id) {
      return { success: false, error: 'Not authorized' };
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

    const { error: updateError } = await supabase
      .from('assessment_deployments')
      .update({
        ...config,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deploymentId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

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

      await admin.from('audit_logs').insert({
        actor_user_id: user.id,
        action: 'release',
        entity_type: 'assessment_deployment',
        entity_id: deploymentId,
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

    if (deployment.created_by !== user.id) {
      return { success: false, error: 'Not authorized' };
    }

    const { error: updateError } = await supabase
      .from('assessment_deployments')
      .update({
        status: 'closed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', deploymentId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    revalidatePath(`/faculty/subjects/${deployment.subject_offering_id}/deployments`);

    return { success: true };
  } catch {
    return { success: false, error: 'Failed to cancel deployment' };
  }
}
