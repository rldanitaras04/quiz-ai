import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { startExamAttempt, isStartExamSuccess } from '@/lib/exam';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deploymentId } = await request.json();

    // Eligibility, attempt-limit handling and manifest generation all live in
    // lib/exam.ts so this route and the student server action cannot drift
    // apart.
    const outcome = await startExamAttempt(supabase, user.id, deploymentId);

    if (!isStartExamSuccess(outcome)) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }

    const { attempt, manifest, questions, choiceOrder } = outcome;

    // Only ship fields the exam UI needs — never internal metadata.
    const questionsForStudent = questions.map((q) => ({
      id: q.id,
      question_type: q.question_type,
      question_text: q.question_text,
      difficulty: q.difficulty,
      bloom_level: q.bloom_level,
      points: q.points,
      position: q.position,
      question_choices: (q.question_choices ?? [])
        .filter((c) => choiceOrder[q.id]?.includes(c.id))
        .sort(
          (a, b) =>
            (choiceOrder[q.id]?.indexOf(a.id) ?? 0) -
            (choiceOrder[q.id]?.indexOf(b.id) ?? 0)
        )
        .map((c) => ({
          id: c.id,
          choice_key: c.choice_key,
          choice_text: c.choice_text,
          position: c.position,
        })),
    }));

    return NextResponse.json({
      attempt,
      manifest,
      questions: questionsForStudent,
    });
  } catch (error) {
    console.error('Exam start error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
