'use server';

// Approval, publish state and deployment summary.
// Split out of the former single actions.ts; blocks are unchanged.

import { revalidatePath } from 'next/cache';
import { notifyOfferingStudents } from '@/lib/notifications';
import { recordAuditLog } from '@/lib/audit';
import { getFacultyAssessment } from '@/lib/auth';
import type { TosRow } from '@/lib/types';
import { tosMarginals } from '@/lib/ai/tos';
import { requireUser, revalidateAssessment } from './shared';

export async function approveAssessment(
  assessmentId: string,
  tos?: { rows: TosRow[] } | null
) {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) throw new Error('Assessment not found or you are not assigned to its offering');
  if (!assessment.currentVersionId) throw new Error('No version found');

  // Scope §10: preserve the approved TOS with the assessment version. Built
  // server-side from the approved rows so totals/distributions are computed
  // from the same pure helpers the wizard validated against.
  const tosSnapshot =
    tos && Array.isArray(tos.rows) && tos.rows.length > 0
      ? {
          version: 1,
          status: 'approved' as const,
          approved_by: userId,
          approved_at: new Date().toISOString(),
          rows: tos.rows,
          total_items: tosMarginals(tos.rows).totalItems,
          distributions: (() => {
            const m = tosMarginals(tos.rows);
            return {
              by_type: m.byType,
              by_difficulty: m.byDifficulty,
              by_bloom: m.byBloom,
              by_topic: m.byTopic,
            };
          })(),
        }
      : null;

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
      // Only written when a TOS was supplied — re-approvals without one keep
      // the historical snapshot instead of clearing it.
      ...(tosSnapshot ? { tos_snapshot: tosSnapshot } : {}),
    })
    .eq('id', assessment.currentVersionId);
  if (verErr) throw new Error(verErr.message);

  await recordAuditLog({
    actorUserId: userId,
    action: 'approve',
    entityType: 'assessment',
    entityId: assessmentId,
    metadata: {
      title: assessment.title,
      ...(tosSnapshot ? { tos_total_items: tosSnapshot.total_items } : {}),
    },
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

