import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { attemptId } = await request.json();

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .select('*')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    if (attempt.student_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (attempt.status !== 'in_progress') {
      return NextResponse.json({ error: 'Attempt is not in progress' }, { status: 400 });
    }

    const submittedAt = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('exam_attempts')
      .update({
        status: 'submitted',
        submitted_at: submittedAt,
        updated_at: submittedAt,
      })
      .eq('id', attemptId);

    if (updateError) {
      return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      attempt: {
        ...attempt,
        status: 'submitted',
        submitted_at: submittedAt,
      },
    });
  } catch (error) {
    console.error('Submit error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
