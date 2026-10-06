'use client';

import { useState, type FormEvent, type JSX } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { sendPasswordResetEmail } from '@/app/actions/auth';
import { Brand } from '@/components/brand';

/**
 * Step 1 of password recovery: ask for the address and dispatch GoTrue's
 * "Recover password" email (Authentication -> Email Templates). The link it
 * contains redirects to /reset-password with the session tokens in the URL
 * fragment, and is issued with the implicit flow so it opens in whatever
 * browser received the email.
 *
 * The response is deliberately identical for unknown and known addresses
 * (the server action mirrors GoTrue's anti-enumeration behaviour), so the
 * copy says "if an account exists" rather than promising an email was sent.
 */
export default function ForgotPasswordPage(): JSX.Element {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await sendPasswordResetEmail(email);

    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSent(true);
  };

  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 flex items-center justify-center">
        <Brand />
      </div>

      {sent ? (
        <div className="w-full rounded-xl bg-[var(--color-surface)] p-8 text-center shadow-lg">
          <h1 className="text-xl font-semibold text-[var(--color-foreground)]">
            Check your inbox
          </h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            If an account exists for <span className="font-medium">{email}</span>,
            we sent it a link to choose a new password. The link expires after
            a short time — check your spam folder if it does not arrive.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm text-[var(--color-primary)] underline-offset-2 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      ) : (
        <>
          <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-1">
            Forgot your password?
          </h1>
          <p className="text-sm text-[var(--color-muted)] mb-8">
            Enter the address you registered with and we&rsquo;ll email you a
            link to set a new one.
          </p>

          <form onSubmit={handleSubmit} className="w-full space-y-4">
            <Input
              label="Email"
              type="email"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />

            {error && (
              <p className="text-sm text-[var(--color-danger)]" role="alert">
                {error}
              </p>
            )}

            <Button type="submit" variant="primary" loading={loading} className="w-full">
              Send reset link
            </Button>
          </form>

          <p className="mt-6 text-sm text-[var(--color-muted)]">
            Remembered it?{' '}
            <Link
              href="/login"
              className="text-[var(--color-primary)] underline-offset-2 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </>
      )}
    </div>
  );
}
