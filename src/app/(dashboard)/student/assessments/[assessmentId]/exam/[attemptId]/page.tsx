'use client';

import { use, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/hooks';
import ExamTimer from '@/components/exam/ExamTimer';
import ExamQuestion from '@/components/exam/ExamQuestion';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { getAttemptDetails, submitExam } from '../actions';
import { saveAnswerLocally, syncAnswersToServer, getLocalAnswers, clearLocalAnswers } from '@/lib/sync';
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
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [pendingSync, setPendingSync] = useState(0);
  const [syncError, setSyncError] = useState(false);

  const answersRef = useRef(answers);
  const flaggedRef = useRef(flagged);
  const attemptRef = useRef(attempt);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSubmittingRef = useRef(false);
  const isOnlineRef = useRef(isOnline);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { flaggedRef.current = flagged; }, [flagged]);
  useEffect(() => { attemptRef.current = attempt; }, [attempt]);

  // Flush answers that were queued while offline. Kept above the effects that
  // depend on it so first paint already knows how to recover.
  const syncPendingAnswers = useCallback(async (attemptId: string) => {
    try {
      const localAnswers = await getLocalAnswers(attemptId);
      if (localAnswers.length === 0) {
        setPendingSync(0);
        setSyncError(false);
        return;
      }

      const payload = localAnswers.map((a) => ({
        questionId: a.questionId,
        selectedChoiceId: a.selectedChoiceId,
        textAnswer: a.textAnswer,
        clientRevision: a.clientRevision,
      }));

      const res = await syncAnswersToServer(attemptId, payload);
      if (res.serverRevisions) {
        setAnswers((prev) => {
          const next = new Map(prev);
          for (const [qId, serverRev] of Object.entries(res.serverRevisions)) {
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
      }
      setPendingSync(0);
      setSyncError(false);
      setLastSavedAt(new Date());
    } catch {
      setSyncError(true);
      // Will retry on the next interval or online event.
    }
  }, []);

  // Online/offline detection
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      isOnlineRef.current = true;
      if (attemptRef.current) {
        syncPendingAnswers(attemptRef.current.id);
      }
    };
    const handleOffline = () => {
      setIsOnline(false);
      isOnlineRef.current = false;
    };

    isOnlineRef.current = navigator.onLine;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [syncPendingAnswers]);

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

      // Rebuild the answer map from the server copy plus anything still queued
      // in IndexedDB. The local copy only wins when it holds a revision the
      // server has not acknowledged — so a reload restores the paper instead of
      // showing every question blank, while never resurrecting stale data.
      const serverByQuestion = new Map(responses.map((r) => [r.questionId, r]));
      const localAnswers = await getLocalAnswers(a.id).catch(() => []);
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
        (l) => l.clientRevision > (serverByQuestion.get(l.questionId)?.serverRevision ?? 0)
      ).length;
      if (unsynced > 0) setPendingSync(unsynced);

      setLoading(false);

      // Flush anything that was queued while offline as soon as we are back.
      if (navigator.onLine && unsynced > 0) void syncPendingAnswers(a.id);
    }

    load();
  }, [attemptId, assessmentId, userLoading, syncPendingAnswers]);

  const saveAnswers = useCallback(async () => {
    if (!attemptRef.current || isSubmittingRef.current) return;

    const currentAnswers = answersRef.current;
    const payload = Array.from(currentAnswers.entries()).map(
      ([questionId, state]) => ({
        questionId,
        selectedChoiceId: state.selectedChoiceId,
        textAnswer: state.textAnswer,
        clientRevision: state.clientRevision,
      })
    );

    if (payload.length === 0) return;

    setSaving(true);
    try {
      for (const answer of payload) {
        await saveAnswerLocally(
          attemptRef.current!.id,
          answer.questionId,
          answer.selectedChoiceId,
          answer.textAnswer
        );
      }

      if (isOnlineRef.current) {
        const res = await syncAnswersToServer(attemptRef.current!.id, payload);
        if (res.serverRevisions) {
          setAnswers((prev) => {
            const next = new Map(prev);
            for (const [qId, serverRev] of Object.entries(res.serverRevisions)) {
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
        }
        setPendingSync(0);
        setSyncError(false);
      } else {
        setPendingSync(payload.length);
        setSyncError(false);
      }

      setLastSavedAt(new Date());
    } catch {
      // Stay queued — retried on the next interval or online event.
      setSyncError(true);
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!attempt || loading) return;

    autoSaveTimerRef.current = setInterval(saveAnswers, AUTO_SAVE_INTERVAL);
    return () => {
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, [attempt, loading, saveAnswers]);

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

  const handleSubmit = useCallback(
    async (autoSubmit = false) => {
      if (isSubmittingRef.current) return;
      isSubmittingRef.current = true;
      setSubmitting(true);

      await saveAnswers();

      const result = await submitExam(attemptId);
      if (result.error && !autoSubmit) {
        setError(result.error);
        setSubmitting(false);
        isSubmittingRef.current = false;
        return;
      }

      await clearLocalAnswers(attemptId);

      router.push(
        `/student/assessments/${assessmentId}/exam/${attemptId}/results`
      );
    },
    [attemptId, assessmentId, router, saveAnswers]
  );

  const handleTimeUp = useCallback(() => {
    handleSubmit(true);
  }, [handleSubmit]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (autoSaveTimerRef.current) clearInterval(autoSaveTimerRef.current);
    };
  }, []);

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

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-lg font-medium text-foreground mb-2">Error</p>
          <p className="text-sm text-muted mb-4">{error}</p>
          <Button variant="secondary" onClick={() => router.back()}>
            Go Back
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

  const answeredCount = questions.filter((q) => {
    const a = answers.get(q.id);
    return !!(a?.selectedChoiceId || a?.textAnswer?.trim());
  }).length;

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
            {!isOnline && (
              <span className="text-xs text-warning font-medium flex items-center gap-1">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.242 2.829a5 5 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3" />
                </svg>
                Offline — saved on this device
              </span>
            )}
            {isOnline && syncError && (
              <button
                type="button"
                onClick={() => attemptRef.current && syncPendingAnswers(attemptRef.current.id)}
                className="text-xs text-danger font-medium flex items-center gap-1 hover:underline"
              >
                Sync error — tap to retry
              </button>
            )}
            {isOnline && !syncError && pendingSync > 0 && (
              <span className="text-xs text-warning flex items-center gap-1">
                <Spinner size="sm" /> Sync pending
              </span>
            )}
            {saving && (
              <span className="text-xs text-muted flex items-center gap-1">
                <Spinner size="sm" /> Saving...
              </span>
            )}
            {!saving && !syncError && pendingSync === 0 && lastSavedAt && (
              <span className="text-xs text-success">
                Synced {lastSavedAt.toLocaleTimeString()}
              </span>
            )}
            <ExamTimer
              expiresAt={attempt.expires_at}
              onTimeUp={handleTimeUp}
            />
          </div>
        </header>

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
                    Unanswered ({questions.length - answeredCount})
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
                onClick={() => handleSubmit(false)}
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
            {answeredCount < questions.length && (
              <p className="text-sm text-warning font-medium">
                You have {questions.length - answeredCount} unanswered question
                {questions.length - answeredCount !== 1 ? 's' : ''}.
              </p>
            )}
          </div>
        </Modal>
      </div>
    </ExamShell>
  );
}