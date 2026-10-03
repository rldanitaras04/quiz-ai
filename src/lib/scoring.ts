import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentResponse, AnswerKey, ScoringStatus } from '@/lib/types';
import { matchIdentification, normalizeIdentification } from '@/lib/identification-match';

export function scoreMCQ(selectedChoiceId: string | null, correctChoiceId: string | null): number {
  if (!selectedChoiceId || !correctChoiceId) return 0;
  return selectedChoiceId === correctChoiceId ? 1 : 0;
}

/** Kept for API stability — delegates to the tiered matcher's normalizer. */
export function normalizeAnswer(text: string): string {
  return normalizeIdentification(text);
}

interface ScoreVerdict {
  /** NULL = held for faculty review (counts as 0 provisionally). */
  earned: number | null;
  status: ScoringStatus;
  metadata: Record<string, unknown> | null;
  normalized: string | null;
}

function judgeResponse(
  response: StudentResponse,
  answerKey: AnswerKey,
  questionPoints: number
): ScoreVerdict {
  if (response.selected_choice_id && answerKey.correct_choice_id) {
    return {
      earned: scoreMCQ(response.selected_choice_id, answerKey.correct_choice_id)
        ? questionPoints
        : 0,
      status: 'auto_scored',
      metadata: { method: 'choice' },
      normalized: null,
    };
  }

  if (response.text_answer) {
    const normalized = normalizeIdentification(response.text_answer);
    const verdict = matchIdentification(
      response.text_answer,
      answerKey.canonical_answer,
      answerKey.accepted_answers
    );
    const metadata: Record<string, unknown> = {
      method: verdict.method,
      similarity: Math.round(verdict.similarity * 1000) / 1000,
    };
    if (verdict.candidate) metadata.candidate = verdict.candidate;

    if (verdict.outcome === 'manual_review') {
      // Held: earned_points stays NULL so provisional results count 0 while
      // the attempt total still includes the item's possible points.
      return { earned: null, status: 'manual_review', metadata, normalized };
    }
    return {
      earned: verdict.outcome === 'correct' ? questionPoints : 0,
      status: 'auto_scored',
      metadata,
      normalized,
    };
  }

  // Unanswered (no choice, no text): definitively 0.
  return { earned: 0, status: 'auto_scored', metadata: { method: 'none' }, normalized: null };
}

/**
 * Score an attempt. Pass a service-role client when called from API routes:
 * answer keys and questions are not readable by students under RLS, so
 * scoring must run with elevated read access.
 */
export async function scoreAttempt(
  attemptId: string,
  supabase?: SupabaseClient
): Promise<{
  rawScore: number;
  possibleScore: number;
  percentage: number;
}> {
  const db = supabase ?? (await createClient());

  const { data: attempt, error: attemptError } = await db
    .from('exam_attempts')
    .select('assessment_version_id')
    .eq('id', attemptId)
    .single();

  if (attemptError || !attempt) {
    throw new Error('Attempt not found');
  }

  const { data: questions, error: questionsError } = await db
    .from('questions')
    .select('id, points')
    .eq('assessment_version_id', attempt.assessment_version_id);

  if (questionsError || !questions) {
    throw new Error('Failed to fetch questions');
  }

  const questionIds = questions.map((q) => q.id);

  const { data: answerKeys, error: keysError } = await db
    .from('answer_keys')
    .select('*')
    .in('question_id', questionIds);

  if (keysError || !answerKeys) {
    throw new Error('Failed to fetch answer keys');
  }

  const { data: responses, error: responsesError } = await db
    .from('student_responses')
    .select('*')
    .eq('attempt_id', attemptId);

  if (responsesError || !responses) {
    throw new Error('Failed to fetch responses');
  }

  const answerKeyMap = new Map((answerKeys ?? []).map((k) => [k.question_id, k]));
  const questionMap = new Map((questions ?? []).map((q) => [q.id, q]));
  const now = new Date().toISOString();

  const earnedById = new Map<string, number | null>();

  for (const response of responses) {
    const answerKey = answerKeyMap.get(response.question_id);
    const question = questionMap.get(response.question_id);
    if (!answerKey || !question) continue;

    // A faculty decision is final: the machine never overwrites a human score
    // (release re-score, the score route, or a re-submit must not clobber a
    // review override).
    if (response.scored_by !== null && response.scored_by !== undefined) {
      earnedById.set(response.id, response.earned_points);
      continue;
    }

    const verdict = judgeResponse(response, answerKey, question.points);
    earnedById.set(response.id, verdict.earned);

    await db
      .from('student_responses')
      .update({
        earned_points: verdict.earned,
        scoring_status: verdict.status,
        scored_at: now,
        scoring_metadata: verdict.metadata ?? {},
        ...(verdict.normalized !== null ? { normalized_answer: verdict.normalized } : {}),
      })
      .eq('id', response.id);
  }

  const updatedResponses: StudentResponse[] = responses.map((r) => ({
    ...r,
    earned_points: earnedById.has(r.id) ? earnedById.get(r.id) ?? 0 : 0,
  }));

  const result = calculateScore(updatedResponses, answerKeys, questions);
  return result;
}

export function calculateScore(
  responses: StudentResponse[],
  answerKeys: AnswerKey[],
  questions: { id: string; points: number }[]
): { rawScore: number; possibleScore: number; percentage: number } {
  const answerKeyMap = new Map(answerKeys.map((k) => [k.question_id, k]));
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  let rawScore = 0;
  let possibleScore = 0;

  for (const response of responses) {
    const answerKey = answerKeyMap.get(response.question_id);
    const question = questionMap.get(response.question_id);
    if (!question || !answerKey) continue;

    possibleScore += question.points;

    if (response.earned_points !== null) {
      rawScore += response.earned_points;
    }
    // NULL earned_points = held for faculty: contributes 0 to raw while the
    // item's full value still counts toward the possible total.
  }

  const percentage = possibleScore > 0 ? (rawScore / possibleScore) * 100 : 0;
  return { rawScore, possibleScore, percentage };
}

// ---------------------------------------------------------------------------
// assessment_results upsert — the single source of truth for attempt totals.
// ---------------------------------------------------------------------------

export interface AttemptTotals {
  rawScore: number;
  possibleScore: number;
  deploymentId: string;
}

/**
 * Recompute an attempt's totals from its responses and upsert the matching
 * assessment_results row (update raw/possible when present, insert a pending
 * row otherwise — never touches an existing `status`, so released results keep
 * their release state when a faculty review changes a score).
 *
 * Called at submit time (exam actions), on the score route, during release
 * backfill (deploy actions) and after a faculty review decision so a scoring
 * change always propagates to the attempt total (scope §27:
 * percentage = earned / possible * 100).
 *
 * Returns null when the attempt cannot be read (callers treat that as a
 * scoring failure). Throws nothing otherwise — writes surface errors in the
 * return value via `ok`.
 */
export async function upsertAssessmentResult(
  db: SupabaseClient,
  attemptId: string,
  fallback: { studentId?: string; deploymentId?: string } = {}
): Promise<(AttemptTotals & { ok: boolean }) | null> {
  const { data: attempt, error: attemptErr } = await db
    .from('exam_attempts')
    .select('student_id, deployment_id, assessment_version_id')
    .eq('id', attemptId)
    .single();
  if (attemptErr || !attempt) {
    console.error('upsertAssessmentResult: attempt lookup failed:', attemptErr?.message);
    return null;
  }

  const { data: responses } = await db
    .from('student_responses')
    .select('earned_points')
    .eq('attempt_id', attemptId);

  const rawScore = (responses ?? []).reduce((sum, r) => sum + (r.earned_points ?? 0), 0);

  let possibleScore = 0;
  if (attempt.assessment_version_id) {
    const { data: qs } = await db
      .from('questions')
      .select('points')
      .eq('assessment_version_id', attempt.assessment_version_id);
    possibleScore = (qs ?? []).reduce((sum, q) => sum + (q.points ?? 0), 0);
  }

  const now = new Date().toISOString();
  const totals: AttemptTotals & { ok: boolean } = {
    rawScore,
    possibleScore,
    deploymentId: attempt.deployment_id ?? fallback.deploymentId ?? '',
    ok: true,
  };

  const { data: updated, error: updErr } = await db
    .from('assessment_results')
    .update({
      raw_score: rawScore,
      possible_score: possibleScore || 1,
      updated_at: now,
    })
    .eq('attempt_id', attemptId)
    .select('id');
  if (updErr) {
    console.error('upsertAssessmentResult: update failed:', updErr.message);
    totals.ok = false;
    return totals;
  }

  if (!updated || updated.length === 0) {
    const { error: insErr } = await db.from('assessment_results').insert({
      attempt_id: attemptId,
      student_id: attempt.student_id ?? fallback.studentId,
      deployment_id: attempt.deployment_id ?? fallback.deploymentId,
      raw_score: rawScore,
      possible_score: possibleScore || 1,
      status: 'pending',
    });
    if (insErr) {
      console.error('upsertAssessmentResult: insert failed:', insErr.message);
      totals.ok = false;
    }
  }

  return totals;
}
