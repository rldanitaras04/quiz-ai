'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { getFacultyAssessment, isFacultyOfOfferingOrSubject } from '@/lib/auth';
import { upsertAssessmentResult } from '@/lib/scoring';
import { activeChatProvider, chatCompletion, hasChatProvider, type ChatCompletionResult } from '@/lib/ai/chat';
import { buildRecommendationPrompt, parseScoreRecommendation, type ScoreRecommendation } from '@/lib/ai/recommendation';
import { logAiUsage } from '@/lib/ai/logger';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

export interface IdentificationReviewItem {
  response_id: string;
  attempt_id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  question_id: string;
  question_text: string;
  text_answer: string;
  normalized_answer: string | null;
  canonical_answer: string;
  accepted_answers: string[];
  earned_points: number | null;
  max_points: number;
  scoring_status: string;
  /** Machine verdict evidence { method, similarity, candidate } when scored automatically. */
  scoring_metadata: Record<string, unknown> | null;
  assessment_title: string;
}

export async function getIdentificationResponsesNeedingReview(
  assessmentId: string
): Promise<{ data: IdentificationReviewItem[] | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, title, subject_offering_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment) return { data: null, error: 'Assessment not found' };

  const facultyAssessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!facultyAssessment) {
    return { data: null, error: 'Not authorized' };
  }

  const { data: versions } = await supabase
    .from('assessment_versions')
    .select('id')
    .eq('assessment_id', assessmentId);

  const versionIds = (versions ?? []).map(v => v.id);
  if (versionIds.length === 0) return { data: [] };

  const { data: questions } = await supabase
    .from('questions')
    .select('id, question_text, points')
    .in('assessment_version_id', versionIds)
    .eq('question_type', 'identification');

  const questionIds = (questions ?? []).map(q => q.id);
  if (questionIds.length === 0) return { data: [] };

  const { data: answerKeys } = await supabase
    .from('answer_keys')
    .select('question_id, canonical_answer, accepted_answers')
    .in('question_id', questionIds);

  const answerKeyMap = new Map((answerKeys ?? []).map(ak => [ak.question_id, ak]));

  // Scoring columns are no longer granted to the session role — students
  // could otherwise read their own scores before release (migration
  // 20261005000000). The explicit faculty gate above has already passed, so
  // this read uses the service-role client: the same gates-then-admin pattern
  // loadAttemptBreakdown uses. Rows outside this faculty member's offerings
  // are still dropped below via the session-scoped attempts read.
  const admin = createAdminClient();
  const { data: responses } = await admin
    .from('student_responses')
    .select('id, attempt_id, question_id, text_answer, normalized_answer, earned_points, scoring_status, scoring_metadata')
    .in('question_id', questionIds)
    .not('text_answer', 'is', null)
    .neq('text_answer', '');

  if (!responses || responses.length === 0) return { data: [] };

  const attemptIds = [...new Set(responses.map(r => r.attempt_id))];
  const { data: attempts } = await supabase
    .from('exam_attempts')
    .select('id, student_id, status')
    .in('id', attemptIds);

  const attemptMap = new Map((attempts ?? []).map(a => [a.id, a]));

  const studentIds = [...new Set((attempts ?? []).map(a => a.student_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', studentIds);

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));
  const questionMap = new Map((questions ?? []).map(q => [q.id, q]));

  const result: IdentificationReviewItem[] = responses
    .filter(r => {
      const a = attemptMap.get(r.attempt_id);
      return a && (a.status === 'submitted' || a.status === 'auto_submitted');
    })
    .map(r => {
      const a = attemptMap.get(r.attempt_id)!;
      const q = questionMap.get(r.question_id);
      const ak = answerKeyMap.get(r.question_id);
      const p = profileMap.get(a.student_id);
      return {
        response_id: r.id,
        attempt_id: r.attempt_id,
        student_id: a.student_id,
        student_name: p?.full_name ?? 'Unknown',
        student_email: p?.email ?? '',
        question_id: r.question_id,
        question_text: q?.question_text ?? '',
        text_answer: r.text_answer ?? '',
        normalized_answer: r.normalized_answer,
        canonical_answer: ak?.canonical_answer ?? '',
        accepted_answers: ak?.accepted_answers ?? [],
        earned_points: r.earned_points,
        max_points: q?.points ?? 1,
        scoring_status: r.scoring_status,
        scoring_metadata: r.scoring_metadata,
        assessment_title: assessment.title,
      };
    })
    .filter(item => item.earned_points === 0 || item.scoring_status === 'pending' || item.scoring_status === 'manual_review');

  return { data: result };
}

export async function scoreIdentificationResponse(
  responseId: string,
  earnedPoints: number,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  const admin = createAdminClient();

  const { data: response } = await supabase
    .from('student_responses')
    .select('id, attempt_id, question_id')
    .eq('id', responseId)
    .single();

  if (!response) return { success: false, error: 'Response not found' };

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('deployment_id')
    .eq('id', response.attempt_id)
    .single();

  if (!attempt) return { success: false, error: 'Attempt not found' };

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('subject_offering_id')
    .eq('id', attempt.deployment_id)
    .single();

  if (!deployment) return { success: false, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { success: false, error: 'Not authorized' };
  }

  const { data: question } = await supabase
    .from('questions')
    .select('points')
    .eq('id', response.question_id)
    .single();

  if (!question) return { success: false, error: 'Question not found' };

  const clampedPoints = Math.max(0, Math.min(earnedPoints, question.points));

  // scoring_metadata is service-role only (20261005000000), so it is read
  // through the admin client — gates-then-admin — and merged, preserving the
  // machine's verdict evidence while recording the faculty override.
  const { data: currentRow } = await admin
    .from('student_responses')
    .select('scoring_metadata')
    .eq('id', responseId)
    .single();

  const { error: updateErr } = await admin
    .from('student_responses')
    .update({
      earned_points: clampedPoints,
      scoring_status: 'scored',
      scored_at: new Date().toISOString(),
      scored_by: userId,
      // Preserve the machine's verdict evidence; append who overrode it.
      scoring_metadata: {
        ...(currentRow?.scoring_metadata ?? {}),
        faculty: { points: clampedPoints, at: new Date().toISOString() },
      },
    })
    .eq('id', responseId);

  if (updateErr) return { success: false, error: updateErr.message };

  // Propagate the new score to the attempt total: without this the result row
  // kept the submit-time raw score and a faculty correction never reached
  // the student's percentage (scope §27).
  const totals = await upsertAssessmentResult(admin, response.attempt_id);
  if (!totals || !totals.ok) {
    return {
      success: false,
      error: 'Score saved, but the attempt total could not be refreshed — retry the review action.',
    };
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'score',
    entityType: 'student_response',
    entityId: responseId,
    metadata: {
      question_id: response.question_id,
      attempt_id: response.attempt_id,
      earned_points: clampedPoints,
      max_points: question.points,
    },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// AI score recommendation — scope §26 (advisory only).
// ---------------------------------------------------------------------------
// "AI may recommend a judgment for ambiguous identification answers, but
// faculty confirms final scoring where confidence is insufficient." This
// action NEVER writes earned_points/scoring_status — it stores the verdict in
// scoring_metadata.ai (service-role column) for the review UI, and the faculty
// decision still travels through scoreIdentificationResponse above.

export interface ScoreRecommendationOutcome {
  verdict: 'correct' | 'incorrect' | 'uncertain';
  confidence: number;
  rationale: string;
  /** Points the verdict implies, or null when the verdict is `uncertain`. */
  suggestedPoints: number | null;
}

export async function getScoreRecommendation(
  responseId: string
): Promise<{ success: boolean; recommendation?: ScoreRecommendationOutcome; error?: string }> {
  const { supabase, userId } = await requireUser();

  // Gates-then-admin: the session client reads only the granted columns
  // (20261005000000). Ownership of the whole response chain is verified before
  // any answer-key content is fetched or an AI call is made.
  const { data: response } = await supabase
    .from('student_responses')
    .select('id, attempt_id, question_id, text_answer')
    .eq('id', responseId)
    .single();
  if (!response) return { success: false, error: 'Response not found' };

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('id, deployment_id')
    .eq('id', response.attempt_id)
    .single();
  if (!attempt) return { success: false, error: 'Attempt not found' };

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id')
    .eq('id', attempt.deployment_id)
    .single();
  if (!deployment?.subject_offering_id) return { success: false, error: 'Deployment not found' };

  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { success: false, error: 'Not authorized' };
  }

  if (!hasChatProvider()) {
    return {
      success: false,
      error: 'No AI provider configured — set GROQ_API_KEY or OPENAI_API_KEY.',
    };
  }

  const admin = createAdminClient();

  const { data: question } = await admin
    .from('questions')
    .select(
      'question_text, points, question_type, assessment_version:assessment_versions(assessment_id)'
    )
    .eq('id', response.question_id)
    .single();
  if (!question) return { success: false, error: 'Question not found' };
  if (question.question_type !== 'identification') {
    return { success: false, error: 'AI recommendations apply to identification responses only' };
  }

  const { data: answerKey } = await admin
    .from('answer_keys')
    .select('canonical_answer, accepted_answers')
    .eq('question_id', response.question_id)
    .single();

  const assessmentId =
    (question.assessment_version as { assessment_id?: string } | null)?.assessment_id ?? null;

  const { system, user } = buildRecommendationPrompt({
    questionText: question.question_text,
    points: question.points ?? 1,
    canonicalAnswer: answerKey?.canonical_answer ?? null,
    acceptedAnswers: answerKey?.accepted_answers ?? [],
    studentAnswer: response.text_answer ?? '',
  });

  let chat: ChatCompletionResult;
  try {
    chat = await chatCompletion(system, user, { temperature: 0, maxTokens: 400 });
  } catch (err) {
    await logAiUsage({
      userId,
      assessmentId,
      provider: activeChatProvider(),
      model: '-',
      operation: 'score_recommendation',
      tokensUsed: 0,
      durationMs: 0,
      status: 'error',
      errorCode: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return { success: false, error: 'The AI provider could not be reached — try again.' };
  }

  let parsed: ScoreRecommendation;
  try {
    parsed = parseScoreRecommendation(chat.content);
  } catch {
    await logAiUsage({
      userId,
      assessmentId,
      provider: chat.provider,
      model: chat.model,
      operation: 'score_recommendation',
      tokensUsed: chat.tokensUsed,
      durationMs: chat.duration,
      status: 'error',
      errorCode: 'parse_error',
    });
    return { success: false, error: 'The AI returned an unreadable recommendation — try again.' };
  }

  // Advisory by construction: only scoring_metadata.ai is written. Read the
  // current metadata through the admin client (service-role column) and merge
  // so the machine verdict and any faculty decision survive.
  const { data: currentRow } = await admin
    .from('student_responses')
    .select('scoring_metadata')
    .eq('id', responseId)
    .single();

  const { error: metaErr } = await admin
    .from('student_responses')
    .update({
      scoring_metadata: {
        ...(currentRow?.scoring_metadata ?? {}),
        ai: {
          verdict: parsed.verdict,
          confidence: parsed.confidence,
          rationale: parsed.rationale,
          provider: chat.provider,
          model: chat.model,
          requested_by: userId,
          at: new Date().toISOString(),
        },
      },
    })
    .eq('id', responseId);

  if (metaErr) return { success: false, error: metaErr.message };

  await logAiUsage({
    userId,
    assessmentId,
    provider: chat.provider,
    model: chat.model,
    operation: 'score_recommendation',
    tokensUsed: chat.tokensUsed,
    durationMs: chat.duration,
    status: 'success',
  });

  return {
    success: true,
    recommendation: {
      verdict: parsed.verdict,
      confidence: parsed.confidence,
      rationale: parsed.rationale,
      suggestedPoints:
        parsed.verdict === 'correct'
          ? (question.points ?? 1)
          : parsed.verdict === 'incorrect'
            ? 0
            : null,
    },
  };
}
