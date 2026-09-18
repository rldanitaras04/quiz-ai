import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { scoreAttempt } from '@/lib/scoring';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { attemptId } = await request.json();

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .select('id, student_id, deployment_id, status')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    if (attempt.status !== 'submitted' && attempt.status !== 'auto_submitted') {
      return NextResponse.json({ error: 'Attempt not submitted' }, { status: 400 });
    }

    const { rawScore, possibleScore, percentage } = await scoreAttempt(attemptId);

    const { data: existingResult } = await supabase
      .from('assessment_results')
      .select('id')
      .eq('attempt_id', attemptId)
      .single();

    if (existingResult) {
      await supabase
        .from('assessment_results')
        .update({
          raw_score: rawScore,
          possible_score: possibleScore,
          percentage,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingResult.id);
    } else {
      await supabase
        .from('assessment_results')
        .insert({
          attempt_id: attemptId,
          student_id: attempt.student_id,
          deployment_id: attempt.deployment_id,
          raw_score: rawScore,
          possible_score: possibleScore,
          percentage,
          status: 'pending',
        });
    }

    const { data: deployment } = await supabase
      .from('assessment_deployments')
      .select('score_release_mode')
      .eq('id', attempt.deployment_id)
      .single();

    if (deployment?.score_release_mode === 'immediate') {
      const { data: result } = await supabase
        .from('assessment_results')
        .select('id')
        .eq('attempt_id', attemptId)
        .single();

      if (result) {
        await supabase
          .from('assessment_results')
          .update({
            status: 'released',
            released_at: new Date().toISOString(),
          })
          .eq('id', result.id);
      }
    }

    return NextResponse.json({
      success: true,
      rawScore,
      possibleScore,
      percentage,
    });
  } catch (error) {
    console.error('Score error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
