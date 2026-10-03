import type { SupabaseClient } from '@supabase/supabase-js';
import { scoreAttempt, upsertAssessmentResult } from '@/lib/scoring';
import { notifyFacultyOfOffering } from '@/lib/notifications';

/**
 * Shared post-submission workflow (scope §27/§32/§42).
 *
 * Two pieces of logic that must behave identically no matter WHO concluded the
 * attempt — the student hitting Submit, a faculty member, or a proctor from
 * the live monitor (scope §42 conclude):
 *
 *  1. `finalizeAttemptScoring` — score saved answers, upsert the result
 *     totals, honor the deployment's immediate-release policy, and fire the
 *     §32 faculty notifications.
 *  2. `closeDeploymentWindow` — stamp `closes_at = now` / status `closed` and
 *     release `after_all_submitted` results, the same internals `closeDeployment`
 *     uses.
 *
 * Both take the database client from the caller: server actions do the
 * authorization first (faculty of the offering/subject, or an explicit proctor
 * row on this deployment — scope §42) and then run these through the
 * service-role client, because proctors hold no deployment write grants.
 *
 * Failures throw / surface an error result; neither helper ever undoes a
 * submission that already happened (faculty can re-score).
 */

export interface FinalizeScoringInput {
  attemptId: string;
  /** The attempt's owner — never the actor concluding it. */
  studentId: string;
  deploymentId: string;
  /** ISO timestamp stamped on an immediate release. */
  now: string;
  /** The attempt ended by deadline expiry rather than a manual turn-in. */
  autoSubmitted: boolean;
}

export interface FinalizeScoringOutcome {
  /** Deployment actually holding the result row (may differ from the input). */
  deploymentId: string;
  scoreReleaseMode: string | null;
  offeringId: string | null;
}

/**
 * Score one submitted attempt end-to-end: `scoreAttempt` → result totals →
 * immediate-release honoring → §32 faculty notifications (responses needing
 * review, "all submissions received").
 *
 * Throws when scoring or the result upsert fails — callers report it without
 * rolling the submission back, exactly like the original `submitExam` path.
 * The §32 notifications are best-effort by construction (a notify hiccup must
 * never fail an already-recorded submission).
 */
export async function finalizeAttemptScoring(
  db: SupabaseClient,
  input: FinalizeScoringInput
): Promise<FinalizeScoringOutcome> {
  // 1. Score in-process (no HTTP self-call). Failures propagate so the caller
  //    can report them — the submission itself is never undone.
  await scoreAttempt(input.attemptId, db);

  // 2. Compute totals and upsert the result row. Shared with the faculty
  //    review re-score and release backfill so every path writes the same
  //    totals (scope §27: percentage = earned / possible * 100).
  const totals = await upsertAssessmentResult(db, input.attemptId, {
    studentId: input.studentId,
    deploymentId: input.deploymentId,
  });
  if (!totals) throw new Error('Failed to upsert assessment result');
  const deploymentId = totals.deploymentId || input.deploymentId;

  // 3. Release immediately if the deployment says so.
  const { data: deployment } = await db
    .from('assessment_deployments')
    .select('score_release_mode, subject_offering_id')
    .eq('id', deploymentId)
    .single();

  if (deployment?.score_release_mode === 'immediate') {
    const { data: result } = await db
      .from('assessment_results')
      .select('id')
      .eq('attempt_id', input.attemptId)
      .single();

    if (result) {
      await db
        .from('assessment_results')
        .update({
          status: 'released',
          released_at: input.now,
        })
        .eq('id', result.id);
    }
  }

  // ---- Scope §32 faculty events (best-effort: a notify hiccup must never
  //      fail an already-recorded submission) --------------------------
  if (deployment?.subject_offering_id) {
    const offeringId = deployment.subject_offering_id;

    // (a) Responses requiring manual review: identification items that
    //     scored zero (possible alternative phrasing the accepted-answers
    //     list does not know) or were left pending/manual by scoring.
    const { data: reviewRows } = await db
      .from('student_responses')
      .select('id, earned_points, scoring_status, question:questions(question_type)')
      .eq('attempt_id', input.attemptId);
    const needsReview = (reviewRows ?? []).filter(
      (r: {
        earned_points: number | null;
        scoring_status: string;
        question: { question_type?: string } | { question_type?: string }[] | null;
      }) => {
        // supabase-js without generated types types the embed as an array;
        // normalize so both shapes behave the same.
        const embedded = Array.isArray(r.question) ? r.question[0] : r.question;
        return (
          r.scoring_status === 'pending' ||
          r.scoring_status === 'manual_review' ||
          (r.earned_points === 0 && embedded?.question_type === 'identification')
        );
      }
    );
    if (needsReview.length > 0) {
      await notifyFacultyOfOffering({
        offeringId,
        type: 'review_required',
        title: 'Responses need review',
        body:
          `${needsReview.length} identification response${needsReview.length === 1 ? '' : 's'} ` +
          `scored zero or could not be auto-scored — review ${
            input.autoSubmitted ? 'the auto-submitted' : 'the'
          } paper before releasing results.`,
        data: {
          deployment_id: deploymentId,
          attempt_id: input.attemptId,
          offering_id: offeringId,
          count: needsReview.length,
        },
      });
    }

    // (b) Submission progress: one event per deployment, fired when every
    //     enrolled student has an attempt in (auto)submitted state.
    const [{ data: enrolledRows }, { data: submittedRows }] = await Promise.all([
      db
        .from('enrollments')
        .select('student_id')
        .eq('subject_offering_id', offeringId)
        .eq('status', 'enrolled'),
      db
        .from('exam_attempts')
        .select('student_id')
        .eq('deployment_id', deploymentId)
        .in('status', ['submitted', 'auto_submitted']),
    ]);
    const enrolledCount = new Set(
      (enrolledRows ?? []).map((r: { student_id: string }) => r.student_id)
    ).size;
    const submittedCount = new Set(
      (submittedRows ?? []).map((r: { student_id: string }) => r.student_id)
    ).size;
    if (enrolledCount > 0 && submittedCount >= enrolledCount) {
      const { count: existingProgress } = await db
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'submission_progress')
        .contains('data', { deployment_id: deploymentId });
      if ((existingProgress ?? 0) === 0) {
        await notifyFacultyOfOffering({
          offeringId,
          type: 'submission_progress',
          title: 'All submissions received',
          body: `All ${enrolledCount} enrolled students have submitted — you can review and release results.`,
          data: {
            deployment_id: deploymentId,
            offering_id: offeringId,
            enrolled: enrolledCount,
            submitted: submittedCount,
          },
        });
      }
    }
  }

  return {
    deploymentId,
    scoreReleaseMode: deployment?.score_release_mode ?? null,
    offeringId: deployment?.subject_offering_id ?? null,
  };
}

export type CloseWindowResult =
  | { ok: true; scoreReleaseMode: string | null }
  | { ok: false; error: string };

/**
 * Close an open/scheduled/draft deployment now: stamps `closes_at = now` so
 * the exam window ends immediately, and releases results when the deployment
 * waits for `after_all_submitted`.
 *
 * The conditional `.in('status', …)` guard makes it idempotent — a concurrent
 * faculty close or a repeated request resolves to `already closed` rather than
 * double-writing.
 */
export async function closeDeploymentWindow(
  db: SupabaseClient,
  deploymentId: string,
  releasedBy: string,
  nowIso: string
): Promise<CloseWindowResult> {
  const { data: updated, error: updateError } = await db
    .from('assessment_deployments')
    .update({ status: 'closed', closes_at: nowIso, updated_at: nowIso })
    .eq('id', deploymentId)
    .in('status', ['draft', 'scheduled', 'active'])
    .select('id, score_release_mode')
    .maybeSingle();

  if (updateError) return { ok: false, error: updateError.message };
  if (!updated) return { ok: false, error: 'Deployment is already closed' };

  // after_all_submitted: closing the window is "everyone is done" — release now.
  if (updated.score_release_mode === 'after_all_submitted') {
    await db
      .from('assessment_results')
      .update({
        status: 'released',
        released_at: nowIso,
        released_by: releasedBy,
        updated_at: nowIso,
      })
      .eq('deployment_id', deploymentId)
      .neq('status', 'released');
  }

  return { ok: true, scoreReleaseMode: updated.score_release_mode };
}
