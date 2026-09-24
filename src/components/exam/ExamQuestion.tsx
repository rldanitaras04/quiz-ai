'use client';

import type { JSX } from 'react';
import type { QuestionWithChoices } from '@/lib/types';

interface ExamQuestionProps {
  question: QuestionWithChoices;
  position: number;
  /** Type-group label shown when this is the first item of a type section. */
  sectionLabel?: string;
  selectedChoiceId: string | null;
  textAnswer: string;
  flagged: boolean;
  onChoiceSelect: (choiceId: string) => void;
  onTextChange: (text: string) => void;
  onFlagToggle: () => void;
}

export default function ExamQuestion({
  question,
  position,
  sectionLabel,
  selectedChoiceId,
  textAnswer,
  flagged,
  onChoiceSelect,
  onTextChange,
  onFlagToggle,
}: ExamQuestionProps): JSX.Element {
  const isChoiceBased =
    question.question_type === 'multiple_choice' || question.question_type === 'true_false';

  return (
    <div className="flex flex-col gap-6">
      {sectionLabel && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            {sectionLabel}
          </span>
          <div className="flex-1 h-px bg-border" aria-hidden="true" />
        </div>
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium text-muted">
              Question {position}
            </span>
            <span className="text-xs text-muted-light">
              {question.points} {question.points === 1 ? 'point' : 'points'}
            </span>
          </div>
          <p className="text-foreground whitespace-pre-wrap">{question.question_text}</p>
          {(question as any).image_url && (
            <div className="mt-3">
              <img
                src={(question as any).image_url as string}
                alt="Question illustration"
                className="max-h-80 w-auto mx-auto rounded border border-[var(--color-border)] object-contain bg-white"
                loading="lazy"
              />
            </div>
          )}
        </div>

        <button
          onClick={onFlagToggle}
          className={`flex-shrink-0 p-2 rounded-lg transition-colors ${
            flagged
              ? 'text-warning bg-warning-light'
              : 'text-muted hover:text-foreground hover:bg-surface-hover'
          }`}
          aria-label={flagged ? 'Remove flag' : 'Flag for review'}
          aria-pressed={flagged}
        >
          <svg className="h-5 w-5" fill={flagged ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
          </svg>
        </button>
      </div>

      {isChoiceBased && (
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Select your answer</legend>
          {question.question_choices.map((choice) => (
            <label
              key={choice.id}
              className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                selectedChoiceId === choice.id
                  ? 'border-primary bg-primary-light/10 ring-1 ring-primary'
                  : 'border-border hover:bg-surface-hover hover:border-border-strong'
              }`}
            >
              <input
                type="radio"
                name={`question-${question.id}`}
                value={choice.id}
                checked={selectedChoiceId === choice.id}
                onChange={() => onChoiceSelect(choice.id)}
                className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
              />
              <span className="flex-1 text-sm text-foreground">
                <span className="font-medium text-muted mr-2">{choice.choice_key}.</span>
                {choice.choice_text}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {question.question_type === 'identification' && (
        <div>
          <label htmlFor={`answer-${question.id}`} className="sr-only">
            Type your answer
          </label>
          <input
            id={`answer-${question.id}`}
            type="text"
            value={textAnswer}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder="Type your answer here..."
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-foreground placeholder:text-muted-light focus:border-primary focus:ring-2 focus:ring-focus-ring focus:outline-none transition-colors"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      )}
    </div>
  );
}
