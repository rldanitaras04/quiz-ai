'use client';

import type { JSX } from 'react';
import type { AssessmentCreationMode } from '@/lib/types';

interface Props {
  value: AssessmentCreationMode;
  onChange: (mode: AssessmentCreationMode) => void;
}

const MODES: Array<{ id: AssessmentCreationMode; title: string; description: string; icon: JSX.Element; recommended?: boolean }> = [
  {
    id: 'ai',
    title: 'AI-Assisted Generation',
    description: 'Provide source materials and let AI generate grounded questions with topic, difficulty and Bloom\'s controls.',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M18.25 12.75 17 15l-1.25-2.25a2.5 2.5 0 0 0-1.75-1.75L12 10l2-1.25a2.5 2.5 0 0 0 1.75-1.75L17 5l1.25 2.25a2.5 2.5 0 0 0 1.75 1.75L22 10l-2 1.25a2.5 2.5 0 0 0-1.75 1.5Z" />
      </svg>
    ),
    recommended: true,
  },
  {
    id: 'manual',
    title: 'Manual Encoding',
    description: 'Author every item by hand. Best for precise control, custom stems, and small high-stakes sets.',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487 19.5 7.125 8.25 18.375 4.5 19.5 5.625 15.75 16.862 4.487Z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 5 18 8" />
      </svg>
    ),
  },
  {
    id: 'bank',
    title: 'Question Bank',
    description: 'Reuse vetted items from your subject\'s question bank, filtered and grouped by topic.',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125S3.75 19.903 3.75 17.625V6.375m16.5 0v6.375M3.75 6.375v6.375" />
      </svg>
    ),
  },
  {
    id: 'mixed',
    title: 'Mixed (Manual + Bank)',
    description: 'Combine hand-authored items and bank imports — no source files needed. Ideal for flexible reuse + custom stems.',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
  },
];

export default function StepCreationMode({ value, onChange }: Props): JSX.Element {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">How would you like to create this assessment?</h2>
        <p className="text-sm text-[var(--color-muted)]">Pick a starting point — you can always mix methods later in Review.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {MODES.map((m) => {
          const active = value === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange(m.id)}
              className={`text-left rounded-[var(--radius-lg)] border-2 p-4 transition-all flex flex-col gap-3 ${
                active
                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5 shadow-[var(--shadow-sm)]'
                  : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/40 bg-[var(--color-surface)]'
              }`}
            >
              <div className={`w-10 h-10 rounded-[var(--radius-md)] flex items-center justify-center ${active ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface-hover)] text-[var(--color-muted)]'}`}>
                {m.icon}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className={`text-sm font-semibold ${active ? 'text-[var(--color-primary)]' : 'text-[var(--color-foreground)]'}`}>{m.title}</h3>
                  {m.recommended && <span className="text-[10px] leading-none px-1.5 py-0.5 rounded-full border border-[var(--color-primary)]/30 text-[var(--color-primary)] font-bold uppercase tracking-wide">Recommended</span>}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted)]">{m.description}</p>
              </div>
              <div className={`mt-auto text-xs font-medium ${active ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted-light)]'}`}>{active ? '✓ Selected' : 'Click to select'}</div>
            </button>
          );
        })}
      </div>

      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-4">
        <h4 className="text-sm font-semibold text-[var(--color-foreground)] mb-1">Need all three?</h4>
        <p className="text-xs text-[var(--color-muted)]">
          Choose a starting mode above — in the Review step you can still add manual items and import more from the question bank, even when you start with AI.
        </p>
      </div>
    </div>
  );
}
