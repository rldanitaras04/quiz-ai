'use client';

import { useEffect, useState, type FormEvent, type JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useImplicitAuthLink, useSupabase } from '@/lib/hooks';
import { APP_DESCRIPTION } from '@/lib/constants';
import { resendConfirmationEmail } from '@/app/actions/auth';
import { Brand } from '@/components/brand';

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const supabase = useSupabase();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [loading, setLoading] = useState(false);
  // GoTrue refuses to sign an unconfirmed address in ("Email not
  // confirmed"). Instead of showing that raw string, surface a panel with
  // the address we tried and a one-click resend.
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  // Approval and confirmation emails link to this page (see
  // dispatchApprovalNotice in admin/users/actions and resendConfirmationEmail
  // in app/actions/auth): Supabase Auth verifies the link and redirects here
  // with the session tokens in the URL FRAGMENT. useImplicitAuthLink consumes
  // them — once saved to the auth cookies, this is an ordinary signed-in visit.
  const linkState = useImplicitAuthLink();

  useEffect(() => {
    if (linkState === 'authenticated') {
      router.replace('/');
      router.refresh();
    }
  }, [linkState, router]);

  // Derived, not copied into state: an expired link is a fact about the URL,
  // and syncing it through setState inside the effect would add a second render
  // (and trip react-hooks/set-state-in-effect).
  const error =
    formError ||
    (linkState === 'expired'
      ? 'That sign-in link has expired or was already used. Please sign in with your password.'
      : '');

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      if (/email not confirmed|not confirmed/i.test(authError.message)) {
        setNeedsConfirmation(true);
        setFormError('Confirm your email address before signing in.');
      } else {
        setFormError(authError.message);
      }
      return;
    }

    setNeedsConfirmation(false);
    setResendMessage('');

    // Client-side navigation: the browser Supabase client has already written
    // the auth cookies, so the next server render (router.refresh) sees the
    // session and resolves the role dashboard.
    router.push('/');
    router.refresh();
  };

  const handleResend = async () => {
    setResending(true);
    setResendMessage('');
    const result = await resendConfirmationEmail(email);
    setResending(false);
    setResendMessage(
      result.error
        ? result.error
        : 'Confirmation email sent — open the link in it, then sign in again.'
    );
  };

  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 flex items-center justify-center">
        <Brand />
      </div>

      <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-1">Sign in</h1>
      <p className="text-sm text-[var(--color-muted)] mb-8">{APP_DESCRIPTION}</p>

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

        <Input
          label="Password"
          type="password"
          revealable
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        <div className="flex justify-end">
          <Link
            href="/forgot-password"
            className="text-sm text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-foreground)] hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        {needsConfirmation && (
          <div className="space-y-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <p className="text-sm text-[var(--color-foreground)]">
              Check your inbox — we sent a confirmation link to{' '}
              <span className="font-medium">{email}</span>.
            </p>
            <p className="text-sm text-[var(--color-muted)]">
              Open that link to verify your address, then sign in here. After
              verification, an administrator still has to activate your
              account before you can use the app.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={resending}
                onClick={handleResend}
              >
                Resend confirmation email
              </Button>
              {resendMessage && (
                <span className="text-xs text-[var(--color-muted)]" role="status">
                  {resendMessage}
                </span>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {error}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          loading={loading}
          className="w-full"
        >
          Sign in
        </Button>
      </form>
    </div>
  );
}
