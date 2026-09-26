import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { requireRole } from '@/lib/auth';
import { getAdminReferenceData } from '../../actions';
import { getAdminUsers } from '../actions';
import { buildSectionChoices } from '../sectionChoices';
import UsersManager from '../UsersManager';

export default async function StudentUsersPage(): Promise<JSX.Element> {
  const gate = await requireRole(['super_admin']);
  const currentUserId = gate.status === 'ok' ? gate.user.id : '';

  const [allUsers, reference] = await Promise.all([getAdminUsers(), getAdminReferenceData()]);
  const users = allUsers.filter((user) => user.roles.includes('student'));
  const sections = buildSectionChoices(reference);

  const stats = [
    { label: 'Total Students', value: users.length },
    { label: 'Active', value: users.filter((u) => u.status === 'active').length },
    { label: 'Pending Approval', value: users.filter((u) => u.status === 'pending').length },
    { label: 'Identity Verified', value: users.filter((u) => u.verificationStatus === 'verified').length },
  ];

  return (
    <div>
      <PageHeader
        title="Students"
        description="All accounts holding the student role, with sections and identity verification"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Users', href: '/admin/users' },
          { label: 'Students' },
        ]}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent>
              <p className="text-sm font-medium text-[var(--color-muted)]">{stat.label}</p>
              <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <UsersManager
        users={users}
        currentUserId={currentUserId}
        sections={sections}
        title="Students"
      />
    </div>
  );
}
