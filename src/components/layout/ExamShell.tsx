'use client';

import type { JSX, ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from '@phosphor-icons/react';

interface ExamShellProps {
  children: ReactNode;
  /** Link to return to (e.g., assessment details). */
  backHref?: string;
  /** Label for the back link. */
  backLabel?: string;
}

/**
 * Minimal exam shell with only examination-related navigation.
 *
 * No sidebar, no top bar, no dashboard navigation.
 * Just a thin header with a back link and the exam content.
 */
export default function ExamShell({
  children,
  backHref,
  backLabel = 'Back to Assessment',
}: ExamShellProps): JSX.Element {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-background)]">
      {/* Minimal exam header */}
      <header className="flex items-center h-12 px-4 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        {backHref && (
          <Link
            href={backHref}
            className="flex items-center gap-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" weight="regular" />
            <span className="hidden sm:inline">{backLabel}</span>
          </Link>
        )}
        <div className="flex-1" />
        <div className="text-xs font-medium text-[var(--color-muted)]">
          MiMo Examination
        </div>
      </header>

      {/* Exam content - full height, no scroll constraints from shell */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
