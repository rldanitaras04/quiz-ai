'use client';

import { useEffect, type JSX } from 'react';
import './globals.css';
import { applyStoredTheme } from '@/lib/ui-preferences';
import { APP_NAME } from '@/lib/constants';
import { logger } from '@/lib/logger';

/**
 * Root error boundary. This replaces the root layout when layout rendering or
 * a segment above every `error.tsx` fails, so it must render its own
 * <html>/<body>, import the stylesheet itself, and re-apply the stored theme
 * (the pre-paint script in src/app/layout.tsx never ran in this document).
 *
 * `retry()` re-renders the boundary's children; `window.location.reload()` is
 * offered as the escape hatch for a failure that a re-render cannot clear
 * (e.g. a stale client bundle).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}): JSX.Element {
  useEffect(() => {
    applyStoredTheme();
  }, []);

  useEffect(() => {
    // The digest is what correlates this to the server-side stack trace; the
    // message may be intentionally generic in production. Reported through a
    // single call so a future error-reporting service has one place to hook in.
    logger.error('[global-error]', error.digest ?? '', error.message);
  }, [error]);

  return (
    <html lang="en">
      <body
        className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)]"
        style={{ fontFamily: 'var(--font-geist-sans), system-ui, sans-serif' }}
      >
        <main className="flex min-h-screen items-center justify-center px-4 py-16">
          <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-md)]">
            <p
              className="text-4xl font-semibold tracking-tight text-[var(--color-muted-light)]"
              aria-hidden="true"
            >
              500
            </p>

            <h1 className="mt-2 text-xl font-semibold text-[var(--color-foreground)]">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              {APP_NAME} could not load this page. This is usually temporary —
              retry, and if it keeps happening contact your administrator.
            </p>

            {error.digest && (
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                Reference: <code className="font-mono">{error.digest}</code>
              </p>
            )}

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => retry()}
                className="inline-block rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-block rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-hover)]"
              >
                Reload the page
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
