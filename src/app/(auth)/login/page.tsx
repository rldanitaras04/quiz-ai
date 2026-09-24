'use client';

import { useState, type FormEvent, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useSupabase } from '@/lib/hooks';
import { APP_DESCRIPTION } from '@/lib/constants';
import { Brand } from '@/components/brand';

export default function LoginPage(): JSX.Element {
  const router = useRouter();
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

    // Client-side navigation: the browser Supabase client has already written
    // the auth cookies, so the next server render (router.refresh) sees the
    // session and resolves the role dashboard.
    router.push('/');
    router.refresh();
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
