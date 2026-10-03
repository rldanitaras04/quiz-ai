'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOfferingOrSubject, isProctorOfDeployment } from '@/lib/auth';
import { closeActiveSession, recordExamEvent } from '@/lib/exam-session';
import { conclusionPlanFor } from '@/lib/conclude';
import { closeDeploymentWindow, finalizeAttemptScoring } from '@/lib/submission';
import { notifyOfferingStudents } from '@/lib/notifications';

/**
 * Faculty (and proctor) controls for the Live Exam Monitor.
 *
 * Every action: caller session → authorization against the offering the
 * workspace belongs to OR a proctor row on the attempt's own deployment
 * (scope §42) → attempt must belong to that offering's deployment → mutation
 * through the service-role client (students have no write access to
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

/** Who is intervening — recorded on every event and audit row they cause. */
export type MonitorActorRole = 'faculty' | 'proctor';

async function authorizeAttempt(
  attemptId: string,
  offeringId: string,
  assessmentId: string
): Promise<{
  context?: AttemptContext;
  userId?: string;
  actorRole?: MonitorActorRole;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Unauthorized' };

  // Faculty of the offering (or its subject) may always intervene. Anyone
  // else resolves below through RLS + an explicit proctor check: without a
  // proctor row on the attempt's deployment both queries above return null,
  // so the errors read the same as for an unknown attempt.
  const faculty = await isFacultyOfOfferingOrSubject(
    supabase,
    user.id,
    offeringId
  );

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

  let actorRole: MonitorActorRole = 'faculty';
  if (!faculty) {
    if (
      !(await isProctorOfDeployment(supabase, user.id, attempt.deployment_id))
    ) {
      return { error: 'Not authorized for this subject' };
    }
    actorRole = 'proctor';
  }

  return {
    userId: user.id,
    actorRole,
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

function revalidateMonitorPath(offeringId: string, assessmentId: string) {
  revalidatePath(
    `/faculty/subjects/${offeringId}/assessments/${assessmentId}/monitor`
  );
}

function revalidateMonitor(ctx: AttemptContext) {
  revalidateMonitorPath(ctx.offeringId, ctx.assessmentId);
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
      metadata: { action: 'extra_time', minutes, actor_role: auth.actorRole },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_attempt',
        entityId: ctx.attemptId,
        metadata: {
          intervention: 'grant_extra_time',
          minutes,
          new_expires_at: newExpiresAt,
          actor_role: auth.actorRole,
        },
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
      metadata: { action: 'allow_recovery', actor_role: auth.actorRole },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_session',
        entityId: session.id,
        metadata: {
          intervention: 'allow_recovery',
          attempt_id: ctx.attemptId,
          actor_role: auth.actorRole,
        },
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
      metadata: { trigger: 'faculty', actor_role: auth.actorRole },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_session',
        entityId: session.id,
        metadata: {
          intervention: 'require_reverification',
          attempt_id: ctx.attemptId,
          actor_role: auth.actorRole,
        },
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
      metadata: { actor: auth.actorRole ?? 'faculty' },
    });

    if (auth.userId) {
      await recordAuditLog({
        actorUserId: auth.userId,
        action: 'update',
        entityType: 'exam_attempt',
        entityId: ctx.attemptId,
        metadata: {
          intervention: 'terminate_attempt',
          student_id: ctx.studentId,
          actor_role: auth.actorRole,
        },
      });
    }

    revalidateMonitor(ctx);
    return { success: true };
  } catch {
    return { success: false, error: 'Failed to terminate the attempt' };
  }
}

// ---------------------------------------------------------------------------
// Concluding (scope §42): conclude = submit & score, never a penalty.
// Terminating (above) stays the separate integrity action.
// ---------------------------------------------------------------------------

/**
 * Deployment-level gate for actions that affect the whole sitting
 * (conclude-all + its optional window close). Same split as `authorizeAttempt`:
 * faculty of the offering/subject, or an explicit proctor row on this very
 * deployment — `actor_role` comes back so every write below is tagged with
 * who actually acted.
 */
async function authorizeDeployment(
  deploymentId: string,
  offeringId: string,
  assessmentId: string
): Promise<{
  userId?: string;
  actorRole?: MonitorActorRole;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Unauthorized' };

  const faculty = await isFacultyOfOfferingOrSubject(
    supabase,
    user.id,
    offeringId
  );

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id, assessment_id')
    .eq('id', deploymentId)
    .maybeSingle();

  if (
    !deployment ||
    deployment.subject_offering_id !== offeringId ||
    deployment.assessment_id !== assessmentId
  ) {
    return { error: 'That exam does not belong to this assessment' };
  }

  if (
    !faculty &&
    !(await isProctorOfDeployment(supabase, user.id, deploymentId))
  ) {
    return { error: 'Not authorized for this subject' };
  }

  return { userId: user.id, actorRole: faculty ? 'faculty' : 'proctor' };
}

/**
 * Finalize one in-progress attempt as a submission: conditional transition
 * (safe alongside a concurrent self-submit), session close, intervention +
 * submission events, audit row, then the shared scoring pipeline
 * (`finalizeAttemptScoring` — identical to what the student's own Submit does).
 *
 * Assumes authorization and the `in_progress` check already happened. Runs
 * entirely through the service-role client. Returns `ok: false` when the
 * attempt was no longer in progress (raced submit), `scored: false` when
 * scoring failed after a successful submission — which is never rolled back.
 */
async function concludeAttemptInternal(
  ctx: AttemptContext,
  actorUserId: string,
  actorRole: MonitorActorRole
): Promise<{ ok: boolean; error?: string; scored?: boolean }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // Shared rule with the student's own Submit (scope §42 conclude): a conclude
  // past the deadline records the expiry, not a manual turn-in.
  const plan = conclusionPlanFor(ctx.expiresAt, now);

  const { data: updated, error } = await admin
    .from('exam_attempts')
    .update({
      status: plan.status,
      submitted_at: now,
      updated_at: now,
    })
    .eq('id', ctx.attemptId)
    .eq('status', 'in_progress')
    .select('id')
    .maybeSingle();

  if (error || !updated) {
    return {
      ok: false,
      error: 'Could not conclude the attempt (it may have just been submitted)',
    };
  }

  await closeActiveSession(admin, ctx.attemptId, plan.sessionCloseReason);

  // Reused event types (no CHECK migration): the intervention record says who
  // concluded and why, the ordinary submission entry keeps the student's
  // timeline identical to a self-submission.
  await recordExamEvent(admin, {
    attemptId: ctx.attemptId,
    studentId: ctx.studentId,
    deploymentId: ctx.deploymentId,
    eventType: 'faculty_intervention',
    metadata: { action: 'conclude_attempt', actor_role: actorRole },
  });
  await recordExamEvent(admin, {
    attemptId: ctx.attemptId,
    studentId: ctx.studentId,
    deploymentId: ctx.deploymentId,
    eventType: 'submission_completed',
    metadata: { auto_submitted: plan.autoSubmitted, concluded_by: actorRole },
  });

  await recordAuditLog({
    actorUserId,
    action: 'update',
    entityType: 'exam_attempt',
    entityId: ctx.attemptId,
    metadata: {
      intervention: 'conclude_attempt',
      student_id: ctx.studentId,
      actor_role: actorRole,
      auto_submitted: plan.autoSubmitted,
    },
  });

  try {
    await finalizeAttemptScoring(admin, {
      attemptId: ctx.attemptId,
      studentId: ctx.studentId,
      deploymentId: ctx.deploymentId,
      now,
      autoSubmitted: plan.autoSubmitted,
    });
    return { ok: true, scored: true };
  } catch (scoringError) {
    console.error('Scoring failed after conclude:', scoringError);
    return { ok: true, scored: false };
  }
}

/**
 * Conclude ONE student's attempt (scope §42): finalize it as a submission,
 * score saved answers, release according to the deployment's policy. Never
 * invalidates work. Available to the offering's faculty AND assigned proctors.
 */
export async function concludeAttempt(input: {
  attemptId: string;
  offeringId: string;
  assessmentId: string;
}): Promise<ActionResult> {
  try {
    const auth = await authorizeAttempt(
      input.attemptId,
      input.offeringId,
      input.assessmentId
    );
    if (!auth.context || !auth.userId || !auth.actorRole) {
      return { success: false, error: auth.error ?? 'Not authorized' };
    }
    const ctx = auth.context;

    if (ctx.status !== 'in_progress') {
      return { success: false, error: 'Only an in-progress attempt can be concluded' };
    }

    const outcome = await concludeAttemptInternal(
      ctx,
      auth.userId,
      auth.actorRole
    );
    if (!outcome.ok) {
      return { success: false, error: outcome.error ?? 'Could not conclude the attempt' };
    }

    revalidateMonitor(ctx);
    // `value` distinguishes "scored" from "submitted but scoring failed" so
    // the monitor can say exactly what happened (submission is not undone).
    return outcome.scored === false ? { success: true, value: 'scoring_failed' } : { success: true };
  } catch {
    return { success: false, error: 'Failed to conclude the attempt' };
  }
}

/**
 * Conclude the exam for ALL students in this deployment (scope §42): every
 * in-progress attempt is finalized and scored, and — optionally — the
 * deployment window is closed so no new attempt can start (same close +
 * `after_all_submitted` release the faculty Close action performs).
 */
export async function concludeAllAttempts(input: {
  deploymentId: string;
  offeringId: string;
  assessmentId: string;
  closeWindow: boolean;
}): Promise<ActionResult> {
  try {
    const auth = await authorizeDeployment(
      input.deploymentId,
      input.offeringId,
      input.assessmentId
    );
    if (!auth.userId || !auth.actorRole) {
      return { success: false, error: auth.error ?? 'Not authorized' };
    }
    const actorUserId = auth.userId;
    const actorRole = auth.actorRole;

    const admin = createAdminClient();
    const { data: attempts, error: listError } = await admin
      .from('exam_attempts')
      .select('id, student_id, status, expires_at')
      .eq('deployment_id', input.deploymentId)
      .eq('status', 'in_progress');

    if (listError) return { success: false, error: listError.message };

    const now = new Date().toISOString();
    let concluded = 0;
    let raced = 0;
    let scored = true;

    for (const row of attempts ?? []) {
      const outcome = await concludeAttemptInternal(
        {
          attemptId: row.id,
          studentId: row.student_id,
          deploymentId: input.deploymentId,
          status: row.status,
          expiresAt: row.expires_at,
          offeringId: input.offeringId,
          assessmentId: input.assessmentId,
        },
        actorUserId,
        actorRole
      );
      if (outcome.ok) {
        concluded += 1;
        if (outcome.scored === false) scored = false;
      } else {
        raced += 1;
      }
    }

    // Optional window close so no new attempt can start (§42). A concurrent
    // faculty close resolving to "already closed" is not an error.
    let windowClosed = false;
    if (input.closeWindow) {
      const closed = await closeDeploymentWindow(
        admin,
        input.deploymentId,
        actorUserId,
        now
      );
      if (closed.ok) {
        windowClosed = true;

        const { data: assessmentTitle } = await admin
          .from('assessments')
          .select('title')
          .eq('id', input.assessmentId)
          .maybeSingle();

        await notifyOfferingStudents({
          offeringId: input.offeringId,
          type: 'assessment_closed',
          title: 'Exam closed',
          body: `${assessmentTitle?.title ?? 'An assessment'} is no longer accepting attempts.`,
          data: {
            deployment_id: input.deploymentId,
            assessment_id: input.assessmentId,
          },
        });
      } else if (closed.error !== 'Deployment is already closed') {
        return {
          success: false,
          error: `Concluded ${concluded} attempt${concluded === 1 ? '' : 's'}, but the window could not be closed: ${closed.error}`,
        };
      }
    }

    await recordAuditLog({
      actorUserId,
      action: 'update',
      entityType: 'assessment_deployment',
      entityId: input.deploymentId,
      metadata: {
        intervention: 'conclude_all_attempts',
        actor_role: actorRole,
        concluded,
        raced,
        close_window: windowClosed,
      },
    });

    revalidateMonitorPath(input.offeringId, input.assessmentId);
    if (windowClosed) {
      revalidatePath(`/faculty/subjects/${input.offeringId}/deployments`);
      revalidatePath('/student/assessments');
      revalidatePath('/student');
      revalidatePath('/notifications');
    }

    const parts = [
      `${concluded} attempt${concluded === 1 ? '' : 's'} concluded`,
      ...(raced > 0 ? [`${raced} already submitted`] : []),
      ...(windowClosed ? ['window closed'] : []),
    ];
    const value = parts.join(' · ');
    return scored
      ? { success: true, value }
      : { success: true, value: `${value} · scoring failed for some — re-score from Results` };
  } catch {
    return { success: false, error: 'Failed to conclude the exam' };
  }
}

/**
 * Conclude a SELECTED set of students in this deployment (scope §42): every
 * named attempt that is still in progress is finalized and scored exactly
 * like the individual conclude, while attempts outside the selection keep
 * running untouched. Same deployment-level authorization as conclude-all
 * (faculty of the offering or an assigned proctor). Attempt ids are re-scoped
 * to this deployment server-side, so a forged list can never touch another
 * sitting; ids that are not in progress are skipped, not errored.
 */
export async function concludeSelectedAttempts(input: {
  deploymentId: string;
  attemptIds: string[];
  offeringId: string;
  assessmentId: string;
}): Promise<ActionResult> {
  try {
    const attemptIds = [...new Set(input.attemptIds)].filter((id) => id !== '');
    if (attemptIds.length === 0) {
      return { success: false, error: 'Select at least one student to conclude' };
    }

    const auth = await authorizeDeployment(
      input.deploymentId,
      input.offeringId,
      input.assessmentId
    );
    if (!auth.userId || !auth.actorRole) {
      return { success: false, error: auth.error ?? 'Not authorized' };
    }
    const actorUserId = auth.userId;
    const actorRole = auth.actorRole;

    const admin = createAdminClient();
    const { data: attempts, error: listError } = await admin
      .from('exam_attempts')
      .select('id, student_id, status, expires_at')
      .eq('deployment_id', input.deploymentId)
      .in('id', attemptIds);

    if (listError) return { success: false, error: listError.message };

    const found = attempts ?? [];
    const notFound = attemptIds.length - found.length;
    let concluded = 0;
    let skipped = 0;
    let scored = true;

    for (const row of found) {
      if (row.status !== 'in_progress') {
        skipped += 1; // selected a student who already finished — not an error
        continue;
      }
      const outcome = await concludeAttemptInternal(
        {
          attemptId: row.id,
          studentId: row.student_id,
          deploymentId: input.deploymentId,
          status: row.status,
          expiresAt: row.expires_at,
          offeringId: input.offeringId,
          assessmentId: input.assessmentId,
        },
        actorUserId,
        actorRole
      );
      if (outcome.ok) {
        concluded += 1;
        if (outcome.scored === false) scored = false;
      } else {
        skipped += 1; // raced a concurrent self-submit
      }
    }

    if (concluded === 0 && skipped === 0) {
      return { success: false, error: 'None of the selected students belong to this exam' };
    }

    await recordAuditLog({
      actorUserId,
      action: 'update',
      entityType: 'assessment_deployment',
      entityId: input.deploymentId,
      metadata: {
        intervention: 'conclude_selected_attempts',
        actor_role: actorRole,
        attempt_ids: attemptIds,
        concluded,
        skipped,
        not_found: notFound,
      },
    });

    revalidateMonitorPath(input.offeringId, input.assessmentId);

    const parts = [
      `${concluded} attempt${concluded === 1 ? '' : 's'} concluded`,
      ...(skipped > 0 ? [`${skipped} already finished`] : []),
      ...(notFound > 0 ? [`${notFound} not in this exam`] : []),
    ];
    const value = parts.join(' · ');
    return scored
      ? { success: true, value }
      : { success: true, value: `${value} · scoring failed for some — re-score from Results` };
  } catch {
    return { success: false, error: 'Failed to conclude the selected attempts' };
  }
}
