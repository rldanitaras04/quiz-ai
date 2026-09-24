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
  attemptId: string
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
  const { data: questions, error: questionsError } = await admin
    .from('questions')
    .select('id, question_type, question_text, difficulty, bloom_level, points, position, image_url, image_storage_path, question_choices(id, choice_key, choice_text, position)')
    .in('id', manifest.question_order)
    .order('position', { ascending: true });

  if (questionsError || !questions) return { error: 'Failed to load questions' };

  const orderedQuestions = manifest.question_order
    .map((id: string) => questions.find((q) => q.id === id))
    .filter(Boolean) as QuestionWithChoices[];

  return {
    data: {
      attempt,
      manifest,
      questions: orderedQuestions,
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
    .select('id, student_id, status, deployment_id')
    .eq('id', attemptId)
    .maybeSingle();

  if (attemptError || !attempt) return { error: 'Attempt not found' };
  if (attempt.student_id !== user.id) return { error: 'Forbidden' };
  if (attempt.status !== 'in_progress') {
    return { error: 'Attempt is not in progress' };
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // 1. Mark the attempt submitted. Status transitions are enforced by app
  //    logic here; the RLS layer blocks direct client tampering.
  const { error: submitError } = await admin
    .from('exam_attempts')
    .update({
      status: 'submitted',
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
    metadata: { deployment_id: attempt.deployment_id },
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

export async function getAttemptBreakdown(
  attemptId: string
): Promise<{ data?: BreakdownResponse[]; error?: string }> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('student_id, status')
    .eq('id', attemptId)
    .maybeSingle();

  if (!attempt) return { error: 'Attempt not found' };
  if (attempt.student_id !== user.id) return { error: 'Forbidden' };
  if (attempt.status === 'in_progress') {
    return { error: 'Breakdown is only available after submission' };
  }

  // RLS denies students SELECT on questions/answer_keys (by design), so the
  // breakdown is fetched with the service-role client after the ownership and
  // submission-state checks above.

  const admin = createAdminClient();

  const { data: responses } = await admin
    .from('student_responses')
    .select('question_id, selected_choice_id, text_answer, earned_points')
    .eq('attempt_id', attemptId);

  if (!responses || responses.length === 0) return { data: [] };

  const questionIds = responses.map((r) => r.question_id);

  const { data: questions } = await admin
    .from('questions')
    .select('id, question_text, question_type, points, position, image_url, question_choices(id, choice_key, choice_text), answer_key:answer_keys(correct_choice_id, canonical_answer)')
    .in('id', questionIds)
    .order('position', { ascending: true });

  if (!questions) return { error: 'Failed to load breakdown' };

  interface BreakdownQuestionRow {
    id: string;
    question_text: string;
    question_type: string;
    points: number;
    position: number | null;
    image_url?: string | null;
    question_choices:
      | { id: string; choice_key: string; choice_text: string }[]
      | null;
    answer_key: { correct_choice_id: string | null; canonical_answer: string | null } | null;
  }

  const data: BreakdownResponse[] = (questions as unknown as BreakdownQuestionRow[]).map((q) => ({
    questionId: q.id,
    position: q.position,
    questionText: q.question_text,
    questionType: q.question_type,
    points: q.points,
    imageUrl: q.image_url ?? null,
    selectedChoiceId: responses.find((r) => r.question_id === q.id)?.selected_choice_id ?? null,
    textAnswer: responses.find((r) => r.question_id === q.id)?.text_answer ?? null,
    earnedPoints: responses.find((r) => r.question_id === q.id)?.earned_points ?? null,
    choices: (q.question_choices ?? []).map((c) => ({
      id: c.id,
      choice_key: c.choice_key,
      choice_text: c.choice_text,
    })),
    correctChoiceId: q.answer_key?.correct_choice_id ?? null,
    canonicalAnswer: q.answer_key?.canonical_answer ?? null,
  }));

  return { data };
}
