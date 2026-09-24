'use client';

import { useState, type ReactNode } from 'react';
import { CaretDown, CaretRight } from '@phosphor-icons/react';
import Badge from '@/components/ui/Badge';

interface CollapsibleSubjectCardProps {
  subjectLabel: string;
  resultCount: number;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * Subject group card whose assessment list can collapse/expand so the page
 * stays scannable as released results grow.
 */
export default function CollapsibleSubjectCard({
  subjectLabel,
  resultCount,
  children,
  defaultOpen = true,
}: CollapsibleSubjectCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)]">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={`subject-results-${subjectLabel.replace(/\s+/g, '-').toLowerCase()}`}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-[var(--color-surface-hover)] transition-colors rounded-[var(--radius-lg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <CaretDown className="h-4 w-4 shrink-0 text-[var(--color-muted)]" weight="regular" aria-hidden="true" />
          ) : (
            <CaretRight className="h-4 w-4 shrink-0 text-[var(--color-muted)]" weight="regular" aria-hidden="true" />
          )}
          <h2 className="truncate text-lg font-semibold text-[var(--color-foreground)]">
            {subjectLabel}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="info">
            {resultCount} result{resultCount !== 1 ? 's' : ''}
          </Badge>
          <span className="sr-only">{open ? 'Collapse' : 'Expand'} results</span>
        </div>
      </button>

      {open && (
        <div
          id={`subject-results-${subjectLabel.replace(/\s+/g, '-').toLowerCase()}`}
          className="px-4 pb-4"
        >
          {children}
        </div>
      )}
    </div>
  );
}
