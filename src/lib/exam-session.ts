import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isSecurityEventType,
  severityForEventType,
  resolveSecurityPolicy,
  type DeploymentSecurityPolicy,
  type EffectiveSecurityPolicy,
  type SecurityEventType,
} from '@/lib/exam-security';

/**
 * Server-side examination session lifecycle.
 *
 * Every function here runs inside an authenticated server action or route
 * handler: ownership is verified with the caller's session client (RLS) and
 * mutations go through the service-role client — the same pattern the rest of
 * the application uses for attempt/manifest writes.
 *
 * Invariants:
 *   - one ACTIVE session per attempt and per student+deployment, enforced by
 *     partial UNIQUE indexes in the database, not by client state;
 *   - a session mutation requires the server-issued session token, never just
 *     an id that arrived from a page;
 *   - session events are factual and severity is computed server-side from the
 *     event type — clients cannot choose a severity;
 *   - heartbeat updates the single exam_sessions row in place (no append-only
 *     heartbeat rows); meaningful transitions are persisted as exam_events.
 */

const MAX_EVENT_METADATA_CHARS = 1_000;
const EVENT_DEDUPE_WINDOW_MS = 1_200;

export interface SessionAttemptContext {
  attemptId: string;
  studentId: string;
  deploymentId: string;
  expiresAt: string;
  status: string;
}

/** Load the attempt with the caller's session client and verify ownership. */
export async function loadOwnedAttempt(
  supabase: SupabaseClient,
  attemptId: string,
  userId: string
): Promise<{ attempt?: SessionAttemptContext; error?: string }> {
  const { data, error } = await supabase
    .from('exam_attempts')
    .select('id, student_id, deployment_id, expires_at, status')
    .eq('id', attemptId)
    .maybeSingle();

  if (error || !data) return { error: 'Attempt not found' };
  if (data.student_id !== userId) return { error: 'Forbidden' };

  return {
    attempt: {
      attemptId: data.id,
      studentId: data.student_id,
      deploymentId: data.deployment_id,
      expiresAt: data.expires_at,
      status: data.status,
    },
  };
}

/** Read the deployment security policy through the caller's session client. */
export async function loadDeploymentPolicy(
  supabase: SupabaseClient,
  deploymentId: string
): Promise<{ policy: EffectiveSecurityPolicy; error?: string }> {
  const { data, error } = await supabase
    .from('assessment_deployments')
    .select(
      'security_mode, require_fullscreen, detect_fullscreen_exit, detect_tab_visibility, ' +
        'detect_focus_loss, record_page_reloads, detect_concurrent_sessions, detect_copy_attempts, ' +
        'detect_paste_attempts, detect_context_menu, require_reverification_on_recovery, ' +
        'offline_autosave, sync_on_reconnect, record_connection_events, allow_session_recovery, ' +
        'security_response_mode, requires_identity_verification'
    )
    .eq('id', deploymentId)
    .maybeSingle();

  if (error || !data) return { policy: resolveSecurityPolicy(null), error: 'Deployment not found' };
  return { policy: resolveSecurityPolicy(data as Partial<DeploymentSecurityPolicy>) };
}

/** Sanitize client-supplied metadata: size-capped, no answer contents. */
function sanitizeMetadata(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let size = 0;
  for (const [key, value] of Object.entries(source)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key)) continue;
    if (value === null) continue;
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
      size += 16;
    } else if (typeof value === 'string') {
      const clipped = value.slice(0, 200);
      out[key] = clipped;
      size += clipped.length;
    } else {
      continue; // no nested objects — keeps payloads predictable
    }
    if (size > MAX_EVENT_METADATA_CHARS) break;
  }
  return out;
}

export interface RecordEventInput {
  attemptId: string;
  studentId: string;
  deploymentId: string;
  examSessionId?: string | null;
  eventType: SecurityEventType;
  metadata?: Record<string, unknown>;
  recordedAt?: string;
}

/**
 * Persist one security/session event. Severity is derived from the event
 * type on the server. Rapid duplicates of the same type for the same attempt
 * (browser event storms) are dropped inside the de-dup window.
 */
export async function recordExamEvent(
  admin: SupabaseClient,
  input: RecordEventInput
): Promise<{ recorded: boolean; id?: string }> {
  if (!isSecurityEventType(input.eventType)) return { recorded: false };

  const since = new Date(Date.now() - EVENT_DEDUPE_WINDOW_MS).toISOString();
  const { data: recent } = await admin
    .from('exam_events')
    .select('id, recorded_at')
    .eq('attempt_id', input.attemptId)
    .eq('event_type', input.eventType)
    .gte('recorded_at', since)
    .limit(1);

  if (recent && recent.length > 0) return { recorded: false };

  const { data, error } = await admin
    .from('exam_events')
    .insert({
      attempt_id: input.attemptId,
      student_id: input.studentId,
      deployment_id: input.deploymentId,
      exam_session_id: input.examSessionId ?? null,
      event_type: input.eventType,
      severity: severityForEventType(input.eventType),
      metadata: sanitizeMetadata(input.metadata),
      recorded_at: input.recordedAt ?? new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) return { recorded: false };
  return { recorded: true, id: data.id };
}

export interface OpenSessionResult {
  error?: string;
  status?: number;
  sessionId?: string;
  sessionToken?: string;
  /** True when an existing active session was resumed (same device/token). */
  resumed?: boolean;
  /** True when an existing session was taken over under the recovery policy. */
  transferred?: boolean;
  requiresReverification?: boolean;
  policy?: EffectiveSecurityPolicy;
  serverNow?: string;
}

export interface OpenSessionInput {
  attemptId: string;
  userId: string;
  /** Token previously issued to this device, if any. */
  presentedToken: string | null;
  /** The page load was a browser reload (navigation API), if known. */
  isReload: boolean;
}

/**
 * Create or resume the single active examination session for an attempt.
 *
 * Concurrent-session policy:
 *   - an active session exists and the device presents the matching token →
 *     resume (reload / reopen / power recovery on the same device);
 *   - an active session exists but the token is missing/mismatched → record a
 *     `concurrent_session_attempt` (critical) and then either take over the
 *     session (recovery allowed) or refuse (recovery not allowed);
 *   - no active session → create one (`session_created`, or
 *     `session_recovered` when a previously-opened attempt is re-entered).
 */
export async function openExamSession(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  input: OpenSessionInput
): Promise<OpenSessionResult> {
  const owned = await loadOwnedAttempt(supabase, input.attemptId, input.userId);
  if (!owned.attempt) return { error: owned.error ?? 'Attempt not found', status: 404 };
  const attempt = owned.attempt;

  if (attempt.status !== 'in_progress') {
    return { error: 'This exam is no longer in progress.', status: 409 };
  }

  const { policy, error: policyError } = await loadDeploymentPolicy(
    supabase,
    attempt.deploymentId
  );
  if (policyError) return { error: policyError, status: 404 };

  const serverNow = new Date().toISOString();

  const { data: activeSession } = await admin
    .from('exam_sessions')
    .select('id, session_token, status, reverification_required, allow_recovery, started_at')
    .eq('attempt_id', attempt.attemptId)
    .eq('status', 'active')
    .maybeSingle();

  if (activeSession) {
    const tokenMatches =
      Boolean(input.presentedToken) && input.presentedToken === activeSession.session_token;

    if (tokenMatches) {
      await admin
        .from('exam_sessions')
        .update({ last_heartbeat_at: serverNow, updated_at: serverNow })
        .eq('id', activeSession.id);

      if (input.isReload) {
        await recordExamEvent(admin, {
          attemptId: attempt.attemptId,
          studentId: attempt.studentId,
          deploymentId: attempt.deploymentId,
          examSessionId: activeSession.id,
          eventType: 'page_reloaded',
        });
      }

      return {
        sessionId: activeSession.id,
        sessionToken: activeSession.session_token,
        resumed: true,
        requiresReverification: activeSession.reverification_required === true,
        policy,
        serverNow,
      };
    }

    // A second device/browser reached the same attempt.
    if (policy.detectConcurrentSessions) {
      await recordExamEvent(admin, {
        attemptId: attempt.attemptId,
        studentId: attempt.studentId,
        deploymentId: attempt.deploymentId,
        examSessionId: activeSession.id,
        eventType: 'concurrent_session_attempt',
        metadata: { recovery_allowed: policy.allowSessionRecovery },
      });
    }

    const allowRecovery = activeSession.allow_recovery ?? policy.allowSessionRecovery;
    if (!allowRecovery) {
      return {
        error:
          'This exam is already open in another session. Session recovery is not permitted for this assessment.',
        status: 409,
      };
    }

    // Authorized transfer: close the previous session, open one here.
    await admin
      .from('exam_sessions')
      .update({
        status: 'transferred',
        ended_at: serverNow,
        close_reason: 'transferred_to_new_session',
        updated_at: serverNow,
      })
      .eq('id', activeSession.id)
      .eq('status', 'active');
  }

  const hadPreviousSession = await hasSessionHistory(admin, attempt.attemptId);

  const recovered = hadPreviousSession || Boolean(activeSession);

  // Policy: identity reverification after a qualifying interruption.
  const requireReverification = recovered && policy.requireReverificationOnRecovery;

  const { data: created, error: createError } = await admin
    .from('exam_sessions')
    .insert({
      attempt_id: attempt.attemptId,
      student_id: attempt.studentId,
      deployment_id: attempt.deploymentId,
      status: 'active',
      reverification_required: requireReverification,
      last_heartbeat_at: serverNow,
      started_at: serverNow,
    })
    .select('id, session_token, reverification_required')
    .single();

  if (createError || !created) {
    // Unique violation: another session won the race between read and insert.
    return { error: 'Could not open an examination session', status: 409 };
  }

  await recordExamEvent(admin, {
    attemptId: attempt.attemptId,
    studentId: attempt.studentId,
    deploymentId: attempt.deploymentId,
    examSessionId: created.id,
    eventType: recovered ? 'session_recovered' : 'session_created',
    metadata: recovered ? { transfer: Boolean(activeSession) } : undefined,
  });

  if (!hadPreviousSession && !activeSession) {
    await recordExamEvent(admin, {
      attemptId: attempt.attemptId,
      studentId: attempt.studentId,
      deploymentId: attempt.deploymentId,
      examSessionId: created.id,
      eventType: 'exam_started',
    });
  }

  if (requireReverification) {
    await recordExamEvent(admin, {
      attemptId: attempt.attemptId,
      studentId: attempt.studentId,
      deploymentId: attempt.deploymentId,
      examSessionId: created.id,
      eventType: 'identity_reverification_required',
      metadata: { trigger: 'session_recovery' },
    });
  }

  return {
    sessionId: created.id,
    sessionToken: created.session_token,
    resumed: false,
    transferred: Boolean(activeSession),
    requiresReverification: created.reverification_required === true,
    policy,
    serverNow,
  };
}

async function hasSessionHistory(admin: SupabaseClient, attemptId: string): Promise<boolean> {
  const { count } = await admin
    .from('exam_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('attempt_id', attemptId);
  return (count ?? 0) > 0;
}

export interface HeartbeatInput {
  sessionId: string;
  sessionToken: string;
  attemptId: string;
  currentItem: number;
  totalItems: number;
  answeredCount: number;
  flaggedCount: number;
  connectionState: 'online' | 'offline' | 'unknown';
  syncState: 'synced' | 'syncing' | 'pending' | 'error';
  pendingSyncCount: number;
  lastLocalSaveAt?: string | null;
  lastSyncAt?: string | null;
}

export interface HeartbeatResult {
  error?: string;
  status?: number;
  /** Server clock, so the client keeps its display honest. */
  serverNow?: string;
  attemptStatus?: string;
  attemptExpiresAt?: string;
  reverificationRequired?: boolean;
  /** True when faculty asked the student to reconfirm their password. */
  transferPending?: boolean;
}

/**
 * Update the single session presence row. No answer contents are accepted.
 * The response carries the authoritative attempt state so the client learns
 * about faculty interventions (extra time, reverification, termination)
 * without polling or reloading.
 */
export async function handleHeartbeat(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  userId: string,
  input: HeartbeatInput
): Promise<HeartbeatResult> {
  const owned = await loadOwnedAttempt(supabase, input.attemptId, userId);
  if (!owned.attempt) return { error: 'Attempt not found', status: 404 };

  const { data: session } = await admin
    .from('exam_sessions')
    .select('id, student_id, attempt_id, status, session_token')
    .eq('id', input.sessionId)
    .maybeSingle();

  if (!session || session.student_id !== userId || session.attempt_id !== input.attemptId) {
    return { error: 'Invalid session', status: 403 };
  }
  // The session id alone is never trusted: the server-issued token must match.
  if (!input.sessionToken || session.session_token !== input.sessionToken) {
    return { error: 'Invalid session token', status: 403 };
  }
  if (session.status !== 'active') {
    return { error: 'Session is closed', status: 409 };
  }

  const now = new Date().toISOString();

  const { error: updateError } = await admin
    .from('exam_sessions')
    .update({
      current_item: clampInt(input.currentItem, 1, 10_000),
      total_items: clampInt(input.totalItems, 0, 10_000),
      answered_count: clampInt(input.answeredCount, 0, 10_000),
      flagged_count: clampInt(input.flaggedCount, 0, 10_000),
      connection_state: input.connectionState,
      sync_state: input.syncState,
      pending_sync_count: clampInt(input.pendingSyncCount, 0, 100_000),
      last_local_save_at: input.lastLocalSaveAt ?? null,
      last_sync_at: input.lastSyncAt ?? null,
      last_heartbeat_at: now,
      updated_at: now,
    })
    .eq('id', input.sessionId)
    .eq('status', 'active');

  if (updateError) return { error: 'Could not update session', status: 500 };

  const { data: attemptRow } = await admin
    .from('exam_attempts')
    .select('status, expires_at')
    .eq('id', input.attemptId)
    .maybeSingle();

  const { data: freshSession } = await admin
    .from('exam_sessions')
    .select('reverification_required')
    .eq('id', input.sessionId)
    .maybeSingle();

  return {
    serverNow: now,
    attemptStatus: attemptRow?.status,
    attemptExpiresAt: attemptRow?.expires_at,
    reverificationRequired: freshSession?.reverification_required === true,
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** Close the active session for an attempt (submission / termination). */
export async function closeActiveSession(
  admin: SupabaseClient,
  attemptId: string,
  reason: 'submitted' | 'terminated' | 'expired'
): Promise<void> {
  const now = new Date().toISOString();
  await admin
    .from('exam_sessions')
    .update({
      status: reason === 'terminated' ? 'terminated' : 'closed',
      ended_at: now,
      close_reason: reason,
      updated_at: now,
    })
    .eq('attempt_id', attemptId)
    .eq('status', 'active');
}
