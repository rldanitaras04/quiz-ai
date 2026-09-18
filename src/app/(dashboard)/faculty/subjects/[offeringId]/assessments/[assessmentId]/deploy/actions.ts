'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
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

    const { data: deployment, error: insertError } = await supabase
      .from('assessment_deployments')
      .insert({
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

    revalidatePath(`/faculty/subjects/${offeringId}/assessments/${assessmentId}`);
    revalidatePath(`/faculty/subjects/${offeringId}/deployments`);

    return { success: true, deploymentId: deployment.id };
  } catch (error) {
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
  } catch (error) {
    return { success: false, error: 'Failed to update deployment' };
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
  } catch (error) {
    return { success: false, error: 'Failed to cancel deployment' };
  }
}
