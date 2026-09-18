'use client';

import { useState, type FormEvent, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useSupabase } from '@/lib/hooks';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants';

export default function LoginPage(): JSX.Element {
  const supabase = useSupabase();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    window.location.href = '/dashboard';
  };

  return (
    <div className="flex flex-col items-center">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex items-center justify-center h-10 w-10 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-lg font-bold">
          M
        </div>
        <span className="text-2xl font-bold text-[var(--color-foreground)]">{APP_NAME}</span>
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
          placeholder="••••••••"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

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
