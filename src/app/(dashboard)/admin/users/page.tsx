import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { requireRole } from '@/lib/auth';
import { getAdminUsers } from './actions';
import UsersManager from './UsersManager';

export default async function UsersPage(): Promise<JSX.Element> {
  // The layout already gates this route; this call supplies the actor id so the
  // UI can disable self-destructive controls.
  const gate = await requireRole(['super_admin']);
  const currentUserId = gate.status === 'ok' ? gate.user.id : '';

  const users = await getAdminUsers();

  const stats = [
    { label: 'Total Users', value: users.length },
    { label: 'Active', value: users.filter((u) => u.status === 'active').length },
    { label: 'Pending', value: users.filter((u) => u.status === 'pending').length },
    { label: 'Admins', value: users.filter((u) => u.roles.includes('super_admin')).length },
  ];

  return (
    <div>
      <PageHeader
        title="User Management"
        description="Approve accounts, manage roles, and review student verification"
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

      <UsersManager users={users} currentUserId={currentUserId} />
    </div>
  );
}
