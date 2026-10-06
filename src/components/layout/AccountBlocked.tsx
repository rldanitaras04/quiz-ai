import type { JSX } from 'react';
import { redirect } from 'next/navigation';
import { signOut } from '@/app/actions/auth';

interface AccountBlockedProps {
  reason: 'pending' | 'suspended' | 'inactive';
}

/**
 * Rendered in place of a section's pages when the account may not use the
 * app yet: 'pending' = registered but not yet approved by an administrator
 * (no email verification exists, so approval is the gate), while
 * 'suspended'/'inactive' = an administrator locked it afterwards. Signing
 * out happens through a server action (the only place auth cookies can be
 * cleared) so the user reaches the landing page.
 */
export default function AccountBlocked({ reason }: AccountBlockedProps): JSX.Element {
  const heading = reason === 'pending' ? 'Awaiting approval' : 'Account unavailable';
  const message =
    reason === 'pending'
      ? 'Your account has been created but is awaiting administrator approval — you can sign in once it is approved. You will receive an email with a sign-in link at that point; contact your administrator if this is taking long.'
      : reason === 'suspended'
        ? 'Your account has been suspended. Contact an administrator.'
        : 'Your account is inactive. Contact an administrator.';

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
        <h1 className="text-lg font-semibold text-[var(--color-foreground)] mb-2">
          {heading}
        </h1>
        <p className="text-sm text-[var(--color-muted)] mb-6">{message}</p>
        <form
          action={async () => {
            'use server';
            await signOut();
            redirect('/');
          }}
        >
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)] transition-colors"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
