'use client';

import type { JSX } from 'react';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';

const ASSESSMENT_CATEGORIES = [
  { value: 'quiz', label: 'Quiz' },
  { value: 'pre-test', label: 'Pre-Test' },
  { value: 'post-test', label: 'Post-Test' },
  { value: 'midterm', label: 'Midterm' },
  { value: 'final', label: 'Final' },
  { value: 'custom', label: 'Custom' },
];

interface StepBasicInfoProps {
  state: {
    title: string;
    instructions: string;
    assessmentCategory: string;
  };
  onUpdate: (updates: { title?: string; instructions?: string; assessmentCategory?: string }) => void;
  errors: Record<string, string>;
}

export default function StepBasicInfo({
  state,
  onUpdate,
  errors,
}: StepBasicInfoProps): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Basic Information
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Set the title and type for your assessment.
        </p>
      </div>

      <Input
        label="Assessment Title"
        required
        placeholder="e.g., Chapter 5 - Photosynthesis Quiz"
        value={state.title}
        onChange={(e) => onUpdate({ title: e.target.value })}
        error={errors.title}
      />

      <Select
        label="Assessment Type"
        value={state.assessmentCategory}
        onChange={(e) => onUpdate({ assessmentCategory: e.target.value })}
      >
        {ASSESSMENT_CATEGORIES.map((cat) => (
          <option key={cat.value} value={cat.value}>
            {cat.label}
          </option>
        ))}
      </Select>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="instructions"
          className="text-sm font-medium text-[var(--color-foreground)]"
        >
          Instructions
        </label>
        <textarea
          id="instructions"
          rows={4}
          placeholder="Optional instructions for students taking this assessment..."
          value={state.instructions}
          onChange={(e) => onUpdate({ instructions: e.target.value })}
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none resize-none"
        />
      </div>
    </div>
  );
}
