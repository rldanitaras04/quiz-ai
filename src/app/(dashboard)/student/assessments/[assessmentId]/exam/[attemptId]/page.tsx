'use client';

import { use, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/hooks';
import ExamTimer from '@/components/exam/ExamTimer';
import ExamQuestion from '@/components/exam/ExamQuestion';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import Input from '@/components/ui/Input';
import { getAttemptDetails, submitExam } from '../actions';
import {
  clearLocalAnswers,
  getPendingOperations,
  markAnswersSyncFailed,
  markAnswersSynced,
  saveAnswerLocally,
  syncOperationsToServer,
  type StoredAnswer,
} from '@/lib/sync';
import { useExamSession, type HeartbeatStateInput } from '@/components/exam/useExamSession';
import { useSecurityListeners } from '@/components/exam/useSecurityListeners';
import ExamShell from '@/components/layout/ExamShell';
import { QUESTION_TYPE_LABELS, QUESTION_TYPE_SHORT_LABELS } from '@/lib/constants';
import type {
  ExamAttempt,
  ExamManifest,
  QuestionWithChoices,
} from '@/lib/types';

interface AnswerState {
  selectedChoiceId: string | null;
  textAnswer: string;
  clientRevision: number;
}

const AUTO_SAVE_INTERVAL = 30_000;
const DEBOUNCE_DELAY = 2_000;
const PENDING_RETRY_INTERVAL = 10_000;

type SyncBadge =
  | { kind: 'saving'; label: 'Saving' }
  | { kind: 'local'; label: 'Saved Locally'; at: string }
  | { kind: 'syncing'; label: 'Syncing' }
  | { kind: 'synced'; label: 'Synced'; at: string }
  | { kind: 'offline'; label: 'Offline — Saved on this Device'; pending: number }
  | { kind: 'pending'; label: 'Sync Pending'; pending: number }
  | { kind: 'error'; label: 'Sync Error' };

export default function ExamPage({
  params,
}: {
  params: Promise<{ assessmentId: string; attemptId: string }>;
}) {
  const { assessmentId, attemptId } = use(params);
  const router = useRouter();
  const { loading: userLoading } = useUser();

  const [attempt, setAttempt] = useState<ExamAttempt | null>(null);
  const [manifest, setManifest] = useState<ExamManifest | null>(null);
  const [questions, setQuestions] = useState<QuestionWithChoices[]>([]);
  const [answers, setAnswers] = useState<Map<string, AnswerState>>(new Map());
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attemptClosedMessage, setAttemptClosedMessage] = useState<string | null>(null);

  // --- synchronization state machine ---------------------------------------
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingSync, setPendingSync] = useState(0);
  const [syncError, setSyncError] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deadlineSkipNotice, setDeadlineSkipNotice] = useState<number | null>(null);

  // --- examination security UI state ---------------------------------------
  const [showFullscreenWarning, setShowFullscreenWarning] = useState(false);
  const [reverificationPassword, setReverificationPassword] = useState('');
  const [reverificationError, setReverificationError] = useState<string | null>(null);
  const [reverificationBusy, setReverificationBusy] = useState(false);

  const answersRef = useRef(answers);
  const flaggedRef = useRef(flagged);
  const attemptRef = useRef(attempt);
  const currentIndexRef = useRef(currentIndex);
  const pendingSyncRef = useRef(pendingSync);
  const syncErrorRef = useRef(syncError);
  const syncingRef = useRef(syncing);
  const questionsRef = useRef(questions);
  const lastSavedAtRef = useRef(lastSavedAt);
  const lastSyncedAtRef = useRef(lastSyncedAt);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSubmittingRef = useRef(false);
  const isOnlineRef = useRef(isOnline);
  const sessionOpenedRef = useRef(false);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { flaggedRef.current = flagged; }, [flagged]);
  useEffect(() => { attemptRef.current = attempt; }, [attempt]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { pendingSyncRef.current = pendingSync; }, [pendingSync]);
  useEffect(() => { syncErrorRef.current = syncError; }, [syncError]);
  useEffect(() => { syncingRef.current = syncing; }, [syncing]);
  useEffect(() => { questionsRef.current = questions; }, [questions]);
  useEffect(() => { lastSavedAtRef.current = lastSavedAt; }, [lastSavedAt]);
  useEffect(() => { lastSyncedAtRef.current = lastSyncedAt; }, [lastSyncedAt]);

  // -------------------------------------------------------------------------
  // Heartbeat state provider (no answer contents leave the browser)
  // -------------------------------------------------------------------------
  const getHeartbeatState = useCallback((): HeartbeatStateInput | null => {
    const a = attemptRef.current;
    if (!a) return null;
    const answeredCount = Array.from(answersRef.current.values()).filter(
      (ans) => !!(ans.selectedChoiceId || ans.textAnswer?.trim())
    ).length;
    const pending = pendingSyncRef.current;
    const syncState: HeartbeatStateInput['syncState'] = !isOnlineRef.current
      ? pending > 0
        ? 'pending'
        : 'synced'
      : syncErrorRef.current
        ? 'error'
        : syncingRef.current
          ? 'syncing'
          : pending > 0
            ? 'pending'
            : 'synced';

    return {
      currentItem: currentIndexRef.current + 1,
      totalItems: questionsRef.current.length,
      answeredCount,
      flaggedCount: flaggedRef.current.size,
      connectionState: isOnlineRef.current ? 'online' : 'offline',
      syncState,
      pendingSyncCount: pending,
      lastLocalSaveAt: lastSavedAtRef.current?.toISOString() ?? null,
      lastSyncAt: lastSyncedAtRef.current?.toISOString() ?? null,
    };
  }, []);

  const handleAttemptEnded = useCallback((status: string) => {
    if (isSubmittingRef.current) return;
    setAttemptClosedMessage(
      status === 'invalidated'
        ? 'This attempt has been closed by your instructor.'
        : 'This attempt is no longer in progress.'
    );
  }, []);

  // -------------------------------------------------------------------------
  // Session (single active examination session, heartbeat, events, recovery)
  // -------------------------------------------------------------------------
  const examSession = useExamSession({
    attemptId,
    enabled: !loading && !error && Boolean(attempt) && attempt?.status === 'in_progress',
    getState: getHeartbeatState,
    onAttemptEnded: handleAttemptEnded,
  });

  const {
    policy,
    ready: sessionReady,
    error: sessionError,
    transferred: sessionTransferred,
    requiresReverification,
    serverNowOffset,
    attemptExpiresAt,
    reportEvent,
    sendHeartbeat,
    verifyIdentity,
    forgetSession,
  } = examSession;

  // -------------------------------------------------------------------------
  // Synchronization queue
  // -------------------------------------------------------------------------
  const flushPendingOperations = useCallback(async (): Promise<boolean> => {
    const a = attemptRef.current;
    const handle = examSession.session;
    if (!a || !handle) return false;
    if (syncingRef.current) return false;

    try {
      const pending = await getPendingOperations(a.id);
      if (pending.length === 0) {
        setPendingSync(0);
        setSyncError(false);
        return true;
      }

      if (!isOnlineRef.current) {
        setPendingSync(pending.length);
        return false;
      }

      setSyncing(true);
      setSyncError(false);
      reportEvent('pending_sync_started', { operations: pending.length });

      const payload = pending.map((r) => ({
        operationId: r.operationId,
        questionId: r.questionId,
        selectedChoiceId: r.selectedChoiceId,
        textAnswer: r.textAnswer,
        clientRevision: r.clientRevision,
      }));

      const response = await syncOperationsToServer(
        a.id,
        handle.sessionId,
        handle.sessionToken,
        payload
      );

      // Revisions are paired back with the operation ids we sent so a save
      // made DURING the request keeps its record pending (it has a new id).
      const ack = payload
        .filter((op) => typeof response.serverRevisions?.[op.questionId] === 'number')
        .map((op) => ({
          questionId: op.questionId,
          operationId: op.operationId,
          serverRevision: response.serverRevisions[op.questionId],
        }));

      const unanswered = payload.filter(
        (op) => typeof response.serverRevisions?.[op.questionId] !== 'number'
      );
      if (unanswered.length > 0) {
        await markAnswersSyncFailed(
          a.id,
          unanswered.map((op) => op.questionId),
          'Rejected by server'
        );
      }

      await markAnswersSynced(a.id, ack);

      // Reconcile React state with authoritative server revisions.
      const serverRevisions = response.serverRevisions ?? {};
      setAnswers((prev) => {
        const next = new Map(prev);
        for (const [qId, serverRev] of Object.entries(serverRevisions)) {
          const existing = next.get(qId);
          if (existing) {
            next.set(qId, {
              ...existing,
              clientRevision: Math.max(existing.clientRevision, serverRev),
            });
          }
        }
        return next;
      });

      const remaining = await getPendingOperations(a.id);
      setPendingSync(remaining.length);
      setSyncError(false);
      setLastSyncedAt(new Date());
      if (remaining.length === 0) {
        reportEvent('pending_sync_completed', { operations: payload.length });
        void sendHeartbeat();
      }
      return remaining.length === 0;
    } catch (err) {
      setSyncError(true);
      const message = err instanceof Error ? err.message : 'Sync failed';
      try {
        const pending = await getPendingOperations(a.id);
        await markAnswersSyncFailed(
          a.id,
          pending.map((p) => p.questionId),
          message
        );
      } catch {
        // Queue stays intact regardless — IndexedDB record is the source.
      }
      return false;
    } finally {
      setSyncing(false);
    }
  }, [examSession.session, reportEvent, sendHeartbeat]);

  /**
   * Durably persist the in-memory answers first, then synchronize if online.
   * "Saved" (this device) and "Synced" (server acknowledged) are different
   * states and are reported as such.
   */
  const saveAnswers = useCallback(async () => {
    if (!attemptRef.current || isSubmittingRef.current) return;

    const currentAnswers = answersRef.current;
    if (currentAnswers.size === 0) return;

    setSaving(true);
    try {
      for (const [questionId, state] of currentAnswers.entries()) {
        await saveAnswerLocally(
          attemptRef.current.id,
          questionId,
          state.selectedChoiceId,
          state.textAnswer
        );
      }
      setLastSavedAt(new Date());

      const pending = await getPendingOperations(attemptRef.current.id);
      setPendingSync(pending.length);

      if (isOnlineRef.current && pending.length > 0) {
        await flushPendingOperations();
      }
    } catch {
      // Local write failed (storage unavailable) — surface as sync error.
      setSyncError(true);
    } finally {
      setSaving(false);
    }
  }, [flushPendingOperations]);

  // -------------------------------------------------------------------------
  // Connectivity
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      isOnlineRef.current = true;
      if (policy.recordConnectionEvents) reportEvent('connection_restored');
      if (policy.syncOnReconnect && attemptRef.current && sessionOpenedRef.current) {
        void flushPendingOperations();
      }
      void sendHeartbeat();
    };
    const handleOffline = () => {
      setIsOnline(false);
      isOnlineRef.current = false;
      if (policy.recordConnectionEvents) reportEvent('connection_lost');
      void sendHeartbeat();
    };

    isOnlineRef.current = navigator.onLine;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [policy, reportEvent, flushPendingOperations, sendHeartbeat]);

  // -------------------------------------------------------------------------
  // Initial load
  // -------------------------------------------------------------------------
  async function getLocalAnswersWithFallback(id: string): Promise<StoredAnswer[]> {
    try {
      const { getLocalAnswers } = await import('@/lib/sync');
      return await getLocalAnswers(id);
    } catch {
      return [];
    }
  }

  useEffect(() => {
    async function load() {
      if (userLoading) return;

      const result = await getAttemptDetails(attemptId, assessmentId);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }

      if (!result.data) {
        setError('No data returned');
        setLoading(false);
        return;
      }

      const { attempt: a, manifest: m, questions: q, responses } = result.data;

      if (a.status !== 'in_progress') {
        setError('This exam is no longer in progress.');
        setLoading(false);
        return;
      }

      setAttempt(a);
      setManifest(m);
      setQuestions(q);
      questionsRef.current = q;

      // Rebuild the answer map from the server copy plus anything still queued
      // in IndexedDB. The local copy only wins when it holds a revision the
      // server has not acknowledged — so a reload restores the paper instead of
      // showing every question blank, while never resurrecting stale data.
      const serverByQuestion = new Map(responses.map((r) => [r.questionId, r]));
      const localAnswers = await getLocalAnswersWithFallback(a.id);
      const localByQuestion = new Map(localAnswers.map((l) => [l.questionId, l]));

      const initialAnswers = new Map<string, AnswerState>();
      q.forEach((question) => {
        const server = serverByQuestion.get(question.id);
        const local = localByQuestion.get(question.id);
        const useLocal = Boolean(local) && local!.clientRevision > (server?.serverRevision ?? 0);
        const source = useLocal ? local! : server;
        initialAnswers.set(question.id, {
          selectedChoiceId: source?.selectedChoiceId ?? null,
          textAnswer: source?.textAnswer ?? '',
          clientRevision: Math.max(local?.clientRevision ?? 0, server?.serverRevision ?? 0),
        });
      });
      setAnswers(initialAnswers);

      const unsynced = localAnswers.filter(
        (l) =>
          l.syncStatus !== 'synced' &&
          l.clientRevision > (serverByQuestion.get(l.questionId)?.serverRevision ?? 0)
      ).length;
      const anyPending = localAnswers.filter((l) => l.syncStatus !== 'synced').length;
      if (anyPending > 0) setPendingSync(anyPending);
      else if (unsynced > 0) setPendingSync(unsynced);

      if (localAnswers.length > 0) {
        const latestSaved = localAnswers
          .map((l) => l.savedAt)
          .sort()
          .pop();
        if (latestSaved) setLastSavedAt(new Date(latestSaved));
      }

      setLoading(false);
      sessionOpenedRef.current = true;
    }

    load();
  }, [attemptId, assessmentId, userLoading]);

  // Flush anything queued while the tab was closed as soon as the session is
  // open and we are online (session proof is required by the save endpoint).
  useEffect(() => {
    if (!sessionReady || !attempt || !isOnline) return;
    const t = setTimeout(() => {
      void (async () => {
        const pending = await getPendingOperations(attempt.id).catch(() => []);
        if (pending.length > 0) setPendingSync(pending.length);
        if (pending.length > 0) void flushPendingOperations();
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [sessionReady, attempt, isOnline, flushPendingOperations]);

  // Autosave + pending retry cadence.
  useEffect(() => {
    if (!attempt || loading) return;

    autoSaveTimerRef.current = setInterval(saveAnswers, AUTO_SAVE_INTERVAL);
    retryTimerRef.current = setInterval(() => {
      if (
        isOnlineRef.current &&
        pendingSyncRef.current > 0 &&
        !syncingRef.current &&
        !isSubmittingRef.current
      ) {
        void flushPendingOperations();
      }
    }, PENDING_RETRY_INTERVAL);

    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    };
  }, [attempt, loading, saveAnswers, flushPendingOperations]);

  const debouncedSave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(saveAnswers, DEBOUNCE_DELAY);
  }, [saveAnswers]);

  const updateAnswer = useCallback(
    (
      questionId: string,
      update: Partial<Pick<AnswerState, 'selectedChoiceId' | 'textAnswer'>>
    ) => {
      setAnswers((prev) => {
        const next = new Map(prev);
        const existing = next.get(questionId);
        if (existing) {
          next.set(questionId, { ...existing, ...update });
        }
        return next;
      });
      debouncedSave();
    },
    [debouncedSave]
  );

  const toggleFlag = useCallback((questionId: string) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) {
        next.delete(questionId);
      } else {
        next.add(questionId);
      }
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Security listeners + fullscreen gate
  // -------------------------------------------------------------------------
  const securityListeners = useSecurityListeners({
    enabled: sessionReady,
    policy,
    report: reportEvent,
    onFullscreenRequiredExit: () => setShowFullscreenWarning(true),
  });
  const { isFullscreen } = securityListeners;
  const showFullscreenGate =
    sessionReady && policy.requireFullscreen && !isFullscreen;

  const requestFullscreen = useCallback(() => {
    const el = document.documentElement;
    const request = el.requestFullscreen?.bind(el);
    if (request) {
      request().catch(() => {
        // Browser refused (no user gesture / unsupported) — gate stays visible.
      });
    }
  }, []);

  // Question change is an important state-change heartbeat.
  useEffect(() => {
    if (sessionReady && attempt && !loading) void sendHeartbeat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, sessionReady]);

  // -------------------------------------------------------------------------
  // Submission
  // -------------------------------------------------------------------------
  const handleSubmit = useCallback(
    async () => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setSubmitting(true);

      reportEvent('submission_started');

      // Durably persist everything first, then attempt a final flush.
      if (!isSubmittingRef.current) return;
      setSaving(true);
      try {
        for (const [questionId, state] of answersRef.current.entries()) {
          await saveAnswerLocally(
            attemptRef.current?.id ?? attemptId,
            questionId,
            state.selectedChoiceId,
            state.textAnswer
          );
        }
      } catch {
        // ignore — queue still holds the last known state
      } finally {
        setSaving(false);
      }

      const pending = await getPendingOperations(attemptId).catch(() => []);
      if (pending.length > 0 && isOnlineRef.current) {
        await flushPendingOperations();
      }
      const stillPending = await getPendingOperations(attemptId).catch(() => []);

      const result = await submitExam(
        attemptId,
        stillPending.map((r) => ({
          operationId: r.operationId,
          questionId: r.questionId,
          selectedChoiceId: r.selectedChoiceId,
          textAnswer: r.textAnswer,
          clientRevision: r.clientRevision,
        }))
      );

      if (!result.success) {
        setError(result.error ?? 'Submission failed');
        setSubmitting(false);
        isSubmittingRef.current = false;
        return;
      }

      // Clean up only after the server acknowledged the submission — local
      // data is never wiped when the server rejected the request.
      await clearLocalAnswers(attemptId);
      await forgetSession();

      if ((result.pendingSkipped ?? 0) > 0) {
        setDeadlineSkipNotice(result.pendingSkipped ?? 0);
        setSubmitting(false);
        return;
      }

      router.push(
        `/student/assessments/${assessmentId}/exam/${attemptId}/results`
      );
    },
    [attemptId, assessmentId, router, flushPendingOperations, reportEvent, forgetSession]
  );

  const handleTimeUp = useCallback(() => {
    void handleSubmit();
  }, [handleSubmit]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
      if (retryTimerRef.current) clearInterval(retryTimerRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------
  const answeredCount = questions.filter((q) => {
    const a = answers.get(q.id);
    return !!(a?.selectedChoiceId || a?.textAnswer?.trim());
  }).length;

  const syncBadge: SyncBadge | null = (() => {
    if (saving) return { kind: 'saving', label: 'Saving' };
    if (!isOnline)
      return { kind: 'offline', label: 'Offline — Saved on this Device', pending: pendingSync };
    if (syncError) return { kind: 'error', label: 'Sync Error' };
    if (syncing) return { kind: 'syncing', label: 'Syncing' };
    if (pendingSync > 0) return { kind: 'pending', label: 'Sync Pending', pending: pendingSync };
    if (lastSyncedAt)
      return { kind: 'synced', label: 'Synced', at: lastSyncedAt.toLocaleTimeString() };
    if (lastSavedAt)
      return { kind: 'local', label: 'Saved Locally', at: lastSavedAt.toLocaleTimeString() };
    return null;
  })();

  if (loading || userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" />
          <p className="text-sm text-muted">Loading exam...</p>
        </div>
      </div>
    );
  }

  if (error || attemptClosedMessage || sessionError) {
    const message = attemptClosedMessage ?? sessionError ?? error;
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-2">
            {attemptClosedMessage || sessionError ? 'Session ended' : 'Error'}
          </p>
          <p className="text-sm text-muted mb-4">{message}</p>
          <Button
            variant="secondary"
            onClick={() =>
              router.push(attemptClosedMessage || sessionError ? `/student/assessments/${assessmentId}` : '/')
            }
          >
            {attemptClosedMessage || sessionError ? 'Back to Assessment' : 'Go Back'}
          </Button>
        </div>
      </div>
    );
  }

  if (!attempt || !manifest || questions.length === 0) return null;

  // Manifest order is the strict document order (shuffled only when the
  // deployment requests it). Number items 1..n continuously; a type change
  // marks the start of a section for the navigator/header.
  const displayById = new Map<
    string,
    { displayNumber: number; isFirstInGroup: boolean; groupLabel: string }
  >();
  questions.forEach((q, index) => {
    const prev = index > 0 ? questions[index - 1] : null;
    displayById.set(q.id, {
      displayNumber: index + 1,
      isFirstInGroup: !prev || prev.question_type !== q.question_type,
      groupLabel: QUESTION_TYPE_LABELS[q.question_type] ?? q.question_type,
    });
  });

  const currentQuestion = questions[currentIndex];
  const currentMeta = displayById.get(currentQuestion.id);
  const currentAnswer = answers.get(currentQuestion.id);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < questions.length - 1;

  // Group items by question type (MCQ / ID / TF) for the section navigator.
  const navigatorSections: {
    label: string;
    items: { q: (typeof questions)[number]; index: number }[];
  }[] = [];
  questions.forEach((q, index) => {
    const shortLabel = QUESTION_TYPE_SHORT_LABELS[q.question_type] ?? q.question_type;
    const sectionLabel = `${shortLabel} Section`;
    const last = navigatorSections[navigatorSections.length - 1];
    if (last && last.label === sectionLabel) {
      last.items.push({ q, index });
    } else {
      navigatorSections.push({ label: sectionLabel, items: [{ q, index }] });
    }
  });

  const remainingQuestions = questions.length - answeredCount;

  return (
    <ExamShell
      backHref={`/student/assessments/${assessmentId}`}
      backLabel="Back to Assessment"
    >
      <div className="flex flex-col h-screen">
        {/* Minimal exam header bar */}
        <header className="flex items-center justify-between h-12 px-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0">
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-sm font-medium text-[var(--color-foreground)]">
              {questions.length} questions &middot; {answeredCount} answered
            </div>
          </div>

          <div className="flex items-center gap-3">
            {syncBadge?.kind === 'offline' && (
              <span
                className="text-xs text-warning font-medium flex items-center gap-1"
                role="status"
                aria-live="polite"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.242 2.829a5 5 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
                </svg>
                Offline — Saved on this Device ({syncBadge.pending})
              </span>
            )}
            {syncBadge?.kind === 'error' && (
              <button
                type="button"
                onClick={() => void flushPendingOperations()}
                className="text-xs text-danger font-medium flex items-center gap-1 hover:underline"
              >
                Sync Error — tap to retry
              </button>
            )}
            {syncBadge?.kind === 'syncing' && (
              <span className="text-xs text-warning flex items-center gap-1" role="status">
                <Spinner size="sm" /> Syncing
              </span>
            )}
            {syncBadge?.kind === 'pending' && (
              <span className="text-xs text-warning flex items-center gap-1" role="status">
                <Spinner size="sm" /> Sync Pending ({syncBadge.pending})
              </span>
            )}
            {syncBadge?.kind === 'saving' && (
              <span className="text-xs text-muted flex items-center gap-1" role="status">
                <Spinner size="sm" /> Saving
              </span>
            )}
            {syncBadge?.kind === 'synced' && (
              <span className="text-xs text-success" role="status">
                Synced {syncBadge.at}
              </span>
            )}
            {syncBadge?.kind === 'local' && (
              <span className="text-xs text-success" role="status">
                Saved Locally {syncBadge.at}
              </span>
            )}
            <ExamTimer
              expiresAt={attemptExpiresAt ?? attempt.expires_at}
              clockOffsetMs={serverNowOffset}
              onTimeUp={handleTimeUp}
            />
          </div>
        </header>

        {sessionTransferred && (
          <div className="px-4 py-2 text-xs bg-[var(--color-info-light)] border-b border-[var(--color-border)] text-[var(--color-foreground)]" role="status">
            Your examination session was recovered on this device. The event has been recorded.
          </div>
        )}

        {/* Exam content */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 pb-28 md:pb-8">
            <div className="max-w-4xl mx-auto py-6">
              {/* Section-grouped answer status: green answered / red unanswered */}
              <div className="mb-6 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="flex flex-col gap-5">
                  {navigatorSections.map((section) => (
                    <div key={section.label} className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                          {section.label}
                        </span>
                        <div className="flex-1 h-px bg-[var(--color-border)]" aria-hidden="true" />
                      </div>
                      <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-10 gap-2">
                        {section.items.map(({ q, index }) => {
                          const a = answers.get(q.id);
                          const isAnswered = !!(a?.selectedChoiceId || a?.textAnswer?.trim());
                          const isCurrent = index === currentIndex;
                          const status = isAnswered ? 'Answered' : 'Unanswered';
                          const displayNumber =
                            displayById.get(q.id)?.displayNumber ?? index + 1;

                          return (
                            <button
                              key={q.id}
                              type="button"
                              onClick={() => setCurrentIndex(index)}
                              aria-label={`Question ${displayNumber}, ${status}${isCurrent ? ', current' : ''}`}
                              className={`relative h-10 w-full rounded-lg border text-sm font-medium tabular-nums transition-all ${
                                isAnswered
                                  ? 'border-[var(--color-success)]/40 bg-[var(--color-success-light)] text-[var(--color-success-dark)] hover:opacity-90'
                                  : 'border-[var(--color-danger)]/40 bg-[var(--color-danger-light)] text-[var(--color-danger-dark)] hover:opacity-90'
                              } ${
                                isCurrent
                                  ? 'bg-[var(--color-primary)]! text-white! border-[var(--color-primary)]! ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-surface)]'
                                  : ''
                              }`}
                            >
                              {displayNumber}
                              {flagged.has(q.id) && !isCurrent && (
                                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-warning)] border-2 border-[var(--color-surface)]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--color-muted)]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-[var(--color-success)]" aria-hidden="true" />
                    Answered ({answeredCount})
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-[var(--color-danger)]" aria-hidden="true" />
                    Unanswered ({remainingQuestions})
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-[var(--color-warning)]" aria-hidden="true" />
                    Flagged ({flagged.size})
                  </span>
                </div>
              </div>

              <div className="flex flex-col md:flex-row md:items-start gap-4">
                <div className="md:w-28 shrink-0 md:pt-24 order-2 md:order-1">
                  <Button
                    variant="secondary"
                    className="w-full md:w-auto"
                    disabled={!canGoPrev}
                    onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                  >
                    Previous
                  </Button>
                </div>

                <div className="flex-1 min-w-0 order-1 md:order-2">
                  <div className="max-w-2xl mx-auto">
                    <ExamQuestion
                      question={currentQuestion}
                      position={currentMeta?.displayNumber ?? currentIndex + 1}
                      sectionLabel={currentMeta?.isFirstInGroup ? currentMeta.groupLabel : undefined}
                      selectedChoiceId={currentAnswer?.selectedChoiceId ?? null}
                      textAnswer={currentAnswer?.textAnswer ?? ''}
                      flagged={flagged.has(currentQuestion.id)}
                      onChoiceSelect={(choiceId) =>
                        updateAnswer(currentQuestion.id, { selectedChoiceId: choiceId })
                      }
                      onTextChange={(text) =>
                        updateAnswer(currentQuestion.id, { textAnswer: text })
                      }
                      onFlagToggle={() => toggleFlag(currentQuestion.id)}
                    />
                  </div>
                </div>

                <div className="md:w-28 shrink-0 md:pt-24 order-3 flex md:justify-end">
                  <Button
                    variant="secondary"
                    className="w-full md:w-auto"
                    disabled={!canGoNext}
                    onClick={() =>
                      setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile submit button */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-surface border-t border-border px-4 py-3">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => setShowSubmitDialog(true)}
          >
            Submit Exam
          </Button>
        </div>

        {/* Desktop submit button */}
        <div className="hidden md:flex fixed bottom-6 right-6 z-30">
          <Button
            variant="primary"
            size="lg"
            onClick={() => setShowSubmitDialog(true)}
          >
            Submit Exam
          </Button>
        </div>

        {/* Submit confirmation dialog */}
        <Modal
          open={showSubmitDialog}
          onClose={() => setShowSubmitDialog(false)}
          title="Submit Exam?"
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => setShowSubmitDialog(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleSubmit()}
                loading={submitting}
              >
                Submit
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">
              Are you sure you want to submit your exam? This action cannot be
              undone.
            </p>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-muted">
                Answered: {answeredCount}/{questions.length}
              </span>
              <span className="text-muted">
                Flagged: {flagged.size}
              </span>
            </div>
            {!isOnline && (
              <p className="text-sm text-warning font-medium">
                You are offline. Your answers are saved on this device and will
                be synchronized when connectivity returns.
              </p>
            )}
            {pendingSync > 0 && isOnline && (
              <p className="text-sm text-warning font-medium">
                {pendingSync} answer{pendingSync !== 1 ? 's are' : ' is'} still
                synchronizing — submission will send them first.
              </p>
            )}
            {remainingQuestions > 0 && (
              <p className="text-sm text-warning font-medium">
                You have {remainingQuestions} unanswered question
                {remainingQuestions !== 1 ? 's' : ''}.
              </p>
            )}
          </div>
        </Modal>

        {/* Deadline passed with pending answers that could not be synchronized */}
        <Modal
          open={deadlineSkipNotice !== null}
          onClose={() => router.push(`/student/assessments/${assessmentId}/exam/${attemptId}/results`)}
          title="Exam submitted"
          actions={
            <Button
              variant="primary"
              onClick={() =>
                router.push(`/student/assessments/${assessmentId}/exam/${attemptId}/results`)
              }
            >
              Continue to Results
            </Button>
          }
        >
          <p className="text-sm text-foreground">
            Your exam was submitted. {deadlineSkipNotice} answer
            {deadlineSkipNotice !== 1 ? 's were' : ' was'} queued on this device
            after the deadline and could not be synchronized. The situation was
            recorded for your instructor.
          </p>
        </Modal>

        {/* Full-screen requirement gate */}
        <Modal
          open={showFullscreenGate}
          onClose={() => {}}
          title="Full-screen mode required"
          actions={
            <Button variant="primary" onClick={requestFullscreen}>
              Enter Full-screen
            </Button>
          }
        >
          <p className="text-sm text-foreground">
            Full-screen mode is required for this assessment. Your session is
            active and the timer is running.
          </p>
        </Modal>

        {/* Full-screen exit warning (recorded; return required by policy) */}
        <Modal
          open={showFullscreenWarning}
          onClose={() => setShowFullscreenWarning(false)}
          title="Full-screen mode required"
          actions={
            <Button
              variant="primary"
              onClick={() => {
                setShowFullscreenWarning(false);
                requestFullscreen();
              }}
            >
              Return to Examination
            </Button>
          }
        >
          <p className="text-sm text-foreground">
            Full-screen mode is required for this assessment. This session event
            has been recorded.
          </p>
        </Modal>

        {/* Identity reverification gate (faculty-requested or recovery policy) */}
        <Modal
          open={requiresReverification}
          onClose={() => {}}
          title="Identity reverification required"
          actions={
            <Button
              variant="primary"
              loading={reverificationBusy}
              onClick={async () => {
                setReverificationBusy(true);
                setReverificationError(null);
                const result = await verifyIdentity(reverificationPassword);
                setReverificationBusy(false);
                if (result.ok) {
                  setReverificationPassword('');
                } else {
                  setReverificationError(result.error ?? 'Verification failed');
                }
              }}
            >
              Verify identity
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            <p className="text-sm text-foreground">
              Re-enter your account password to continue your examination.
            </p>
            <Input
              type="password"
              autoComplete="current-password"
              value={reverificationPassword}
              onChange={(e) => setReverificationPassword(e.target.value)}
              placeholder="Account password"
              aria-label="Account password"
            />
            {reverificationError && (
              <p className="text-sm text-danger" role="alert">
                {reverificationError}
              </p>
            )}
          </div>
        </Modal>
      </div>
    </ExamShell>
  );
}
