'use client';

import { type JSX } from 'react';

const SUGGESTIONS = [
  'Focus on key concepts from the selected materials',
  'Use real-world scenarios and practical applications',
  'Include questions that test higher-order thinking',
  'Avoid ambiguous or trick questions',
  'Use clear and concise language',
  'Test understanding, not just memorization',
  'Include questions across all difficulty levels',
  'Reference specific examples from the source materials',
];

interface StepCustomInstructionsProps {
  state: {
    customInstructions: string;
  };
  onUpdate: (updates: { customInstructions?: string }) => void;
  errors: Record<string, string>;
}

export default function StepCustomInstructions({
  state,
  onUpdate,
}: StepCustomInstructionsProps): JSX.Element {
  const addSuggestion = (suggestion: string) => {
    const current = state.customInstructions.trim();
    const next = current ? `${current}\n${suggestion}` : suggestion;
    onUpdate({ customInstructions: next });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Custom Instructions
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Optionally provide additional instructions for the AI to follow when generating questions.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="custom-instructions"
          className="text-sm font-medium text-[var(--color-foreground)]"
        >
          Additional Instructions
        </label>
        <textarea
          id="custom-instructions"
          rows={6}
          placeholder="e.g., Focus on application-level questions. Use case studies from the material. Avoid questions that require outside knowledge..."
          value={state.customInstructions}
          onChange={(e) => onUpdate({ customInstructions: e.target.value })}
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none resize-none"
        />
        <p className="text-xs text-[var(--color-muted)]">
          This step is optional. You can skip it and proceed to generation.
        </p>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-medium text-[var(--color-foreground)]">
          Suggestions
        </h3>
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => addSuggestion(suggestion)}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] hover:bg-[var(--color-primary)]/5 transition-colors cursor-pointer"
            >
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              {suggestion}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-info-light)] border border-[var(--color-info)]/20">
        <div className="flex gap-2">
          <svg className="w-5 h-5 text-[var(--color-info)] shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
          </svg>
          <div className="text-sm text-[var(--color-info)]">
            <p className="font-medium">Tip</p>
            <p className="mt-1">
              The more specific your instructions, the better the AI can tailor questions to your needs.
              You can combine multiple suggestions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
