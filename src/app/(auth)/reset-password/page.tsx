'use client';

import { useEffect, useState, type FormEvent, type JSX } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useImplicitAuthLink, useSupabase } from '@/lib/hooks';
import { validatePassword } from '@/lib/validators';
import { Brand } from '@/components/brand';

/**
 * Step 2 of password recovery. The "Recover password" email redirects here
 * with the session tokens in the URL FRAGMENT (implicit flow — issued by the
 * server action so the link works in the recipient's own browser, not just
 * the one that requested it). useImplicitAuthLink consumes them: once saved to
 * the auth cookies, changing the password is an ordinary signed-in call.
 *
 * Arriving with no tokens at all (bookmarked page, expired link) shows a
 * pointer back to /forgot-password rather than a form that would fail.
 */
export default function ResetPasswordPage(): JSX.Element {
  const router = useRouter();
  const supabase = useSupabase();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const linkState = useImplicitAuthLink();

  useEffect(() => {
    let cancelled = false;

    const boot = async () => {
      if (linkState === 'reading') return;
      if (linkState === 'authenticated') {
        setReady(true);
        return;
      }
      if (linkState === 'expired') {
        setInvalid(true);
        return;
      }

      // Opened the page directly with no tokens. An existing session (e.g. a
      // signed-in user rotating their password) may still use the form.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (data.session) setReady(true);
      else setInvalid(true);
    };

    void boot();
    return () => {
      cancelled = true;
    };
  }, [linkState, supabase]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    const check = validatePassword(password);
    if (!check.success) {
      const messages = [...new Set(check.errors.map((err) => err.message))];
      setError(messages[0]);
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setDone(true);
    router.push('/');
    router.refresh();
  };

  if (invalid) {
    return (
      <div className="flex flex-col items-center">
        <div className="mb-8 flex items-center justify-center">
          <Brand />
        </div>
        <div className="w-full rounded-xl bg-[var(--color-surface)] p-8 text-center shadow-lg">
          <h1 className="text-xl font-semibold text-[var(--color-foreground)]">
            Link expired
          </h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            That password reset link is no longer valid — links can only be
            used once and they expire. Request a fresh one and try again.
          </p>
          <Link
            href="/forgot-password"
            className="mt-6 inline-block rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  if (!ready) {
    // Tokens are being consumed (or the session restored); avoid flashing
    // the form before we know the link is good.
    return (
      <div className="flex flex-col items-center">
        <div className="mb-8 flex items-center justify-center">
          <Brand />
        </div>
        <p className="text-sm text-[var(--color-muted)]" role="status">
          Verifying your reset link…
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col items-center">
        <div className="mb-8 flex items-center justify-center">
          <Brand />
        </div>
        <div className="w-full rounded-xl bg-[var(--color-surface)] p-8 text-center shadow-lg">
          <h1 className="text-xl font-semibold text-[var(--color-foreground)]">
            Password updated
          </h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Your new password is active. Continue to the app — you are already
            signed in on this device.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            Continue
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 flex items-center justify-center">
        <Brand />
      </div>

      <h1 className="text-xl font-semibold text-[var(--color-foreground)] mb-1">
        Choose a new password
      </h1>
      <p className="text-sm text-[var(--color-muted)] mb-8">
        Set a password for your account. You will use it the next time you
        sign in.
      </p>

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <Input
          label="New password"
          type="password"
          revealable
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />

        <Input
          label="Confirm new password"
          type="password"
          revealable
          placeholder="••••••••"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
        />

        {error && (
          <p className="text-sm text-[var(--color-danger)]" role="alert">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" loading={loading} className="w-full">
          Update password
        </Button>
      </form>
    </div>
  );
}
