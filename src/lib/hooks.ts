'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { signOut as signOutAction } from '@/app/actions/auth';
import { isTransientAuthError, withAuthRetry } from '@/lib/auth-errors';
import type { Profile, UserRoleRow } from '@/lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export function useSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient();
  }
  return supabaseInstance;
}

/**
 * Shared sign-out flow for chrome components (top bar, sidebar footer):
 * clears the server session, signs out of Supabase, and returns home.
 */
export function useSignOut(): { signOut: () => Promise<void>; signingOut: boolean } {
  const router = useRouter();
  const supabase = useSupabase();
  const [signingOut, setSigningOut] = useState(false);

  const execute = useCallback(async () => {
    setSigningOut(true);
    try {
      await signOutAction();
      await supabase.auth.signOut();
      router.push('/');
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [router, supabase]);

  return { signOut: execute, signingOut };
}

interface UserProfile {
  profile: Profile | null;
  role: UserRoleRow | null;
  loading: boolean;
  error: string | null;
}

export function useUser(): UserProfile {
  const [state, setState] = useState<UserProfile>({
    profile: null,
    role: null,
    loading: true,
    error: null,
  });

  const supabase = useSupabase();

  useEffect(() => {
    let cancelled = false;

    // Async IIFE: every setState below happens after an await, so the effect
    // body never triggers a synchronous cascading render.
    async function load(): Promise<void> {
      try {
        // Retry transient Auth failures (rate limit, refresh-token race)
        // instead of reporting the signed-in user as "Not authenticated".
        const { data: { user }, error: authError } = await withAuthRetry(
          () => supabase.auth.getUser()
        );
        if (cancelled) return;

        if (authError || !user) {
          setState({
            profile: null,
            role: null,
            loading: false,
            error: isTransientAuthError(authError)
              ? 'Sign-in check is busy — please try again in a moment.'
              : 'Not authenticated',
          });
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();

        if (cancelled) return;

        if (profileError) {
          setState({ profile: null, role: null, loading: false, error: profileError.message });
          return;
        }

        const { data: roles } = await supabase
          .from('user_roles')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: true });

        if (cancelled) return;

        setState({
          profile,
          role: roles && roles.length > 0 ? roles[0] : null,
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setState({
          profile: null,
          role: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return state;
}
