'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { startExamAttempt, isStartExamSuccess } from '@/lib/exam';
import { scoreAttempt } from '@/lib/scoring';
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

  return {
    data: {
      attempt,
      manifest,
      questions: orderedQuestions,
      responses,
    },
  };
}

export async function submitExam(
  attemptId: string
): Promise<{ error?: string; success?: boolean; scored?: boolean }> {
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

  // Exam submission is the core integrity event of the assessment workflow, so
  // it is recorded even though scoring below may still fail.
  await recordAuditLog({
    actorUserId: user.id,
    action: 'submit',
    entityType: 'exam_attempt',
    entityId: attemptId,
    metadata: { deployment_id: attempt.deployment_id, auto_submitted: isExpired },
  });

  // 2. Score in-process (no HTTP self-call). Failures are reported but do
  //    not undo the submission — faculty can re-score.
  try {
    await scoreAttempt(attemptId, admin);

    const { data: attemptRow } = await admin
      .from('exam_attempts')
      .select('deployment_id')
      .eq('id', attemptId)
      .single();

    const deploymentId = attemptRow?.deployment_id ?? attempt.deployment_id;

    // 3. Compute totals and upsert the result row.
    const { data: attemptFull } = await admin
      .from('exam_attempts')
      .select('student_id')
      .eq('id', attemptId)
      .single();

    const { data: responses } = await admin
      .from('student_responses')
      .select('earned_points')
      .eq('attempt_id', attemptId);

    const { data: versionIdRow } = await admin
      .from('exam_attempts')
      .select('assessment_version_id')
      .eq('id', attemptId)
      .single();

    const versionId = versionIdRow?.assessment_version_id;

    let possibleScore = 0;
    if (versionId) {
      const { data: questions } = await admin
        .from('questions')
        .select('points')
        .eq('assessment_version_id', versionId);

      possibleScore = (questions ?? []).reduce((sum, q) => sum + (q.points ?? 0), 0);
    }

    const rawScore = (responses ?? []).reduce((sum, r) => sum + (r.earned_points ?? 0), 0);

    const { data: existing } = await admin
      .from('assessment_results')
      .select('id')
      .eq('attempt_id', attemptId)
      .single();

    if (existing) {
      await admin
        .from('assessment_results')
        .update({
          raw_score: rawScore,
          possible_score: possibleScore || 1,
          updated_at: now,
        })
        .eq('id', existing.id);
    } else {
      await admin.from('assessment_results').insert({
        attempt_id: attemptId,
        student_id: attemptFull?.student_id ?? user.id,
        deployment_id: deploymentId,
        raw_score: rawScore,
        possible_score: possibleScore || 1, // CHECK possible_score > 0
        status: 'pending',
      });
    }

    // 4. Release immediately if the deployment says so.
    const { data: deployment } = await admin
      .from('assessment_deployments')
      .select('score_release_mode')
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

    return { success: true, scored: true };
  } catch (scoringError) {
    console.error('Scoring failed after submission:', scoringError);
    return {
      success: true,
      scored: false,
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
