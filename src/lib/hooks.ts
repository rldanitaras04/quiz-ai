'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Profile, UserRoleRow } from '@/lib/types';
import type { SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export function useSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient();
  }
  return supabaseInstance;
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

  const fetchUser = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, loading: true, error: null }));

      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setState({ profile: null, role: null, loading: false, error: 'Not authenticated' });
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError) {
        setState({ profile: null, role: null, loading: false, error: profileError.message });
        return;
      }

      const { data: roles } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      const primaryRole = roles && roles.length > 0 ? roles[0] : null;

      setState({
        profile,
        role: primaryRole,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState({
        profile: null,
        role: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, [supabase]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return state;
}
