'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  completeReverificationAction,
  heartbeatAction,
  openExamSessionAction,
  recordSecurityEventAction,
} from '@/app/(dashboard)/student/assessments/[assessmentId]/exam/actions';
import {
  EVENT_THROTTLE_MS,
  HEARTBEAT_INTERVAL_MS,
  resolveSecurityPolicy,
  type EffectiveSecurityPolicy,
  type SecurityEventType,
} from '@/lib/exam-security';
import {
  clearExamSession,
  loadExamSession,
  saveExamSession,
} from '@/lib/sync';

export interface HeartbeatStateInput {
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

interface ExamSessionHandle {
  sessionId: string;
  sessionToken: string;
}

/**
 * Owns the Secure Exam Shell's conversation with the server:
 *   - opens/resumes the single active examination session (with the durable
 *     per-attempt token, so reload / restart / power loss resumes instead of
 *     tripping the concurrent-session policy);
 *   - keeps server-time offset, deadline and attempt status fresh via a
 *     low-frequency heartbeat (20s + explicit event-triggered sends — never
 *     one write per second);
 *   - records factual security events with client-side throttling (severity
 *     is decided server-side);
 *   - surfaces the identity-reverification gate.
 */
export function useExamSession(options: {
  attemptId: string;
  enabled: boolean;
  getState: () => HeartbeatStateInput | null;
  onAttemptEnded?: (status: string) => void;
}) {
  const { attemptId, enabled, getState, onAttemptEnded } = options;

  const [session, setSession] = useState<ExamSessionHandle | null>(null);
  const [policy, setPolicy] = useState<EffectiveSecurityPolicy>(() =>
    resolveSecurityPolicy(null)
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferred, setTransferred] = useState(false);
  const [requiresReverification, setRequiresReverification] = useState(false);
  const [serverNowOffset, setServerNowOffset] = useState(0);
  const [attemptExpiresAt, setAttemptExpiresAt] = useState<string | null>(null);

  const sessionRef = useRef<ExamSessionHandle | null>(null);
  const eventTimesRef = useRef<Record<string, number>>({});
  const heartbeatBusyRef = useRef(false);
  const getStateRef = useRef(getState);
  const onAttemptEndedRef = useRef(onAttemptEnded);
  const openedRef = useRef(false);
  const offlineRetryCleanupRef = useRef<(() => void) | null>(null);
  const [openNonce, setOpenNonce] = useState(0);

  useEffect(() => {
    getStateRef.current = getState;
  }, [getState]);
  useEffect(() => {
    onAttemptEndedRef.current = onAttemptEnded;
  }, [onAttemptEnded]);

  /**
   * The open handshake failed without a server answer while the browser is
   * offline. That is a connectivity gap, not a session failure: keep the exam
   * shell alive (the offline badge explains the state) and reopen as soon as
   * the browser is back online instead of ending the session with a fatal
   * error screen.
   */
  const reopenWhenOnline = useCallback(() => {
    if (offlineRetryCleanupRef.current) return;
    const onOnline = () => {
      window.removeEventListener('online', onOnline);
      offlineRetryCleanupRef.current = null;
      openedRef.current = false;
      setOpenNonce((n) => n + 1);
    };
    window.addEventListener('online', onOnline);
    offlineRetryCleanupRef.current = () => {
      window.removeEventListener('online', onOnline);
      offlineRetryCleanupRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      offlineRetryCleanupRef.current?.();
    },
    []
  );

  const applyServerNow = useCallback((serverNow?: string) => {
    if (!serverNow) return;
    setServerNowOffset(new Date(serverNow).getTime() - Date.now());
  }, []);

  const reportEvent = useCallback(
    (eventType: SecurityEventType, metadata?: Record<string, unknown>) => {
      const handle = sessionRef.current;
      const now = Date.now();
      const last = eventTimesRef.current[eventType] ?? 0;
      if (now - last < EVENT_THROTTLE_MS) return;
      eventTimesRef.current[eventType] = now;

      void recordSecurityEventAction({
        attemptId,
        sessionId: handle?.sessionId ?? null,
        sessionToken: handle?.sessionToken ?? null,
        eventType,
        metadata,
      }).catch(() => {
        // Events are best-effort telemetry; never block the exam on them.
      });
    },
    [attemptId]
  );

  const sendHeartbeat = useCallback(async () => {
    const handle = sessionRef.current;
    if (!handle || heartbeatBusyRef.current) return;
    const state = getStateRef.current();
    if (!state) return;

    heartbeatBusyRef.current = true;
    try {
      const result = await heartbeatAction({
        attemptId,
        sessionId: handle.sessionId,
        sessionToken: handle.sessionToken,
        currentItem: state.currentItem,
        totalItems: state.totalItems,
        answeredCount: state.answeredCount,
        flaggedCount: state.flaggedCount,
        connectionState: state.connectionState,
        syncState: state.syncState,
        pendingSyncCount: state.pendingSyncCount,
        lastLocalSaveAt: state.lastLocalSaveAt ?? null,
        lastSyncAt: state.lastSyncAt ?? null,
      });

      if (result.error) return;
      applyServerNow(result.serverNow);
      if (result.attemptExpiresAt) setAttemptExpiresAt(result.attemptExpiresAt);
      if (typeof result.reverificationRequired === 'boolean') {
        setRequiresReverification(result.reverificationRequired);
      }
      if (
        result.attemptStatus &&
        result.attemptStatus !== 'in_progress' &&
        result.attemptStatus !== 'created'
      ) {
        onAttemptEndedRef.current?.(result.attemptStatus);
      }
    } catch {
      // Offline / transient failure — the next tick retries.
    } finally {
      heartbeatBusyRef.current = false;
    }
  }, [attemptId, applyServerNow]);

  const verifyIdentity = useCallback(
    async (password: string): Promise<{ ok: boolean; error?: string }> => {
      const handle = sessionRef.current;
      if (!handle) return { ok: false, error: 'Session not ready' };
      try {
        const result = await completeReverificationAction({
          attemptId,
          sessionId: handle.sessionId,
          sessionToken: handle.sessionToken,
          password,
        });
        if (result.success) {
          setRequiresReverification(false);
          return { ok: true };
        }
        return { ok: false, error: result.error ?? 'Verification failed' };
      } catch {
        return { ok: false, error: 'Verification failed' };
      }
    },
    [attemptId]
  );

  // Open (or resume) the session once the exam page is ready for it.
  useEffect(() => {
    if (!enabled || openedRef.current) return;
    openedRef.current = true;
    let cancelled = false;

    const offlineNow = () =>
      typeof navigator !== 'undefined' && navigator.onLine === false;

    const deferToReconnect = () => {
      if (cancelled) return;
      openedRef.current = false;
      reopenWhenOnline();
    };

    (async () => {
      try {
        const stored = await loadExamSession(attemptId);
        const navigationEntry =
          typeof performance !== 'undefined' &&
          typeof performance.getEntriesByType === 'function'
            ? (performance.getEntriesByType('navigation')[0] as
                | { type?: string }
                | undefined)
            : undefined;
        const isReload = navigationEntry?.type === 'reload';

        const result = await openExamSessionAction(attemptId, {
          presentedToken: stored?.sessionToken ?? null,
          isReload,
        });

        if (cancelled) return;
        if (result.error || !result.sessionId || !result.sessionToken) {
          if (!result.error && offlineNow()) {
            deferToReconnect();
            return;
          }
          setError(result.error ?? 'Could not open the examination session');
          return;
        }

        const handle = { sessionId: result.sessionId, sessionToken: result.sessionToken };
        sessionRef.current = handle;
        setSession(handle);
        if (result.securityPolicy) setPolicy(resolveSecurityPolicy(result.securityPolicy));
        if (result.serverNow) applyServerNow(result.serverNow);
        setTransferred(result.transferred === true);
        setRequiresReverification(result.requiresReverification === true);
        setReady(true);

        await saveExamSession({
          attemptId,
          sessionId: handle.sessionId,
          sessionToken: handle.sessionToken,
          savedAt: new Date().toISOString(),
          open: true,
        });
      } catch {
        // A failed local (IndexedDB) save after a successful handshake is not
        // a session failure — the server session is already open.
        if (sessionRef.current) return;
        if (offlineNow()) {
          deferToReconnect();
          return;
        }
        if (!cancelled) setError('Could not open the examination session');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attemptId, enabled, applyServerNow, openNonce, reopenWhenOnline]);

  // Periodic liveness fallback; state changes call sendHeartbeat directly.
  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [ready, sendHeartbeat]);

  const forgetSession = useCallback(async () => {
    sessionRef.current = null;
    setSession(null);
    await clearExamSession(attemptId);
  }, [attemptId]);

  return {
    session,
    policy,
    ready,
    error,
    transferred,
    requiresReverification,
    serverNowOffset,
    attemptExpiresAt,
    reportEvent,
    sendHeartbeat,
    verifyIdentity,
    forgetSession,
  };
}
