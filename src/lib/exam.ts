import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildQuestionIdOrder } from '@/lib/exam-order';
import { COUNTABLE_ATTEMPT_STATUSES } from '@/lib/attempt-limit';
import {
  applyAssessmentExceptions,
  loadAssessmentExceptions,
} from '@/lib/assessment-exceptions';
import type { ExamAttempt, ExamManifest, QuestionWithChoices } from '@/lib/types';

/**
 * Shared server-side exam-start logic.
 *
 * Called from both `/api/exam/start` (route handler) and the student
 * `startExamAttempt` server action. Serving two front doors keeps the
 * eligibility rules, attempt-limit handling and manifest generation in one
 * place — the workflow must behave identically no matter which path a student
 * reaches it through.
 *
 * `supabase` must be a client scoped to the student's session: the deployment
 * and enrollment reads rely on RLS ("Students can read eligible
 * assessment_deployments" / "Students can read own enrollments") so a student
 * can never start an exam for an offering they are not enrolled in. Question
 * content and the attempts/manifest rows are written with the service-role
 * client because RLS intentionally denies students those tables.
 */

export interface StartExamSuccess {
  attempt: ExamAttempt;
  manifest: ExamManifest;
  /** Questions in the exact order the student must see them. */
  questions: QuestionWithChoices[];
  /** question id -> ordered choice ids for that question. */
  choiceOrder: Record<string, string[]>;
}

export type StartExamOutcome =
  | StartExamSuccess
  | { error: string; status: number };

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isStartExamSuccess(
  outcome: StartExamOutcome
): outcome is StartExamSuccess {
  return !('error' in outcome);
}

export { isStartExamSuccess };

export async function startExamAttempt(
  supabase: SupabaseClient,
  userId: string,
  deploymentId: string
): Promise<StartExamOutcome> {
  if (typeof deploymentId !== 'string' || !deploymentId) {
    return { error: 'deploymentId is required', status: 400 };
  }

  // RLS scopes this read to deployments of offerings the student is enrolled in.
  const { data: deployment, error: deploymentError } = await supabase
    .from('assessment_deployments')
    .select('*')
    .eq('id', deploymentId)
    .single();

  if (deploymentError || !deployment) {
    return { error: 'Deployment not found', status: 404 };
  }

  // Manual deployments sit in 'draft' until the faculty opens them; closed /
  // archived rows stay unavailable regardless of the timestamp window.
  if (deployment.status === 'draft' || deployment.status === 'closed' || deployment.status === 'archived') {
    return { error: 'Assessment is not currently available', status: 403 };
  }

  // Server time is authoritative: the device clock never decides eligibility.
  const now = new Date();

  if (!deployment.assessment_version_id) {
    return { error: 'This deployment has no assessment version attached', status: 409 };
  }

  if (deployment.requires_identity_verification) {
    const { data: studentProfile } = await supabase
      .from('student_profiles')
      .select('verification_status')
      .eq('user_id', userId)
      .single();

    if (!studentProfile || studentProfile.verification_status !== 'verified') {
      return { error: 'Identity verification required', status: 403 };
    }
  }

  // Student-specific exceptions (extended time, additional attempts, schedule
  // override) — resolved by the shared helper the student detail page also
  // uses, so the UI and the API agree on what is startable.
  const admin = createAdminClient();
  const exceptions = await loadAssessmentExceptions(admin, deploymentId, userId);
  const effective = applyAssessmentExceptions(deployment, exceptions, now);

  if (now < effective.opensAt || now > effective.closesAt) {
    return { error: 'Assessment is not currently available', status: 403 };
  }

  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('subject_offering_id', deployment.subject_offering_id)
    .eq('student_id', userId)
    .eq('status', 'enrolled')
    .single();

  if (!enrollment) {
    return { error: 'Not enrolled in this subject', status: 403 };
  }

  // Count with the session client (own attempts are readable). Fail closed if
  // the count cannot be read — never open an extra attempt on a null count.
  const { count: attemptCount, error: countError } = await supabase
    .from('exam_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('deployment_id', deploymentId)
    .eq('student_id', userId)
    .in('status', [...COUNTABLE_ATTEMPT_STATUSES]);

  if (countError || attemptCount === null) {
    return { error: 'Could not verify attempt limit', status: 403 };
  }

  if (attemptCount >= effective.attemptLimit) {
    return { error: 'Attempt limit reached', status: 403 };
  }

  // RLS grants students no SELECT on questions (answer-key protection), so
  // question content is read via the service-role client after the
  // authorization checks above have passed.
  // (admin client is already created above for exception checks)

  // Questions are authored with status 'active' (addQuestion/saveGeneratedQuestions)
  // and become 'approved' only if a reviewer flips them; accept both so either
  // authoring path yields a startable exam.
  const { data: questions, error: questionsError } = await admin
    .from('questions')
    .select('*, question_choices(*)')
    .eq('assessment_version_id', deployment.assessment_version_id)
    .in('status', ['active', 'approved']);

  if (questionsError || !questions || questions.length === 0) {
    return { error: 'No questions available', status: 404 };
  }

  let orderedQuestions: QuestionWithChoices[] = [...(questions as QuestionWithChoices[])];
  // Strict document order by position (source sequence); only 'shuffled'
  // deployments randomize. Questions are never regrouped by type.
  const shuffle = deployment.question_order_mode === 'shuffled';
  const idOrder = buildQuestionIdOrder(orderedQuestions, { shuffle });
  const byId = new Map(orderedQuestions.map((q) => [q.id, q]));
  orderedQuestions = idOrder.map((id) => byId.get(id)!).filter(Boolean);

  const questionOrder = orderedQuestions.map((q) => q.id);
  const choiceOrder: Record<string, string[]> = {};

  for (const question of orderedQuestions) {
    const choices = question.question_choices ?? [];
    if (deployment.choice_order_mode === 'shuffled') {
      choiceOrder[question.id] = shuffleArray(choices).map((c) => c.id);
    } else {
      choiceOrder[question.id] = [...choices]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((c) => c.id);
    }
  }

  const attemptNumber = attemptCount + 1;
  const expiresAt = new Date(now.getTime() + effective.durationMinutes * 60 * 1000);

  // Attempt + manifest writes go through the service-role client:
  // exam_manifests has no student INSERT policy under RLS.
  //
  // A DB trigger (trg_enforce_attempt_limit) normalizes attempt_number and
  // rejects inserts beyond attempt_limit (P0001). Retry once on a UNIQUE
  // collision (23505) — two concurrent MAX+1 computations — otherwise fail.
  let attempt: ExamAttempt | null = null;
  let lastError: { message: string; code?: string } | null = null;

  for (let tryNumber = attemptNumber; tryNumber < attemptNumber + 3 && !attempt; tryNumber++) {
    const { data, error } = await admin
      .from('exam_attempts')
      .insert({
        deployment_id: deploymentId,
        student_id: userId,
        assessment_version_id: deployment.assessment_version_id,
        attempt_number: tryNumber,
        status: 'in_progress',
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        identity_verified: !deployment.requires_identity_verification,
      })
      .select()
      .single();

    if (!error) {
      attempt = data as ExamAttempt;
    } else {
      lastError = { message: error.message, code: error.code };
      if (error.code !== '23505') break; // unique collisions retry; everything else fails
    }
  }

  if (!attempt) {
    if (lastError?.code === '23505' || lastError?.code === 'P0001') {
      return { error: 'Attempt limit reached', status: 403 };
    }
    return { error: 'Failed to create attempt', status: 500 };
  }

  const manifestHash = btoa(
    JSON.stringify({ questionOrder, choiceOrder, attemptId: attempt.id })
  );

  const { data: manifest, error: manifestError } = await admin
    .from('exam_manifests')
    .insert({
      attempt_id: attempt.id,
      question_order: questionOrder,
      choice_order: choiceOrder,
      manifest_hash: manifestHash,
    })
    .select()
    .single();

  if (manifestError || !manifest) {
    return { error: 'Failed to create manifest', status: 500 };
  }

  return {
    attempt,
    manifest: manifest as ExamManifest,
    questions: orderedQuestions,
    choiceOrder,
  };
}
