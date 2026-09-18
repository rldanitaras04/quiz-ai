import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { attemptId, answers } = await request.json();

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .select('student_id, status, expires_at')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    if (attempt.student_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (attempt.status !== 'in_progress') {
      return NextResponse.json({ error: 'Attempt is no longer in progress' }, { status: 400 });
    }

    const now = new Date();
    const expiresAt = new Date(attempt.expires_at);
    if (now > expiresAt) {
      return NextResponse.json({ error: 'Time has expired' }, { status: 400 });
    }

    const { data: manifest } = await supabase
      .from('exam_manifests')
      .select('question_order')
      .eq('attempt_id', attemptId)
      .single();

    const validQuestionIds = new Set(manifest?.question_order ?? []);

    const serverRevisions: Record<string, number> = {};

    for (const answer of answers) {
      if (!validQuestionIds.has(answer.questionId)) {
        continue;
      }

      const { data: existing } = await supabase
        .from('student_responses')
        .select('id, client_revision, server_revision')
        .eq('attempt_id', attemptId)
        .eq('question_id', answer.questionId)
        .single();

      if (existing && answer.clientRevision < existing.server_revision) {
        serverRevisions[answer.questionId] = existing.server_revision;
        continue;
      }

      if (existing) {
        const { data: updated } = await supabase
          .from('student_responses')
          .update({
            selected_choice_id: answer.selectedChoiceId,
            text_answer: answer.textAnswer,
            client_revision: answer.clientRevision,
            server_revision: existing.server_revision + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
          .select('server_revision')
          .single();

        serverRevisions[answer.questionId] = updated?.server_revision ?? existing.server_revision + 1;
      } else {
        const { data: created } = await supabase
          .from('student_responses')
          .insert({
            attempt_id: attemptId,
            question_id: answer.questionId,
            selected_choice_id: answer.selectedChoiceId,
            text_answer: answer.textAnswer,
            client_revision: answer.clientRevision,
            server_revision: 1,
          })
          .select('server_revision')
          .single();

        serverRevisions[answer.questionId] = created?.server_revision ?? 1;
      }
    }

    await supabase
      .from('exam_attempts')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', attemptId);

    return NextResponse.json({ success: true, serverRevisions });
  } catch (error) {
    console.error('Save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
