'use client';

import type { JSX } from 'react';
import { X } from '@phosphor-icons/react';

interface QuestionState {
  questionId: string;
  position: number;
  answered: boolean;
  flagged: boolean;
  /** Type-group short label (MCQ/ID/TF) shown in grouped mode. */
  typeLabel?: string;
  /** True when this is the first question of its type group. */
  isFirstInGroup?: boolean;
}

interface NavigatorContentProps {
  questions: QuestionState[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

interface ExamNavigatorProps extends NavigatorContentProps {
  /** Mobile bottom-sheet visibility (desktop renders the content inline). */
  isOpen: boolean;
  onClose: () => void;
}

interface Section {
  label: string;
  items: { q: QuestionState; index: number }[];
}

function buildSections(questions: QuestionState[]): Section[] {
  const sections: Section[] = [];
  let prevTypeLabel: string | undefined;
  for (let index = 0; index < questions.length; index++) {
    const q = questions[index];
    const startsGroup =
      q.isFirstInGroup || q.typeLabel !== prevTypeLabel || sections.length === 0;
    if (startsGroup) {
      const label = q.typeLabel ? `${q.typeLabel} Section` : 'Section';
      sections.push({ label, items: [{ q, index }] });
    } else {
      sections[sections.length - 1].items.push({ q, index });
    }
    prevTypeLabel = q.typeLabel;
  }
  return sections;
}

/**
 * Question grid grouped by type section. Tile states are deliberately calm:
 * green = answered, neutral = not yet answered, amber dot = flagged,
 * primary = current. (Unanswered used to render as an alarming red fill.)
 */
export function ExamNavigatorContent({
  questions,
  currentIndex,
  onSelect,
}: NavigatorContentProps): JSX.Element {
  const answeredCount = questions.filter((q) => q.answered).length;
  const flaggedCount = questions.filter((q) => q.flagged).length;
  const sections = buildSections(questions);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-[var(--color-foreground)]">
          {answeredCount}/{questions.length} answered
        </span>
        <span className="text-[var(--color-muted)]">{flaggedCount} flagged</span>
      </div>

      <div className="flex flex-col gap-4">
        {sections.map((section) => (
          <div key={section.label} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
                {section.label}
              </span>
              <div className="flex-1 h-px bg-[var(--color-border)]" aria-hidden="true" />
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {section.items.map(({ q, index }) => {
                const isCurrent = index === currentIndex;
                const stateClasses = isCurrent
                  ? 'bg-[var(--color-primary)] text-white border-[var(--color-primary)] ring-2 ring-[var(--color-primary)] ring-offset-2 ring-offset-[var(--color-surface)]'
                  : q.answered
                    ? 'bg-[var(--color-success-light)] text-[var(--color-success-dark)] border-[var(--color-success)]/30'
                    : 'bg-[var(--color-surface)] text-[var(--color-muted)] border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]';

                return (
                  <button
                    key={q.questionId}
                    type="button"
                    onClick={() => onSelect(index)}
                    className={`relative h-10 w-full rounded-[var(--radius-md)] border text-sm font-medium tabular-nums transition-colors ${stateClasses}`}
                    aria-label={`Question ${q.position}${q.answered ? ', answered' : ', not answered'}${q.flagged ? ', flagged' : ''}${isCurrent ? ', current' : ''}`}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    {q.position}
                    {q.flagged && !isCurrent && (
                      <span
                        className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-[var(--color-warning)] border-2 border-[var(--color-surface)]"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--color-muted)]">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-[var(--color-success)]" aria-hidden="true" />
          Answered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-[var(--color-border-strong)] bg-[var(--color-surface)]" aria-hidden="true" />
          Not answered
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-[var(--color-warning)]" aria-hidden="true" />
          Flagged
        </span>
      </div>
    </div>
  );
}

/**
 * Mobile bottom sheet version of the navigator (desktop uses
 * `ExamNavigatorContent` in a collapsible side rail).
 */
export default function ExamNavigator({
  questions,
  currentIndex,
  onSelect,
  isOpen,
  onClose,
}: ExamNavigatorProps): JSX.Element | null {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Question navigator">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute bottom-0 left-0 right-0 max-h-[70vh] overflow-y-auto rounded-t-[var(--radius-lg)] border-t border-[var(--color-border)] bg-[var(--color-surface)] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
            Question navigator
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigator"
            className="rounded-[var(--radius-md)] p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            <X className="h-5 w-5" weight="regular" />
          </button>
        </div>
        <ExamNavigatorContent
          questions={questions}
          currentIndex={currentIndex}
          onSelect={(index) => {
            onSelect(index);
            onClose();
          }}
        />
      </div>
    </div>
  );
}
