'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyOfferingStudents } from '@/lib/notifications';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOffering, isFacultyOfOfferingOrSubject } from '@/lib/auth';
import { scoreAttempt } from '@/lib/scoring';
import type { CreateDeploymentInput, DeploymentLaunchMode } from '@/lib/types';

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

const LAUNCH_MODES = ['now', 'scheduled', 'manual'] as const;

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

    // Deploy only into a section the caller teaches (even for a subject-level
    // assessment, the target offering must be assigned faculty).
    if (!(await isFacultyOfOffering(supabase, user.id, offeringId))) {
      return { success: false, error: 'Not authorized for this subject' };
    }

    const launchMode: DeploymentLaunchMode =
      config.launch_mode && (LAUNCH_MODES as readonly string[]).includes(config.launch_mode)
        ? config.launch_mode
        : 'scheduled';

    if (!Number.isInteger(config.duration_minutes) || config.duration_minutes < 1) {
      return { success: false, error: 'Duration must be at least 1 minute' };
    }
    if (!Number.isInteger(config.attempt_limit) || config.attempt_limit < 1) {
      return { success: false, error: 'The attempt limit must be at least 1' };
    }

    // Resolve the version first: multi-section deploy may omit it and expect
    // the assessment's current version.
    let versionId = config.assessment_version_id;
    const { data: parent } = await supabase
      .from('assessments')
      .select('subject_offering_id, current_version_id, status')
      .eq('id', assessmentId)
      .maybeSingle();

    if (!parent) {
      return { success: false, error: 'Assessment not found' };
    }

    // Only published assessments may go out to students.
    if (parent.status !== 'published') {
      return { success: false, error: 'Only published assessments can be deployed' };
    }

    if (!versionId) {
      versionId = parent.current_version_id ?? '';
      if (!versionId) {
        return { success: false, error: 'Assessment has no deployable version' };
      }
    }

    // The version must belong to this assessment (client payload is untrusted).
    const { data: version } = await supabase
      .from('assessment_versions')
      .select('id, assessment_id')
      .eq('id', versionId)
      .single();

    if (!version || version.assessment_id !== assessmentId) {
      return { success: false, error: 'Selected version does not belong to this assessment' };
    }

    // Cross-section deploy is allowed only within the same subject: the
    // assessment's home offering and the target offering must share a subject.
    const [parentOffering, targetOffering] = await Promise.all([
      supabase.from('subject_offerings').select('subject_id').eq('id', parent.subject_offering_id).maybeSingle(),
      supabase.from('subject_offerings').select('subject_id').eq('id', offeringId).maybeSingle(),
    ]);

    if (
      !parentOffering.data?.subject_id ||
      !targetOffering.data?.subject_id ||
      parentOffering.data.subject_id !== targetOffering.data.subject_id
    ) {
      return { success: false, error: 'Assessment does not belong to this subject' };
    }

    const now = new Date();
    let opensAtIso: string;
    let closesAtIso: string;
    let status: 'draft' | 'scheduled' | 'active';

    if (launchMode === 'manual') {
      // Draft until the faculty opens it; placeholder window satisfies NOT NULL / CHECK.
      opensAtIso = now.toISOString();
      closesAtIso = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
      status = 'draft';
    } else if (launchMode === 'now') {
      if (typeof config.closes_at !== 'string' || !config.closes_at) {
        return { success: false, error: 'Closing time is required' };
      }
      opensAtIso = now.toISOString();
      const nowWindowError = validateWindow(opensAtIso, config.closes_at);
      if (nowWindowError) return { success: false, error: nowWindowError };
      closesAtIso = config.closes_at;
      status = 'active';
    } else {
      if (typeof config.opens_at !== 'string' || typeof config.closes_at !== 'string') {
        return { success: false, error: 'Opening and closing times are required' };
      }
      const windowError = validateWindow(config.opens_at, config.closes_at);
      if (windowError) return { success: false, error: windowError };
      opensAtIso = config.opens_at;
      closesAtIso = config.closes_at;
      status = now >= new Date(opensAtIso) ? 'active' : 'scheduled';
    }

    const { data: deployment, error: insertError } = await supabase
      .from('assessment_deployments')
      .insert({
        assessment_id: assessmentId,
        assessment_version_id: versionId,
        subject_offering_id: offeringId,
        opens_at: opensAtIso,
        closes_at: closesAtIso,
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
        status,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (insertError) {
      return { success: false, error: insertError.message };
    }

    // Notify the class when the exam is deployed (best-effort: a notification
    // failure must not undo a created deployment). Manual drafts stay private
    // until the faculty opens them.
    const { data: assessmentTitle } = await supabase
      .from('assessments')
      .select('title')
      .eq('id', assessmentId)
      .maybeSingle();

    const title = assessmentTitle?.title ?? 'An assessment';
    const opensAt = new Date(opensAtIso);
    const closesAt = new Date(closesAtIso);
    const availableNow = launchMode === 'now' || (launchMode === 'scheduled' && opensAt.getTime() <= Date.now());

    if (launchMode !== 'manual') {
      await notifyOfferingStudents({
        offeringId,
        type: 'assessment_opened',
        title: availableNow ? 'New exam available' : 'New exam scheduled',
        body: availableNow
          ? `${title} is available now until ${closesAt.toLocaleString()} (${config.duration_minutes} min, ${config.attempt_limit} attempt${config.attempt_limit === 1 ? '' : 's'}).`
          : `${title} opens ${opensAt.toLocaleString()} and closes ${closesAt.toLocaleString()} (${config.duration_minutes} min, ${config.attempt_limit} attempt${config.attempt_limit === 1 ? '' : 's'}).`,
        data: { deployment_id: deployment.id, assessment_id: assessmentId },
      });
    }

    await recordAuditLog({
      actorUserId: user.id,
      action: 'create',
      entityType: 'assessment_deployment',
      entityId: deployment.id,
      metadata: {
        assessment_id: assessmentId,
        subject_offering_id: offeringId,
        launch_mode: launchMode,
        status,
        opens_at: opensAtIso,
        closes_at: closesAtIso,
      },
    });

    revalidatePath(`/faculty/subjects/${offeringId}/assessments/${assessmentId}`);
    revalidatePath(`/faculty/subjects/${offeringId}/deployments`);
    revalidatePath('/faculty/subjects/subject/[subjectId]/assessments/[assessmentId]', 'page');
    revalidatePath('/student/assessments');
    revalidatePath('/student');
    revalidatePath('/notifications');

    return { success: true, deploymentId: deployment.id };
  } catch {
    return { success: false, error: 'Failed to create deployment' };
  }
}

/**
 * Open a draft (manual) deployment: stamps opens_at=now, status=active,
 * and notifies the section.
 */
export async function openDeployment(
  deploymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: deployment } = await supabase
      .from('assessment_deployments')
      .select('id, subject_offering_id, assessment_id, status, closes_at')
      .eq('id', deploymentId)
      .single();

    if (!deployment) return { success: false, error: 'Deployment not found' };
    if (!(await isFacultyOfOfferingOrSubject(supabase, user.id, deployment.subject_offering_id))) {
      return { success: false, error: 'Not authorized' };
    }
    if (deployment.status !== 'draft') {
      return { success: false, error: 'Only draft deployments can be opened' };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('assessment_deployments')
      .update({ status: 'active', opens_at: nowIso, updated_at: nowIso })
      .eq('id', deploymentId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle();

    if (updateError) return { success: false, error: updateError.message };
    if (!updated) return { success: false, error: 'Deployment could not be opened' };

    const { data: assessmentTitle } = await supabase
      .from('assessments')
      .select('title')
      .eq('id', deployment.assessment_id)
      .maybeSingle();
    const title = assessmentTitle?.title ?? 'An assessment';
    const closesAt = new Date(deployment.closes_at);

    await notifyOfferingStudents({
      offeringId: deployment.subject_offering_id,
      type: 'assessment_opened',
      title: 'Exam is open',
      body: `${title} is available now until ${closesAt.toLocaleString()}.`,
      data: { deployment_id: deploymentId, assessment_id: deployment.assessment_id },
    });

    await recordAuditLog({
      actorUserId: user.id,
      action: 'update',
      entityType: 'assessment_deployment',
      entityId: deploymentId,
      metadata: { status: 'active', opened_at: nowIso },
    });

    revalidatePath(`/faculty/subjects/${deployment.subject_offering_id}/deployments`);
    revalidatePath('/student/assessments');
    revalidatePath('/student');
    revalidatePath('/notifications');

    return { success: true };
  } catch {
    return { success: false, error: 'Failed to open deployment' };
  }
}

/**
 * Close an open/scheduled/draft deployment now (faculty-controlled close).
 * Stamps closes_at=now so the exam window ends immediately.
 */
export async function closeDeployment(
  deploymentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { success: false, error: 'Unauthorized' };

    const { data: deployment } = await supabase
      .from('assessment_deployments')
      .select('id, subject_offering_id, assessment_id, status')
      .eq('id', deploymentId)
      .single();

    if (!deployment) return { success: false, error: 'Deployment not found' };
    if (!(await isFacultyOfOfferingOrSubject(supabase, user.id, deployment.subject_offering_id))) {
      return { success: false, error: 'Not authorized' };
    }
    if (deployment.status === 'closed' || deployment.status === 'archived') {
      return { success: false, error: 'Deployment is already closed' };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from('assessment_deployments')
      .update({ status: 'closed', closes_at: nowIso, updated_at: nowIso })
      .eq('id', deploymentId)
      .in('status', ['draft', 'scheduled', 'active'])
      .select('id, score_release_mode')
      .maybeSingle();

    if (updateError) return { success: false, error: updateError.message };
    if (!updated) return { success: false, error: 'Deployment could not be closed' };

    // after_all_submitted: closing the window is "everyone is done" — release now.
    if (updated.score_release_mode === 'after_all_submitted') {
      const admin = createAdminClient();
      await admin
        .from('assessment_results')
        .update({
          status: 'released',
          released_at: nowIso,
          released_by: user.id,
          updated_at: nowIso,
        })
        .eq('deployment_id', deploymentId)
        .neq('status', 'released');
    }

    const { data: assessmentTitle } = await supabase
      .from('assessments')
      .select('title')
      .eq('id', deployment.assessment_id)
      .maybeSingle();
    const title = assessmentTitle?.title ?? 'An assessment';

    await notifyOfferingStudents({
      offeringId: deployment.subject_offering_id,
      type: 'assessment_closed',
      title: 'Exam closed',
      body: `${title} is no longer accepting attempts.`,
      data: { deployment_id: deploymentId, assessment_id: deployment.assessment_id },
    });

    await recordAuditLog({
      actorUserId: user.id,
      action: 'update',
      entityType: 'assessment_deployment',
      entityId: deploymentId,
      metadata: { status: 'closed', closed_at: nowIso },
    });

    revalidatePath(`/faculty/subjects/${deployment.subject_offering_id}/deployments`);
    revalidatePath('/student/assessments');
    revalidatePath('/student');

    return { success: true };
  } catch {
    return { success: false, error: 'Failed to close deployment' };
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
      .select('id, created_by, subject_offering_id, assessment_id, opens_at, closes_at')
      .eq('id', deploymentId)
      .single();

    if (!deployment) {
      return { success: false, error: 'Deployment not found' };
    }

    // Any faculty member assigned to the offering or its subject may adjust
    // the deployment, matching who is allowed to create and cancel one.
    if (!(await isFacultyOfOfferingOrSubject(supabase, user.id, deployment.subject_offering_id))) {
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

    const scheduleChanged =
      (typeof config.opens_at === 'string' && config.opens_at !== deployment.opens_at) ||
      (typeof config.closes_at === 'string' && config.closes_at !== deployment.closes_at);

    if (scheduleChanged) {
      const { data: assessmentTitle } = await supabase
        .from('assessments')
        .select('title')
        .eq('id', deployment.assessment_id)
        .maybeSingle();

      const title = assessmentTitle?.title ?? 'Your assessment';
      const opensAt = new Date(typeof config.opens_at === 'string' ? config.opens_at : deployment.opens_at);
      const closesAt = new Date(typeof config.closes_at === 'string' ? config.closes_at : deployment.closes_at);

      await notifyOfferingStudents({
        offeringId: deployment.subject_offering_id,
        type: 'reminder',
        title: 'Exam schedule updated',
        body: `${title} now opens ${opensAt.toLocaleString()} and closes ${closesAt.toLocaleString()}.`,
        data: {
          deployment_id: deploymentId,
          assessment_id: deployment.assessment_id,
        },
      });
    }

    revalidatePath(`/faculty/subjects/${deployment.subject_offering_id}/deployments`);
    revalidatePath('/student/assessments');
    revalidatePath('/student');
    revalidatePath('/notifications');

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
      .select('id, created_by, subject_offering_id, assessment_id, opens_at, closes_at, assessment_version_id')
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

    // Backfill missing result rows: submit used to fail inserting `percentage`
    // (a GENERATED column), so some attempts are submitted with responses
    // scored but no assessment_results row — Release then had nothing to publish.
    const { data: submittedAttempts } = await admin
      .from('exam_attempts')
      .select('id, student_id, status')
      .eq('deployment_id', deploymentId)
      .in('status', ['submitted', 'auto_submitted']);

    for (const attempt of submittedAttempts ?? []) {
      const { data: existing } = await admin
        .from('assessment_results')
        .select('id')
        .eq('attempt_id', attempt.id)
        .maybeSingle();
      if (existing) continue;

      try {
        const { rawScore, possibleScore } = await scoreAttempt(attempt.id, admin);
        await admin.from('assessment_results').insert({
          attempt_id: attempt.id,
          student_id: attempt.student_id,
          deployment_id: deploymentId,
          raw_score: rawScore,
          possible_score: possibleScore || 1,
          status: 'pending',
        });
      } catch {
        // Leave this attempt for a later re-score; keep releasing the rest.
      }
    }

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
        .select('assessment:assessments!assessment_versions_assessment_id_fkey(id, title)')
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

      // Subject name on the notification (same context as notifyOfferingStudents).
      const { data: offeringRow } = await admin
        .from('subject_offerings')
        .select('subject:subjects(code, title), section:sections(name)')
        .eq('id', deployment.subject_offering_id)
        .maybeSingle();
      const subject = (offeringRow?.subject ?? null) as { code?: string; title?: string } | null;
      const section = (offeringRow?.section ?? null) as { name?: string } | null;
      const subjectLabel = subject?.code
        ? subject.title
          ? `${subject.code} - ${subject.title}`
          : subject.code
        : subject?.title ?? null;
      const subjectPrefix = subjectLabel
        ? section?.name
          ? `${subjectLabel} (${section.name}) — `
          : `${subjectLabel} — `
        : '';

      await admin.from('notifications').insert(
        Array.from(byStudent.entries()).map(([studentId, attemptId]) => ({
          user_id: studentId,
          type: 'result_released',
          title: 'Result released',
          body: `${subjectPrefix}Your result for ${title} is now available.`,
          data: {
            deployment_id: deploymentId,
            attempt_id: attemptId,
            assessment_id: assessment?.id ?? null,
            subject_offering_id: deployment.subject_offering_id,
            subject_label: subjectLabel,
            section_name: section?.name ?? null,
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
    revalidatePath('/student/results');
    revalidatePath('/student');
    revalidatePath('/student/assessments');
    revalidatePath('/student/assessments/[assessmentId]', 'page');
    revalidatePath('/notifications');

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

    if (!(await isFacultyOfOfferingOrSubject(supabase, user.id, deployment.subject_offering_id))) {
      return { success: false, error: 'Not authorized' };
    }

    const { data: cancelled, error: updateError } = await supabase
      .from('assessment_deployments')
      .update({
        status: 'closed',
        closes_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', deploymentId)
      .select('id, score_release_mode')
      .maybeSingle();

    if (updateError) {
      return { success: false, error: updateError.message };
    }
    if (!cancelled) {
      return { success: false, error: 'That deployment no longer exists or you cannot modify it' };
    }

    if (cancelled.score_release_mode === 'after_all_submitted') {
      const admin = createAdminClient();
      const closedAt = new Date().toISOString();
      await admin
        .from('assessment_results')
        .update({
          status: 'released',
          released_at: closedAt,
          released_by: user.id,
          updated_at: closedAt,
        })
        .eq('deployment_id', deploymentId)
        .neq('status', 'released');
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
