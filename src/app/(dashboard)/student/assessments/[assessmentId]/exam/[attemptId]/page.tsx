'use client';

import { use, useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/lib/hooks';
import ExamTimer from '@/components/exam/ExamTimer';
import ExamQuestion from '@/components/exam/ExamQuestion';
import ExamNavigator from '@/components/exam/ExamNavigator';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { getAttemptDetails, submitExam } from '../actions';
import { saveAnswerLocally, syncAnswersToServer, getLocalAnswers, clearLocalAnswers } from '@/lib/sync';
import ExamShell from '@/components/layout/ExamShell';
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
  const [navigatorOpen, setNavigatorOpen] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);

  const answersRef = useRef(answers);
  const flaggedRef = useRef(flagged);
  const attemptRef = useRef(attempt);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSubmittingRef = useRef(false);
  const isOnlineRef = useRef(true);

  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { flaggedRef.current = flagged; }, [flagged]);
  useEffect(() => { attemptRef.current = attempt; }, [attempt]);

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

    setIsOnline(navigator.onLine);
    isOnlineRef.current = navigator.onLine;

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    async function load() {
      if (userLoading) return;

      const result = await getAttemptDetails(attemptId);
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

      const { attempt: a, manifest: m, questions: q } = result.data;

      if (a.status !== 'in_progress') {
        setError('This exam is no longer in progress.');
        setLoading(false);
        return;
      }

      setAttempt(a);
      setManifest(m);
      setQuestions(q);

      const initialAnswers = new Map<string, AnswerState>();
      q.forEach((question) => {
        initialAnswers.set(question.id, {
          selectedChoiceId: null,
          textAnswer: '',
          clientRevision: 0,
        });
      });
      setAnswers(initialAnswers);

      setLoading(false);
    }

    load();
  }, [attemptId, userLoading]);

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
      } else {
        setPendingSync(payload.length);
      }

      setLastSavedAt(new Date());
    } catch {
      // Silently fail — will retry on next interval
    } finally {
      setSaving(false);
    }
  }, []);

  const syncPendingAnswers = useCallback(async (attemptId: string) => {
    try {
      const localAnswers = await getLocalAnswers(attemptId);
      if (localAnswers.length === 0) return;

      const payload = localAnswers.map(a => ({
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
      setLastSavedAt(new Date());
    } catch {
      // Will retry on next online event
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

  const currentQuestion = questions[currentIndex];
  const currentAnswer = answers.get(currentQuestion.id);

  const navigatorQuestions = questions.map((q, i) => ({
    questionId: q.id,
    position: i + 1,
    answered: (() => {
      const a = answers.get(q.id);
      return !!(a?.selectedChoiceId || a?.textAnswer?.trim());
    })(),
    flagged: flagged.has(q.id),
  }));

  const answeredCount = navigatorQuestions.filter((q) => q.answered).length;

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
                Offline
              </span>
            )}
            {pendingSync > 0 && isOnline && (
              <span className="text-xs text-warning flex items-center gap-1">
                <Spinner size="sm" /> Syncing...
              </span>
            )}
            {saving && (
              <span className="text-xs text-muted flex items-center gap-1">
                <Spinner size="sm" /> Saving...
              </span>
            )}
            {lastSavedAt && !saving && (
              <span className="text-xs text-muted">
                Saved {lastSavedAt.toLocaleTimeString()}
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
          {/* Desktop navigator sidebar */}
          <div className="hidden md:block w-64 flex-shrink-0 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-surface)]">
            <div className="sticky top-4 p-4">
              <ExamNavigator
                questions={navigatorQuestions}
                currentIndex={currentIndex}
                onSelect={setCurrentIndex}
                isOpen={false}
                onClose={() => {}}
              />
            </div>
          </div>

          {/* Question area */}
          <div className="flex-1 overflow-y-auto px-4 pb-24 md:pb-4">
            <div className="max-w-2xl mx-auto py-6">
              <ExamQuestion
                question={currentQuestion}
                position={currentIndex + 1}
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
        </div>

        {/* Mobile bottom bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border px-4 py-3 md:hidden z-40">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setNavigatorOpen(true)}
          >
            Questions ({answeredCount}/{questions.length})
          </Button>
        </div>

        {/* Mobile navigator overlay */}
        <ExamNavigator
          questions={navigatorQuestions}
          currentIndex={currentIndex}
          onSelect={setCurrentIndex}
          isOpen={navigatorOpen}
          onClose={() => setNavigatorOpen(false)}
        />

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

        {/* Mobile submit button */}
        <div className="md:hidden fixed bottom-16 left-4 right-4 z-30">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
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