import { redirect } from 'next/navigation';
import type { JSX, ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import { getAvatarUrl } from '@/lib/avatar';
import AppShell from '@/components/layout/AppShell';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default async function DashboardLayout({ children }: DashboardLayoutProps): Promise<JSX.Element> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const { data: roles } = await supabase
    .from('user_roles')
    .select('*')
    .eq('user_id', user.id);

  const role = getPrimaryRole(roles?.map((r) => r.role) ?? []);
  const userName = profile?.full_name ?? user.email ?? 'User';

  return (
    <AppShell
      title="Dashboard"
      role={role}
      userName={userName}
      avatarUrl={getAvatarUrl(profile?.avatar_path)}
    >
      {children}
    </AppShell>
  );
}
