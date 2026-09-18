import { createClient } from '@/lib/supabase/server';
import type { StudentResponse, AnswerKey } from '@/lib/types';

export function scoreMCQ(selectedChoiceId: string | null, correctChoiceId: string | null): number {
  if (!selectedChoiceId || !correctChoiceId) return 0;
  return selectedChoiceId === correctChoiceId ? 1 : 0;
}

export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ');
}

export function scoreIdentification(
  textAnswer: string | null,
  canonicalAnswer: string | null,
  acceptedAnswers: string[] | null
): number {
  if (!textAnswer) return 0;

  const normalized = normalizeAnswer(textAnswer);

  if (canonicalAnswer && normalized === normalizeAnswer(canonicalAnswer)) {
    return 1;
  }

  if (acceptedAnswers) {
    for (const accepted of acceptedAnswers) {
      if (normalized === normalizeAnswer(accepted)) {
        return 1;
      }
    }
  }

  return 0;
}

export function calculateScore(
  responses: StudentResponse[],
  answerKeys: AnswerKey[],
  questions: { id: string; points: number }[]
): { rawScore: number; possibleScore: number; percentage: number } {
  const answerKeyMap = new Map(answerKeys.map((ak) => [ak.question_id, ak]));
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  let rawScore = 0;
  let possibleScore = 0;

  for (const response of responses) {
    const question = questionMap.get(response.question_id);
    const answerKey = answerKeyMap.get(response.question_id);
    if (!question || !answerKey) continue;

    possibleScore += question.points;

    if (response.earned_points !== null) {
      rawScore += response.earned_points;
    }
  }

  const percentage = possibleScore > 0 ? (rawScore / possibleScore) * 100 : 0;

  return { rawScore, possibleScore, percentage };
}

export async function scoreAttempt(attemptId: string): Promise<{
  rawScore: number;
  possibleScore: number;
  percentage: number;
}> {
  const supabase = await createClient();

  const { data: attempt, error: attemptError } = await supabase
    .from('exam_attempts')
    .select('assessment_version_id')
    .eq('id', attemptId)
    .single();

  if (attemptError || !attempt) {
    throw new Error('Attempt not found');
  }

  const { data: questions, error: questionsError } = await supabase
    .from('questions')
    .select('id, points')
    .eq('assessment_version_id', attempt.assessment_version_id);

  if (questionsError || !questions) {
    throw new Error('Failed to fetch questions');
  }

  const questionIds = questions.map((q) => q.id);

  const { data: answerKeys, error: keysError } = await supabase
    .from('answer_keys')
    .select('*')
    .in('question_id', questionIds);

  if (keysError || !answerKeys) {
    throw new Error('Failed to fetch answer keys');
  }

  const { data: responses, error: responsesError } = await supabase
    .from('student_responses')
    .select('*')
    .eq('attempt_id', attemptId);

  if (responsesError || !responses) {
    throw new Error('Failed to fetch responses');
  }

  const answerKeyMap = new Map(answerKeys.map((ak) => [ak.question_id, ak]));
  const questionMap = new Map(questions.map((q) => [q.id, q]));

  for (const response of responses) {
    const answerKey = answerKeyMap.get(response.question_id);
    const question = questionMap.get(response.question_id);
    if (!answerKey || !question) continue;

    let earned = 0;
    if (response.selected_choice_id && answerKey.correct_choice_id) {
      earned = response.selected_choice_id === answerKey.correct_choice_id ? question.points : 0;
    } else if (response.text_answer) {
      const scored = scoreIdentification(
        response.text_answer,
        answerKey.canonical_answer,
        answerKey.accepted_answers
      );
      earned = scored * question.points;
    }

    await supabase
      .from('student_responses')
      .update({
        earned_points: earned,
        scoring_status: 'scored',
        scored_at: new Date().toISOString(),
      })
      .eq('id', response.id);
  }

  const updatedResponses = responses.map((r) => {
    const question = questionMap.get(r.question_id);
    const answerKey = answerKeyMap.get(r.question_id);
    if (!question || !answerKey) return { ...r, earned_points: 0 };

    if (r.selected_choice_id && answerKey.correct_choice_id) {
      return { ...r, earned_points: r.selected_choice_id === answerKey.correct_choice_id ? question.points : 0 };
    }
    if (r.text_answer) {
      return { ...r, earned_points: scoreIdentification(r.text_answer, answerKey.canonical_answer, answerKey.accepted_answers) * question.points };
    }
    return { ...r, earned_points: 0 };
  });

  const result = calculateScore(updatedResponses, answerKeys, questions);

  return result;
}
