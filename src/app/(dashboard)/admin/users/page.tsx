import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getUsers } from '../actions';
import UsersFilter from './UsersFilter';

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!roles?.some((r) => r.role === 'super_admin')) redirect('/');

  const users = await getUsers();

  const totalUsers = users.length;
  const activeCount = users.filter((u) => u.status === 'active').length;
  const pendingCount = users.filter((u) => u.status === 'pending').length;
  const adminCount = users.filter((u) => u.roles.includes('super_admin')).length;

  const stats = [
    { label: 'Total Users', value: totalUsers },
    { label: 'Active', value: activeCount },
    { label: 'Pending', value: pendingCount },
    { label: 'Admins', value: adminCount },
  ];

  return (
    <div>
      <PageHeader
        title="User Management"
        description="View and manage all user accounts"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Users' },
        ]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent>
              <p className="text-sm font-medium text-[var(--color-muted)]">{stat.label}</p>
              <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <UsersFilter users={users} />
    </div>
  );
}
