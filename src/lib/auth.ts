import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import type { UserRole } from '@/lib/types';

/** Landing route for each role. Used when a user reaches a section they do not own. */
export function homePathForRole(role: UserRole): string {
  if (role === 'super_admin') return '/admin';
  if (role === 'faculty') return '/faculty';
  return '/student';
}

export type RoleGate =
  | { status: 'ok'; user: User; role: UserRole; supabase: SupabaseClient }
  | { status: 'blocked'; reason: 'suspended' | 'inactive' };

/**
 * Server-side role gate for a route group.
 *
 * UI visibility is not a security control — RLS and the server actions remain
 * the enforcement layer — but unauthenticated/unauthorized navigation should
 * never reach a section's pages at all. Unauthorized roles are redirected to
 * their own dashboard instead of being shown an empty shell.
 *
 * Accounts that an administrator has suspended or deactivated are refused
 * outright. ('pending' accounts are still allowed through: approvals are not
 * yet wired up, so treating pending as denied would lock out every account
 * created before an admin review.)
 */
export async function requireRole(allowed: readonly UserRole[]): Promise<RoleGate> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', user.id)
    .single();

  if (profile?.status === 'suspended' || profile?.status === 'inactive') {
    return { status: 'blocked', reason: profile.status };
  }

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const role = getPrimaryRole((roles ?? []).map((r) => r.role as UserRole));

  if (!allowed.includes(role)) {
    redirect(homePathForRole(role));
  }

  return { status: 'ok', user, role, supabase };
}
