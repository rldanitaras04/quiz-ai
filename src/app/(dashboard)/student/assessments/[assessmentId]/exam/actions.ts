'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { withAuthRetry } from '@/lib/auth-errors';
import { startExamAttempt, isStartExamSuccess } from '@/lib/exam';
import { scoreAttempt, upsertAssessmentResult } from '@/lib/scoring';
import { notifyFacultyOfOffering } from '@/lib/notifications';
import { applyResponseOperations, type SyncOperation } from '@/lib/exam-sync';
import {
  closeActiveSession,
  handleHeartbeat,
  loadDeploymentPolicy,
  openExamSession,
  recordExamEvent,
} from '@/lib/exam-session';
import { isSecurityEventType, type SecurityEventType } from '@/lib/exam-security';
import type {
  ExamAttempt,
  ExamManifest,
  QuestionWithChoices,
} from '@/lib/types';

interface AttemptDetails {
  attempt: ExamAttempt;
  manifest: ExamManifest;
  questions: QuestionWithChoices[];
  /** Already-synced answers, so a reload restores what the server holds. */
  responses: StoredResponse[];
  /** Resolved examination security policy for this deployment. */
  securityPolicy: Record<string, unknown>;
  /** Server clock at read time — the browser only corrects its display. */
  serverNow: string;
}

interface StoredResponse {
  questionId: string;
  selectedChoiceId: string | null;
  textAnswer: string | null;
  serverRevision: number;
}

/**
 * Start (or refuse to start) an exam attempt for the signed-in student.
 * All eligibility, enrollment, attempt-limit and manifest rules live in
 * lib/exam.ts, which the /api/exam/start route also uses.
 */
export async function startExamAttemptAction(
  deploymentId: string
): Promise<{ attemptId?: string; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const outcome = await startExamAttempt(supabase, user.id, deploymentId);

  if (!isStartExamSuccess(outcome)) return { error: outcome.error };

  return { attemptId: outcome.attempt.id };
}

// ---------------------------------------------------------------------------
// Examination session lifecycle (Secure Exam Shell)
// ---------------------------------------------------------------------------

export interface OpenSessionResult {
  error?: string;
  sessionId?: string;
  sessionToken?: string;
  resumed?: boolean;
  transferred?: boolean;
  requiresReverification?: boolean;
  securityPolicy?: Record<string, unknown>;
  serverNow?: string;
}

/**
 * Create or resume the single active examination session for this attempt.
 * The session token returned here is the capability required for every later
 * session mutation (heartbeat, events, saves) — it is only ever handed to the
 * authenticated owner of the attempt.
 */
export async function openExamSessionAction(
  attemptId: string,
  options?: { presentedToken?: string | null; isReload?: boolean }
): Promise<OpenSessionResult> {
  const supabase = await createClient();
  // Session open/recovery must not fail on a transient Auth blip (rate
  // limit) — retry with backoff before reporting an error to the exam UI.
  const {
    data: { user },
    error: authError,
  } = await withAuthRetry(() => supabase.auth.getUser(), { retryRefreshRace: false });
  if (authError || !user) return { error: 'Not authenticated' };

  const admin = createAdminClient();
  const result = await openExamSession(supabase, admin, {
    attemptId,
    userId: user.id,
    presentedToken: options?.presentedToken ?? null,
    isReload: options?.isReload === true,
  });

  if (result.error) return { error: result.error };

  return {
    sessionId: result.sessionId,
    sessionToken: result.sessionToken,
    resumed: result.resumed,
    transferred: result.transferred,
    requiresReverification: result.requiresReverification,
    securityPolicy: result.policy as unknown as Record<string, unknown>,
    serverNow: result.serverNow,
  };
}

export interface HeartbeatPayload {
  attemptId: string;
  sessionId: string;
  sessionToken: string;
  currentItem: number;
  totalItems: number;
  answeredCount: number;
  flaggedCount: number;
  connectionState: 'online' | 'offline' | 'unknown';
  syncState: 'synced' | 'syncing' | 'pending' | 'error';
  pendingSyncCount: number;
  lastLocalSaveAt?: string | null;
  lastSyncAt?: string | null;
}

export interface HeartbeatResponse {
  error?: string;
  serverNow?: string;
  attemptStatus?: string;
  attemptExpiresAt?: string;
  reverificationRequired?: boolean;
}

/**
 * Lightweight session heartbeat. Updates the single presence row in place and
 * returns the authoritative attempt state so the client picks up faculty
 * interventions (extra time, reverification, termination) without reloading.
 * Carries no answer contents.
 */
export async function heartbeatAction(payload: HeartbeatPayload): Promise<HeartbeatResponse> {
  const supabase = await createClient();
  // Retries a transient Auth failure (rate limit) before giving up; the
  // client skips a failed beat and the next interval retries anyway.
  const {
    data: { user },
    error: authError,
  } = await withAuthRetry(() => supabase.auth.getUser(), { retryRefreshRace: false });
  if (authError || !user) return { error: 'Not authenticated' };

  const admin = createAdminClient();
  const result = await handleHeartbeat(supabase, admin, user.id, payload);

  if (result.error) return { error: result.error };
  return {
    serverNow: result.serverNow,
    attemptStatus: result.attemptStatus,
    attemptExpiresAt: result.attemptExpiresAt,
    reverificationRequired: result.reverificationRequired,
  };
}

export interface SecurityEventInput {
  attemptId: string;
  sessionId?: string | null;
  sessionToken?: string | null;
  eventType: SecurityEventType;
  metadata?: Record<string, unknown>;
}

/**
 * Record one factual security/session event for the caller's own attempt.
 * Severity is derived server-side from the event type; the client cannot
 * choose it. Events are never classified as misconduct here — they are
 * evidence for faculty to interpret under institutional policy.
 */
export async function recordSecurityEventAction(
  input: SecurityEventInput
): Promise<{ recorded?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  if (!isSecurityEventType(input.eventType)) return { error: 'Unknown event type' };

  const admin = createAdminClient();
  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('id, student_id, deployment_id')
    .eq('id', input.attemptId)
    .maybeSingle();

  if (!attempt || attempt.student_id !== user.id) return { error: 'Forbidden' };

  // When a session is presented it must be the caller's active session —
  // otherwise only attempt-owned events without a session are accepted
  // (e.g. a concurrent-session attempt detected before a session exists).
  let examSessionId: string | null = null;
  if (input.sessionId && input.sessionToken) {
    const { data: session } = await admin
      .from('exam_sessions')
      .select('id, student_id, session_token, status')
      .eq('id', input.sessionId)
      .maybeSingle();

    if (
      !session ||
      session.student_id !== user.id ||
      session.session_token !== input.sessionToken
    ) {
      return { error: 'Invalid session' };
    }
    examSessionId = session.id;
  }

  const outcome = await recordExamEvent(admin, {
    attemptId: attempt.id,
    studentId: attempt.student_id,
    deploymentId: attempt.deployment_id,
    examSessionId,
    eventType: input.eventType,
    metadata: input.metadata,
  });

  return { recorded: outcome.recorded };
}

/**
 * Identity reverification after a qualifying interruption / faculty request.
 * Re-verifies the student by having them re-enter their account password
 * (real credential check through Supabase Auth — no biometric provider is
 * integrated, and none is faked). Success/failure are both recorded.
 */
export async function completeReverificationAction(input: {
  attemptId: string;
  sessionId: string;
  sessionToken: string;
  password: string;
}): Promise<{ success?: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };
  if (typeof input.password !== 'string' || input.password.length === 0) {
    return { error: 'Password is required' };
  }

  const admin = createAdminClient();
  const { data: session } = await admin
    .from('exam_sessions')
    .select('id, student_id, attempt_id, session_token, status')
    .eq('id', input.sessionId)
    .maybeSingle();

  if (
    !session ||
    session.attempt_id !== input.attemptId ||
    session.student_id !== user.id ||
    session.session_token !== input.sessionToken ||
    session.status !== 'active'
  ) {
    return { error: 'Invalid session' };
  }

  const email = user.email;
  if (!email) return { error: 'Account has no email address' };

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password: input.password,
  });

  if (signInError) {
    await recordExamEvent(admin, {
      attemptId: input.attemptId,
      studentId: user.id,
      deploymentId: (await loadAttemptDeployment(admin, input.attemptId)) ?? '',
      examSessionId: session.id,
      eventType: 'identity_reverification_failed',
      metadata: { reason: 'invalid_credentials' },
    });
    return { error: 'Password verification failed' };
  }

  const now = new Date().toISOString();
  await admin
    .from('exam_sessions')
    .update({ reverification_required: false, updated_at: now })
    .eq('id', session.id);

  const { data: attemptRow } = await admin
    .from('exam_attempts')
    .select('deployment_id')
    .eq('id', input.attemptId)
    .maybeSingle();

  await recordExamEvent(admin, {
    attemptId: input.attemptId,
    studentId: user.id,
    deploymentId: attemptRow?.deployment_id ?? '',
    examSessionId: session.id,
    eventType: 'identity_verified',
    metadata: { method: 'password_reverification' },
  });

  await recordAuditLog({
    actorUserId: user.id,
    action: 'update',
    entityType: 'exam_session',
    entityId: session.id,
    metadata: { action: 'identity_reverification_completed', attempt_id: input.attemptId },
  });

  return { success: true };
}

async function loadAttemptDeployment(admin: ReturnType<typeof createAdminClient>, attemptId: string) {
  const { data } = await admin
    .from('exam_attempts')
    .select('deployment_id')
    .eq('id', attemptId)
    .maybeSingle();
  return data?.deployment_id ?? null;
}

export async function getAttemptDetails(
  attemptId: string,
  assessmentId?: string
): Promise<{ data?: AttemptDetails; error?: string }> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const { data: attempt, error: attemptError } = await supabase
    .from('exam_attempts')
    .select('*')
    .eq('id', attemptId)
    .single();

  if (attemptError || !attempt) return { error: 'Attempt not found' };
  if (attempt.student_id !== user.id) return { error: 'Forbidden' };

  const { data: manifest, error: manifestError } = await supabase
    .from('exam_manifests')
    .select('*')
    .eq('attempt_id', attemptId)
    .single();

  if (manifestError || !manifest) return { error: 'Manifest not found' };

  // RLS denies students SELECT on questions (answer-key protection), so the
  // question content is fetched via the service-role client. Ownership was
  // already verified above; the manifest pins exactly which questions load.
  const admin = createAdminClient();

  // The URL segment must belong to this attempt. Ownership alone would still
  // let a tampered /student/assessments/{otherAssessment}/exam/{ownAttempt}
  // render the wrong context around a real attempt.
  if (assessmentId) {
    const { data: dep } = await admin
      .from('assessment_deployments')
      .select('assessment_version:assessment_versions(assessment_id)')
      .eq('id', attempt.deployment_id)
      .maybeSingle();
    const linked = dep?.assessment_version as { assessment_id?: string } | null;
    if (linked?.assessment_id !== assessmentId) {
      return { error: 'This attempt does not belong to that assessment' };
    }
  }

  const { data: questions, error: questionsError } = await admin
    .from('questions')
    .select('id, question_type, question_text, difficulty, bloom_level, points, position, image_url, image_storage_path, question_choices(id, choice_key, choice_text, position)')
    .in('id', manifest.question_order)
    .order('position', { ascending: true });

  if (questionsError || !questions) return { error: 'Failed to load questions' };

  const orderedQuestions = manifest.question_order
    .map((id: string) => questions.find((q) => q.id === id))
    .filter(Boolean) as QuestionWithChoices[];

  // Previously-saved answers (RLS scopes this read to the caller's own rows).
  // Combined with the local IndexedDB copy on the client so a reload never
  // shows a blank paper.
  const { data: responseRows } = await supabase
    .from('student_responses')
    .select('question_id, selected_choice_id, text_answer, server_revision')
    .eq('attempt_id', attemptId);

  const responses: StoredResponse[] = (responseRows ?? []).map(
    (row: Record<string, unknown>) => ({
      questionId: row.question_id as string,
      selectedChoiceId: (row.selected_choice_id as string | null) ?? null,
      textAnswer: (row.text_answer as string | null) ?? null,
      serverRevision: Number(row.server_revision ?? 0),
    })
  );

  // Security policy is read through the caller's session client (RLS limits
  // the deployment read to enrolled offerings) so the Secure Exam Shell knows
  // exactly which session observations this assessment configured.
  const { policy } = await loadDeploymentPolicy(supabase, attempt.deployment_id);

  return {
    data: {
      attempt,
      manifest,
      questions: orderedQuestions,
      responses,
      securityPolicy: policy as unknown as Record<string, unknown>,
      serverNow: new Date().toISOString(),
    },
  };
}

/**
 * Server-authoritative submission.
 *
 * Reconciliation: any still-queued local operations are applied first (same
 * idempotent path as `/api/exam/save`) — but only while the server-defined
 * deadline has not passed. Answers queued after the deadline are NOT applied;
 * they are reported back to the client and recorded on the submission event so
 * nothing is silently discarded and faculty can see the situation.
 *
 * The status transition is conditional on `in_progress`, so repeated or
 * concurrent submit requests are safe/idempotent: only the first one wins and
 * proceeds to scoring.
 */
export async function submitExam(
  attemptId: string,
  pendingOperations?: SyncOperation[]
): Promise<{
  error?: string;
  success?: boolean;
  scored?: boolean;
  pendingApplied?: number;
  pendingSkipped?: number;
}> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const { data: attempt, error: attemptError } = await supabase
    .from('exam_attempts')
    .select('id, student_id, status, deployment_id, expires_at')
    .eq('id', attemptId)
    .maybeSingle();

  if (attemptError || !attempt) return { error: 'Attempt not found' };
  if (attempt.student_id !== user.id) return { error: 'Forbidden' };
  if (attempt.status !== 'in_progress') {
    return { error: 'Attempt is not in progress' };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // A submit after the server-defined window is recorded as an automatic
  // submission, so the expiry is what the database reflects — not a manual
  // turn-in the student was no longer entitled to make.
  const isExpired = Boolean(attempt.expires_at && attempt.expires_at < now);

  // --- Reconcile still-queued local operations (pre-deadline only) ---------
  let pendingApplied = 0;
  let pendingSkipped = 0;
  const operations = Array.isArray(pendingOperations) ? pendingOperations.slice(0, 500) : [];

  if (operations.length > 0) {
    if (isExpired) {
      pendingSkipped = operations.length;
    } else {
      const outcome = await applyResponseOperations(admin, attemptId, operations);
      pendingApplied = outcome.applied.length;
      pendingSkipped = outcome.rejected.filter((qid) => !outcome.duplicates.includes(qid)).length;
    }
  }

  // Record submission intent (session timeline evidence).
  await recordExamEvent(admin, {
    attemptId,
    studentId: user.id,
    deploymentId: attempt.deployment_id,
    eventType: 'submission_started',
    metadata: { pending_applied: pendingApplied, pending_skipped: pendingSkipped },
  });

  // 1. Mark the attempt submitted. Status transitions are enforced by app
  //    logic here; the RLS layer blocks direct client tampering.
  const { error: submitError } = await admin
    .from('exam_attempts')
    .update({
      status: isExpired ? 'auto_submitted' : 'submitted',
      submitted_at: now,
      updated_at: now,
    })
    .eq('id', attemptId)
    .eq('status', 'in_progress'); // guard: only transition from in_progress

  if (submitError) {
    return { error: 'Failed to submit exam' };
  }

  // Close the single active examination session.
  await closeActiveSession(admin, attemptId, isExpired ? 'expired' : 'submitted');
  await recordExamEvent(admin, {
    attemptId,
    studentId: user.id,
    deploymentId: attempt.deployment_id,
    eventType: 'submission_completed',
    metadata: { auto_submitted: isExpired, pending_applied: pendingApplied },
  });

  // Exam submission is the core integrity event of the assessment workflow, so
  // it is recorded even though scoring below may still fail.
  await recordAuditLog({
    actorUserId: user.id,
    action: 'submit',
    entityType: 'exam_attempt',
    entityId: attemptId,
    metadata: {
      deployment_id: attempt.deployment_id,
      auto_submitted: isExpired,
      pending_applied: pendingApplied,
      pending_skipped: pendingSkipped,
    },
  });

  // 2. Score in-process (no HTTP self-call). Failures are reported but do
  //    not undo the submission — faculty can re-score.
  try {
    await scoreAttempt(attemptId, admin);

    // 3. Compute totals and upsert the result row. Shared with the faculty
    //    review re-score and release backfill so every path writes the same
    //    totals (scope §27: percentage = earned / possible * 100).
    const totals = await upsertAssessmentResult(admin, attemptId, {
      studentId: user.id,
      deploymentId: attempt.deployment_id,
    });
    if (!totals) throw new Error('Failed to upsert assessment result');
    const deploymentId = totals.deploymentId || attempt.deployment_id;

    // 4. Release immediately if the deployment says so.
    const { data: deployment } = await admin
      .from('assessment_deployments')
      .select('score_release_mode, subject_offering_id')
      .eq('id', deploymentId)
      .single();

    if (deployment?.score_release_mode === 'immediate') {
      const { data: result } = await admin
        .from('assessment_results')
        .select('id')
        .eq('attempt_id', attemptId)
        .single();

      if (result) {
        await admin
          .from('assessment_results')
          .update({
            status: 'released',
            released_at: now,
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
      const { data: reviewRows } = await admin
        .from('student_responses')
        .select('id, earned_points, scoring_status, question:questions(question_type)')
        .eq('attempt_id', attemptId);
      const needsReview = (reviewRows ?? []).filter((r) => {
        // supabase-js without generated types types the embed as an array;
        // normalize so both shapes behave the same.
        const embedded = Array.isArray(r.question) ? r.question[0] : r.question;
        return (
          r.scoring_status === 'pending' ||
          r.scoring_status === 'manual_review' ||
          (r.earned_points === 0 && embedded?.question_type === 'identification')
        );
      });
      if (needsReview.length > 0) {
        await notifyFacultyOfOffering({
          offeringId,
          type: 'review_required',
          title: 'Responses need review',
          body:
            `${needsReview.length} identification response${needsReview.length === 1 ? '' : 's'} ` +
            `scored zero or could not be auto-scored — review ${
              isExpired ? 'the auto-submitted' : 'the'
            } paper before releasing results.`,
          data: {
            deployment_id: deploymentId,
            attempt_id: attemptId,
            offering_id: offeringId,
            count: needsReview.length,
          },
        });
      }

      // (b) Submission progress: one event per deployment, fired when every
      //     enrolled student has an attempt in (auto)submitted state.
      const [{ data: enrolledRows }, { data: submittedRows }] = await Promise.all([
        admin
          .from('enrollments')
          .select('student_id')
          .eq('subject_offering_id', offeringId)
          .eq('status', 'enrolled'),
        admin
          .from('exam_attempts')
          .select('student_id')
          .eq('deployment_id', deploymentId)
          .in('status', ['submitted', 'auto_submitted']),
      ]);
      const enrolledCount = new Set((enrolledRows ?? []).map((r) => r.student_id)).size;
      const submittedCount = new Set((submittedRows ?? []).map((r) => r.student_id)).size;
      if (enrolledCount > 0 && submittedCount >= enrolledCount) {
        const { count: existingProgress } = await admin
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

    return { success: true, scored: true, pendingApplied, pendingSkipped };
  } catch (scoringError) {
    console.error('Scoring failed after submission:', scoringError);
    return {
      success: true,
      scored: false,
      pendingApplied,
      pendingSkipped,
      error: 'Exam submitted, but scoring failed. Your instructor can re-score.',
    };
  }
}

export interface BreakdownResponse {
  questionId: string;
  position: number | null;
  questionText: string;
  questionType: string;
  points: number;
  imageUrl?: string | null;
  selectedChoiceId: string | null;
  textAnswer: string | null;
  earnedPoints: number | null;
  choices: { id: string; choice_key: string; choice_text: string }[];
  correctChoiceId: string | null;
  canonicalAnswer: string | null;
}

/**
 * Which review columns the deployment actually permits. Returned alongside the
 * items so the client never receives a field it is not allowed to render.
 */
export interface BreakdownMeta {
  showItemCorrectness: boolean;
  showCorrectAnswers: boolean;
}

export type BreakdownResult = {
  data?: BreakdownResponse[];
  meta?: BreakdownMeta;
  /** Machine-readable reason, e.g. `pending_release`. */
  code?: string;
  error?: string;
};

/**
 * Per-attempt review gate. Every path that can surface a student's answers,
 * per-item scores, or the answer key must go through this: it enforces
 * ownership, submission state, and — critically — the faculty score-release
 * setting and the deployment's `show_item_correctness` / `show_correct_answers`
 * display flags. Hidden values are stripped before the payload is built, so
 * unreleased or key data never reaches the browser.
 */
export async function loadAttemptBreakdown(
  attemptId: string,
  callerId: string
): Promise<BreakdownResult> {
  const supabase = await createClient();

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('student_id, status, deployment_id')
    .eq('id', attemptId)
    .maybeSingle();

  if (!attempt) return { error: 'Attempt not found', code: 'not_found' };
  if (attempt.student_id !== callerId) return { error: 'Forbidden', code: 'forbidden' };
  if (attempt.status === 'in_progress') {
    return { error: 'Breakdown is only available after submission', code: 'in_progress' };
  }

  // Score-release control is enforced here, not in the UI: a result row that
  // has not been released by faculty exposes nothing at all.
  const { data: result } = await supabase
    .from('assessment_results')
    .select('id, status')
    .eq('attempt_id', attemptId)
    .maybeSingle();

  if (!result || result.status !== 'released') {
    return { error: 'Result pending release', code: 'pending_release' };
  }

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('show_item_correctness, show_correct_answers')
    .eq('id', attempt.deployment_id)
    .maybeSingle();

  const showItemCorrectness = deployment?.show_item_correctness === true;
  const showCorrectAnswers = deployment?.show_correct_answers === true;
  const meta: BreakdownMeta = { showItemCorrectness, showCorrectAnswers };

  // RLS denies students SELECT on questions/answer_keys (by design), so the
  // breakdown is fetched with the service-role client only after every gate
  // above has passed.
  const admin = createAdminClient();

  const { data: responses } = await admin
    .from('student_responses')
    .select('question_id, selected_choice_id, text_answer, earned_points')
    .eq('attempt_id', attemptId);

  if (!responses || responses.length === 0) return { data: [], meta };

  const questionIds = responses.map((r) => r.question_id);

  // The answer key is only selected when the deployment permits revealing it —
  // otherwise it is never read out of the database for this caller.
  const { data: questions } = await admin
    .from('questions')
    .select(
      `id, question_text, question_type, points, position, image_url,
       question_choices(id, choice_key, choice_text)${
         showCorrectAnswers ? ', answer_key:answer_keys(correct_choice_id, canonical_answer)' : ''
       }`
    )
    .in('id', questionIds)
    .order('position', { ascending: true });

  if (!questions) return { error: 'Failed to load breakdown', code: 'load_failed' };

  interface BreakdownQuestionRow {
    id: string;
    question_text: string;
    question_type: string;
    points: number;
    position: number | null;
    image_url?: string | null;
    question_choices: { id: string; choice_key: string; choice_text: string }[] | null;
    answer_key?: { correct_choice_id: string | null; canonical_answer: string | null } | null;
  }

  const data: BreakdownResponse[] = (questions as unknown as BreakdownQuestionRow[]).map((q) => {
    const response = responses.find((r) => r.question_id === q.id);
    return {
      questionId: q.id,
      position: q.position,
      questionText: q.question_text,
      questionType: q.question_type,
      points: q.points,
      imageUrl: q.image_url ?? null,
      selectedChoiceId: response?.selected_choice_id ?? null,
      textAnswer: response?.text_answer ?? null,
      earnedPoints: showItemCorrectness ? (response?.earned_points ?? null) : null,
      choices: (q.question_choices ?? []).map((c) => ({
        id: c.id,
        choice_key: c.choice_key,
        choice_text: c.choice_text,
      })),
      correctChoiceId: showCorrectAnswers ? (q.answer_key?.correct_choice_id ?? null) : null,
      canonicalAnswer: showCorrectAnswers ? (q.answer_key?.canonical_answer ?? null) : null,
    };
  });

  return { data, meta };
}

/**
 * Callable wrapper kept for the exam results screen. Delegates to
 * `loadAttemptBreakdown` so no second authorization path exists.
 */
export async function getAttemptBreakdown(attemptId: string): Promise<BreakdownResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated', code: 'unauthenticated' };

  return loadAttemptBreakdown(attemptId, user.id);
}
