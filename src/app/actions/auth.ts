'use server';

import { createClient } from '@/lib/supabase/server';

/**
 * Sign the user out server-side so the httpOnly auth cookies set by
 * @supabase/ssr are actually removed. The client-side signOut in TopBar is
 * kept as a belt-and-braces cleanup of local session state.
 */
export async function signOut(): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) return { error: error.message };
  return {};
}
