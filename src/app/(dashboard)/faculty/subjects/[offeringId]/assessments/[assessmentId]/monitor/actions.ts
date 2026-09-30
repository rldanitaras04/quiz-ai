'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOfferingOrSubject } from '@/lib/auth';
import { closeActiveSession, recordExamEvent } from '@/lib/exam-session';

/**
 * Faculty controls for the Live Exam Monitor.
 *
 * Every action: caller session → authorization against the offering the
 * workspace belongs to → attempt must belong to that offering's deployment →
 * mutation through the service-role client (students have no write access to
 * attempts/sessions) → audit log + a factual exam event for the student's
 * timeline. Nothing here auto-submits or scores anything.
 */

interface AttemptContext {
  attemptId: string;
  studentId: string;
  deploymentId: string;
  status: string;
  expiresAt: string;
  offeringId: string;
  assessmentId: string;
}

type ActionResult = { success: boolean; error?: string; value?: string };

async function authorizeAttempt(
  attemptId: string,
  offeringId: string,
  assessmentId: string
): Promise<{ context?: AttemptContext; userId?: string; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Unauthorized' };

  if (!(await isFacultyOfOfferingOrSubject(supabase, user.id, offeringId))) {
    return { error: 'Not authorized for this subject' };
  }

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('id, student_id, deployment_id, status, expires_at')
    .eq('id', attemptId)
    .maybeSingle();

  if (!attempt) return { error: 'Attempt not found' };

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id, assessment_id')
    .eq('id', attempt.deployment_id)
    .maybeSingle();

  // The attempt must belong to THIS workspace: matching offering and the
  // assessment the monitor page was opened for.
  if (
    !deployment ||
    deployment.subject_offering_id !== offeringId ||
    deployment.assessment_id !== assessmentId
  ) {
    return { error: 'That attempt does not belong to this assessment' };
  }

  return {
    userId: user.id,
    context: {
      attemptId: attempt.id,
      studentId: attempt.student_id,
      deploymentId: attempt.deployment_id,
      status: attempt.status,
      expiresAt: attempt.expires_at,
      offeringId,
      assessmentId,
    },
  };
}

function revalidateMonitor(ctx: AttemptContext) {
  revalidatePath(
    `/faculty/subjects/${ctx.offeringId}/assessments/${ctx.assessmentId}/monitor`
  );
}

/**
 * Extend the attempt deadline. The student's next heartbeat (≤20s) returns the
 * new `expires_at`, so the running exam picks it up without a reload.
 */
export async function grantExtraTime(input: {
  attemptId: string;
  offeringId: string;
  assessmentId: string;
  minutes: number;
}): Promise<ActionResult> {
  try {
    const minutes = Math.floor(Number(input.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
      return { success: false, error: 'Extra time must be between 1 and 240 minutes' };
    }

    const auth = await authorizeAttempt(input.attemptId, input.offeringId, input.assessmentId);
    if (!auth.context) return { success: false, error: auth.error ?? 'Not authorized' };
    const ctx = auth.context;

    if (ctx.status !== 'in_progress') {
      return { success: false, error: 'Only an in-progress attempt can be extended' };
    }

    // Extend from the later of (current deadline, now) so an already-expired
    // deadline still yields the full requested extension.
    const base = Math.max(Date.now(), new Date(ctx.expiresAt).getTime());
    const newExpiresAt = new Date(base + minutes * 60_000).toISOString();

    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from('exam_attempts')
      .update({ expires_at: newExpiresAt, updated_at: new Date().toISOString() })
      .eq('id', ctx.attemptId)
      .eq('status', 'in_progress')
      .select('id')
      .maybeSingle();

    if (error || !updated) {
      return { success: false, error: 'Could not extend the attempt' };
    }

    await recordExamEvent(admin, {
      attemptId: ctx.attemptId,
      studentId: ctx.studentId,
      deploymentId: ctx.deploymentId,
      eventType: 'faculty_intervention',
      metadata: { action: 'extra_time', minutes },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_attempt',
        entityId: ctx.attemptId,
        metadata: { intervention: 'grant_extra_time', minutes, new_expires_at: newExpiresAt },
      });
    }

    revalidateMonitor(ctx);
    return { success: true, value: newExpiresAt };
  } catch {
    return { success: false, error: 'Failed to grant extra time' };
  }
}

/**
 * Allow this attempt to be resumed (recovery) — e.g. after the student
 * switches devices or their session was blocked by the concurrent-session
 * policy.
 */
export async function allowSessionRecovery(input: {
  attemptId: string;
  offeringId: string;
  assessmentId: string;
}): Promise<ActionResult> {
  try {
    const auth = await authorizeAttempt(input.attemptId, input.offeringId, input.assessmentId);
    if (!auth.context) return { success: false, error: auth.error ?? 'Not authorized' };
    const ctx = auth.context;

    const admin = createAdminClient();
    const { data: session } = await admin
      .from('exam_sessions')
      .select('id')
      .eq('attempt_id', ctx.attemptId)
      .eq('status', 'active')
      .maybeSingle();

    if (!session) {
      return { success: false, error: 'There is no active session for this attempt' };
    }

    const { error } = await admin
      .from('exam_sessions')
      .update({ allow_recovery: true, updated_at: new Date().toISOString() })
      .eq('id', session.id);

    if (error) return { success: false, error: 'Could not update the session' };

    await recordExamEvent(admin, {
      attemptId: ctx.attemptId,
      studentId: ctx.studentId,
      deploymentId: ctx.deploymentId,
      examSessionId: session.id,
      eventType: 'faculty_intervention',
      metadata: { action: 'allow_recovery' },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_session',
        entityId: session.id,
        metadata: { intervention: 'allow_recovery', attempt_id: ctx.attemptId },
      });
    }

    revalidateMonitor(ctx);
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to allow recovery' };
  }
}

/**
 * Ask the student to re-enter their password. The flag is picked up by their
 * next heartbeat (≤20s), which opens a blocking reverification gate in the
 * exam shell; a failed re-entry is recorded as a critical event.
 */
export async function requireReverification(input: {
  attemptId: string;
  offeringId: string;
  assessmentId: string;
}): Promise<ActionResult> {
  try {
    const auth = await authorizeAttempt(input.attemptId, input.offeringId, input.assessmentId);
    if (!auth.context) return { success: false, error: auth.error ?? 'Not authorized' };
    const ctx = auth.context;

    const admin = createAdminClient();
    const { data: session } = await admin
      .from('exam_sessions')
      .select('id')
      .eq('attempt_id', ctx.attemptId)
      .eq('status', 'active')
      .maybeSingle();

    if (!session) {
      return { success: false, error: 'There is no active session for this attempt' };
    }

    const { error } = await admin
      .from('exam_sessions')
      .update({ reverification_required: true, updated_at: new Date().toISOString() })
      .eq('id', session.id);

    if (error) return { success: false, error: 'Could not flag the session' };

    await recordExamEvent(admin, {
      attemptId: ctx.attemptId,
      studentId: ctx.studentId,
      deploymentId: ctx.deploymentId,
      examSessionId: session.id,
      eventType: 'identity_reverification_required',
      metadata: { trigger: 'faculty' },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_session',
        entityId: session.id,
        metadata: { intervention: 'require_reverification', attempt_id: ctx.attemptId },
      });
    }

    revalidateMonitor(ctx);
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to require reverification' };
  }
}

/**
 * Terminate an in-progress attempt. The attempt becomes `invalidated`, the
 * active session closes, and the student's heartbeat reports the termination
 * within one tick (≤20s) — the exam shell then stops accepting answers.
 * Never scores, never releases results.
 */
export async function terminateAttempt(input: {
  attemptId: string;
  offeringId: string;
  assessmentId: string;
}): Promise<ActionResult> {
  try {
    const auth = await authorizeAttempt(input.attemptId, input.offeringId, input.assessmentId);
    if (!auth.context) return { success: false, error: auth.error ?? 'Not authorized' };
    const ctx = auth.context;

    if (ctx.status !== 'in_progress') {
      return { success: false, error: 'Only an in-progress attempt can be terminated' };
    }

    const admin = createAdminClient();
    const { data: updated, error } = await admin
      .from('exam_attempts')
      .update({
        status: 'invalidated',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', ctx.attemptId)
      .eq('status', 'in_progress')
      .select('id')
      .maybeSingle();

    if (error || !updated) {
      return { success: false, error: 'Could not terminate the attempt' };
    }

    await closeActiveSession(admin, ctx.attemptId, 'terminated');

    await recordExamEvent(admin, {
      attemptId: ctx.attemptId,
      studentId: ctx.studentId,
      deploymentId: ctx.deploymentId,
      eventType: 'attempt_terminated',
      metadata: { actor: 'faculty' },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_attempt',
        entityId: ctx.attemptId,
        metadata: { intervention: 'terminate_attempt', student_id: ctx.studentId },
      });
    }

    revalidateMonitor(ctx);
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to terminate the attempt' };
  }
}
