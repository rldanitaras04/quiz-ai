import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect('/login');
  }

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  const role = roles && roles.length > 0 ? roles[0].role : 'student';

  if (role === 'super_admin') {
    redirect('/admin');
  } else if (role === 'faculty') {
    redirect('/faculty');
  } else {
    redirect('/student');
  }
}
