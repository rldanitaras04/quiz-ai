import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { applyResponseOperations, normalizeOperation } from '@/lib/exam-sync';
import { recordExamEvent } from '@/lib/exam-session';

/**
 * Synchronize queued examination response operations.
 *
 * Authorization chain (every step server-side):
 *   1. authenticated caller;
 *   2. attempt ownership (session client + explicit id check);
 *   3. attempt still `in_progress` and inside the server-defined deadline;
 *   4. the presented session id + token must match the ACTIVE exam session —
 *      a device that does not hold the active session cannot write answers
 *      (concurrent-session protection);
 *   5. each operation re-validated in `applyResponseOperations` (manifest
 *      membership, choice membership, revision rules, operation idempotency).
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const attemptId = body?.attemptId;
    const sessionId = body?.sessionId;
    const sessionToken = body?.sessionToken;
    const rawOperations = body?.operations ?? body?.answers;

    // Never trust the payload shape: the offline queue can retry with stale or
    // malformed data after an upgrade.
    if (typeof attemptId !== 'string' || !attemptId) {
      return NextResponse.json({ error: 'attemptId is required' }, { status: 400 });
    }
    if (typeof sessionId !== 'string' || !sessionId) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    if (typeof sessionToken !== 'string' || !sessionToken) {
      return NextResponse.json({ error: 'sessionToken is required' }, { status: 400 });
    }
    if (!Array.isArray(rawOperations) || rawOperations.length === 0) {
      return NextResponse.json({ error: 'operations must be a non-empty array' }, { status: 400 });
    }
    if (rawOperations.length > 500) {
      return NextResponse.json({ error: 'Too many operations in one request' }, { status: 413 });
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .select('id, student_id, status, expires_at, deployment_id')
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

    // --- Active session proof (concurrent-session protection) -------------
    const admin = createAdminClient();
    const { data: session } = await admin
      .from('exam_sessions')
      .select('id, student_id, attempt_id, status, session_token')
      .eq('id', sessionId)
      .maybeSingle();

    if (
      !session ||
      session.attempt_id !== attemptId ||
      session.student_id !== user.id ||
      session.status !== 'active' ||
      session.session_token !== sessionToken
    ) {
      // Factual record for the Live Monitor: a device that cannot prove it
      // holds the active session tried to write answers.
      const reason = !session
        ? 'session_not_found'
        : session.attempt_id !== attemptId
          ? 'attempt_mismatch'
          : session.student_id !== user.id
            ? 'student_mismatch'
            : session.status !== 'active'
              ? 'session_not_active'
              : 'token_mismatch';
      await recordExamEvent(admin, {
        attemptId,
        studentId: user.id,
        deploymentId: attempt.deployment_id,
        eventType: 'invalid_session',
        metadata: { reason, sessionId },
      });
      return NextResponse.json({ error: 'Invalid exam session' }, { status: 403 });
    }

    // --- Normalize + apply (idempotent) -----------------------------------
    const operations = rawOperations
      .map(normalizeOperation)
      .filter((op): op is NonNullable<typeof op> => op !== null);

    if (operations.length === 0) {
      return NextResponse.json({ error: 'No valid operations' }, { status: 400 });
    }

    const outcome = await applyResponseOperations(admin, attemptId, operations);
    const syncedAt = new Date().toISOString();

    // Reflect the acknowledgement on the session presence row so the Faculty
    // Live Monitor sees the freshest synchronization state.
    await admin
      .from('exam_sessions')
      .update({
        sync_state: 'synced',
        last_sync_at: syncedAt,
        updated_at: syncedAt,
      })
      .eq('id', sessionId)
      .eq('status', 'active');

    await supabase
      .from('exam_attempts')
      .update({ last_sync_at: syncedAt })
      .eq('id', attemptId);

    return NextResponse.json({
      success: true,
      serverRevisions: outcome.serverRevisions,
      applied: outcome.applied,
      duplicates: outcome.duplicates,
      rejected: outcome.rejected,
      syncedAt,
    });
  } catch (error) {
    console.error('Save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
