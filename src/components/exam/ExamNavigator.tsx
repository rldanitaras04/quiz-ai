'use client';

import type { JSX } from 'react';

interface QuestionState {
  questionId: string;
  position: number;
  answered: boolean;
  flagged: boolean;
}

interface ExamNavigatorProps {
  questions: QuestionState[];
  currentIndex: number;
  onSelect: (index: number) => void;
  isOpen: boolean;
  onClose: () => void;
}

export default function ExamNavigator({
  questions,
  currentIndex,
  onSelect,
  isOpen,
  onClose,
}: ExamNavigatorProps): JSX.Element {
  const answeredCount = questions.filter((q) => q.answered).length;
  const flaggedCount = questions.filter((q) => q.flagged).length;

  const content = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">
          {answeredCount}/{questions.length} answered
        </span>
        <span className="text-muted">
          {flaggedCount} flagged
        </span>
      </div>

      <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {questions.map((q, index) => {
          const isCurrent = index === currentIndex;
          const stateClasses = isCurrent
            ? 'bg-primary text-white ring-2 ring-primary ring-offset-2'
            : q.answered
              ? 'bg-success-light text-success border-success/30'
              : q.flagged
                ? 'bg-warning-light text-warning border-warning/30'
                : 'bg-surface text-foreground border-border hover:bg-surface-hover';

          return (
            <button
              key={q.questionId}
              onClick={() => {
                onSelect(index);
                onClose();
              }}
              className={`relative h-10 w-full rounded-lg border text-sm font-medium transition-all ${stateClasses}`}
              aria-label={`Question ${q.position}${q.answered ? ', answered' : ', unanswered'}${q.flagged ? ', flagged' : ''}`}
            >
              {q.position}
              {q.flagged && !isCurrent && (
                <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-warning border-2 border-surface" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <div className="hidden md:block">
        {content}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onClose} />
          <div className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-xl p-4 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Questions</h3>
              <button
                onClick={onClose}
                className="p-1 rounded-lg hover:bg-surface-hover text-muted"
                aria-label="Close navigator"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
