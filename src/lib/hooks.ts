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

/**
 * State of the implicit-grant tokens carried in the URL FRAGMENT.
 *
 * Supabase Auth verifies emailed links and hands the session to the next page
 * in `#access_token=...&refresh_token=...`. The shared browser client is
 * PKCE-only and refuses implicit-grant callbacks, so those tokens have to be
 * consumed explicitly before the visit can be treated as signed in.
 *
 *  - `reading`       — not inspected yet (first client render)
 *  - `none`          — no tokens and no error in the fragment
 *  - `authenticated` — tokens were exchanged for a session; fragment cleared
 *  - `expired`       — the fragment carried an error, or setSession rejected it
 */
export type ImplicitAuthLinkState = 'reading' | 'none' | 'authenticated' | 'expired';

/**
 * Consume the implicit-grant tokens in the URL fragment, once, for whichever
 * page an emailed auth link lands on.
 *
 * Ordering matters here and is the whole reason this is a hook rather than two
 * copies:
 *  - the fragment is cleared only AFTER `setSession` resolves. Clearing it
 *    first made React StrictMode's second effect run — the one that runs
 *    immediately after the first, before the promise settled — see neither a
 *    hash nor a session, so a valid link reported itself as expired.
 *  - the `cancelled` guard keeps the abandoned first run from writing state.
 *  - a second run that finds no hash cannot downgrade a settled result.
 */
export function useImplicitAuthLink(): ImplicitAuthLinkState {
  const supabase = useSupabase();
  const [state, setState] = useState<ImplicitAuthLinkState>('reading');

  useEffect(() => {
    let cancelled = false;

    const consume = async () => {
      const hash = window.location.hash.replace(/^#/, '');
      if (!hash.includes('access_token') && !hash.includes('error')) {
        // No tokens to consume. Never overwrite a settled outcome: a StrictMode
        // re-run happens after the first run may have already cleared the hash.
        setState((prev) => (prev === 'reading' ? 'none' : prev));
        return;
      }

      const params = new URLSearchParams(hash);
      const clearFragment = () =>
        window.history.replaceState(null, '', window.location.pathname);

      // Expired or already-used link: GoTrue reports it in the fragment.
      if (params.get('error')) {
        clearFragment();
        if (!cancelled) setState('expired');
        return;
      }

      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      if (!accessToken || !refreshToken) {
        if (!cancelled) setState('none');
        return;
      }

      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      clearFragment();
      if (cancelled) return;

      setState(error ? 'expired' : 'authenticated');
    };

    void consume();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return state;
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
