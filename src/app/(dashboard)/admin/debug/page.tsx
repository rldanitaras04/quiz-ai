import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { JSX } from 'react';
import AdminDebugClient from './AdminDebugClient';

export const metadata = {
  title: 'Debug: Role Diagnosis',
};

export default async function AdminDebugPage(): Promise<JSX.Element> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const isAdmin = roles?.some((r) => r.role === 'super_admin');
  if (!isAdmin) redirect('/');

  return <AdminDebugClient />;
}
