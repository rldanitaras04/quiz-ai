import type { JSX } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Brand } from '@/components/brand';
import { APP_NAME } from '@/lib/constants';

export const metadata: Metadata = {
  title: `Page not found — ${APP_NAME}`,
};

/**
 * Root 404. It renders inside the root layout, so it inherits the design
 * tokens, theme, and fonts. `/` re-resolves the signed-in user's role home
 * (see the proxy), which is the right destination whether the visitor is
 * signed in or not.
 *
 * Deliberately icon-free: the icon library is a client-side package, and this
 * page is also the fallback for requests that reach the router without a
 * session or a working bundle.
 */
export default function NotFound(): JSX.Element {
  return (
    <main className="flex min-h-[70vh] flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[var(--shadow-md)]">
        <div className="flex justify-center">
          <Brand />
        </div>

        <p
          className="mt-8 text-4xl font-semibold tracking-tight text-[var(--color-muted-light)]"
          aria-hidden="true"
        >
          404
        </p>

        <h1 className="mt-2 text-xl font-semibold text-[var(--color-foreground)]">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">
          That address does not match any page in {APP_NAME}. It may have been
          renamed, or the link that brought you here may be out of date.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="inline-block rounded-[var(--radius-lg)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            Go to your dashboard
          </Link>
          <Link
            href="/login"
            className="inline-block rounded-[var(--radius-lg)] border border-[var(--color-border-strong)] px-4 py-2 text-sm font-medium text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-hover)]"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
