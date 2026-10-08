'use client';

import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';
import { BrandIcon } from '@/components/brand';

interface ExamShellProps {
  children: ReactNode;
  /** Link to return to (e.g., assessment details). */
  backHref?: string;
  /** Label for the back link. */
  backLabel?: string;
  /** Right side of the single header row: sync indicator + timer. */
  status?: ReactNode;
}

/**
 * Secure examination chrome: ONE header row (back link, brand, exam status)
 * and the question content — no sidebar, no dashboard navigation.
 *
 * `h-dvh overflow-hidden` sizes to the visible mobile viewport (100vh would
 * overflow behind the URL bar) and keeps the shell itself from scrolling; the
 * question pane inside owns scrolling.
 */
export default function ExamShell({
  children,
  backHref,
  backLabel = 'Back to Assessment',
  status,
}: ExamShellProps): JSX.Element {
  return (
    <div className="h-dvh flex flex-col overflow-hidden bg-[var(--color-background)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 sm:px-4">
        {backHref && (
          <Link
            href={backHref}
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] px-1.5 py-1 text-sm text-[var(--color-muted)] transition-colors hover:text-[var(--color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            <ArrowLeft className="h-4 w-4" weight="regular" aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>
        )}

        <div className="hidden items-center gap-1.5 text-xs font-medium text-[var(--color-muted)] sm:flex">
          <BrandIcon className="h-4 w-4" alt="" />
          <span>SEAMS AI Examination</span>
        </div>

        <div className="flex-1" />

        <div className="flex min-w-0 items-center gap-2 sm:gap-3">{status}</div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
