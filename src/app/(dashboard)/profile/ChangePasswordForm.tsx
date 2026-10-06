'use client';

import { useState, type FormEvent, type JSX } from 'react';
import Input from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { changePassword } from '@/app/actions/profile';
import { validatePassword } from '@/lib/validators';

/**
 * Self-service password change on /profile. Three fields by design: the
 * CURRENT password (re-proves the person at the keyboard owns the account —
 * a hijacked session alone cannot silently take over the login), the new
 * password, and its confirmation (catches typos before anything is written).
 *
 * Matching, strength, and "must differ" checks run here for instant
 * feedback; the server action repeats them and performs the actual
 * verification against GoTrue (see changePassword in actions/profile.ts).
 *
 * Feedback goes through SweetAlert toasts (notifyError/notifySuccess), the
 * app's single feedback channel — the same "Could not …" / success toasts
 * the admin tables raise — instead of a second, form-local message style.
 */
export default function ChangePasswordForm(): JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (next !== confirm) {
      notifyError('Passwords do not match', 'Re-type the new password in both fields.');
      return;
    }

    const check = validatePassword(next);
    if (!check.success) {
      const messages = [...new Set(check.errors.map((err) => err.message))];
      notifyError('Password too weak', messages[0]);
      return;
    }

    if (next === current) {
      notifyError('Choose a different password', 'The new password must differ from your current one.');
      return;
    }

    setLoading(true);
    const result = await changePassword(current, next);
    setLoading(false);

    if (result.error) {
      notifyError('Could not update password', result.error);
      return;
    }

    notifySuccess('Password updated', 'Use your new password the next time you sign in.');
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Current password"
        type="password"
        revealable
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        autoComplete="current-password"
      />

      <Input
        label="New password"
        type="password"
        revealable
        required
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="new-password"
      />

      <Input
        label="Confirm new password"
        type="password"
        revealable
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
      />

      <p className="text-xs text-[var(--color-muted)]">
        At least 8 characters, including an uppercase letter, a lowercase
        letter, and a number.
      </p>

      <Button type="submit" variant="primary" loading={loading}>
        Update Password
      </Button>
    </form>
  );
}
