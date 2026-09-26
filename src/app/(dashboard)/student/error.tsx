'use client';

import type { JSX } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import Button from '@/components/ui/Button';

/**
 * Rendered when a student page fails to load (unexpected server or query
 * error). `reset()` re-renders the segment, which re-runs the reads.
 */
export default function StudentError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): JSX.Element {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-4 text-center">
      <WarningCircle className="h-12 w-12 text-[var(--color-danger)]" weight="fill" />
      <h2 className="mt-4 text-lg font-semibold text-[var(--color-foreground)]">
        This page could not load
      </h2>
      <p className="mt-1 max-w-md text-sm text-[var(--color-muted)]">
        Something went wrong while reading your data. This is usually temporary —
        retry, and check with your instructor if it persists.
      </p>
      <div className="mt-6">
        <Button variant="primary" onClick={reset}>
          Retry
        </Button>
      </div>
    </div>
  );
}
