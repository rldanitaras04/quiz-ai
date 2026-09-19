'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export interface BreakdownResponse {
  questionId: string;
  position: number | null;
  questionText: string;
  questionType: string;
  points: number;
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
    .select('student_id')
    .eq('id', attemptId)
    .single();

  if (!attempt) return { error: 'Attempt not found' };
  if (attempt.student_id !== user.id) return { error: 'Forbidden' };

  // RLS denies students SELECT on questions/answer_keys (by design), so the
  // breakdown is fetched with the service-role client after the ownership
  // check above. Only post-submission attempts expose any of this.
  const { data: attemptStatus } = await supabase
    .from('exam_attempts')
    .select('status')
    .eq('id', attemptId)
    .single();
  if (!attemptStatus || attemptStatus.status === 'in_progress') {
    return { error: 'Breakdown is only available after submission' };
  }

  const admin = createAdminClient();

  const { data: responses } = await admin
    .from('student_responses')
    .select('question_id, selected_choice_id, text_answer, earned_points')
    .eq('attempt_id', attemptId);

  if (!responses || responses.length === 0) return { data: [] };

  const questionIds = responses.map((r) => r.question_id);

  const { data: questions } = await admin
    .from('questions')
    .select('id, question_text, question_type, points, position, question_choices(id, choice_key, choice_text), answer_key:answer_keys(correct_choice_id, canonical_answer)')
    .in('id', questionIds)
    .order('position', { ascending: true });

  if (!questions) return { error: 'Failed to load breakdown' };

  interface BreakdownQuestionRow {
    id: string;
    question_text: string;
    question_type: string;
    points: number;
    position: number | null;
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
