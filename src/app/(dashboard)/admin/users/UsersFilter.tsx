'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Input from '@/components/ui/Input';
import EmptyState from '@/components/ui/EmptyState';
import type { UserWithRoles } from '../actions';
import { ROLE_LABELS } from '@/lib/constants';
import type { UserRole } from '@/lib/types';

const statusVariant: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
  active: 'success',
  pending: 'warning',
  suspended: 'danger',
  inactive: 'default',
};

const roleVariant: Record<string, 'info' | 'default' | 'outline'> = {
  super_admin: 'info',
  faculty: 'default',
  student: 'outline',
};

interface UsersFilterProps {
  users: UserWithRoles[];
}

export default function UsersFilter({ users }: UsersFilterProps) {
  const [search, setSearch] = useState('');

  const filtered = users.filter((u) => {
    const query = search.toLowerCase();
    if (!query) return true;
    return (
      u.email.toLowerCase().includes(query) ||
      u.full_name.toLowerCase().includes(query) ||
      u.roles.some((r) => r.toLowerCase().includes(query))
    );
  });

  return (
    <>
      <div className="mb-4">
        <Input
          placeholder="Search by name, email, or role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
            All Users ({filtered.length})
          </h2>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <EmptyState
              title="No users found"
              description={search ? 'Try adjusting your search query.' : 'No users have been registered yet.'}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Name</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Email</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Roles</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Status</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]"
                    >
                      <td className="py-3 px-4 font-medium text-[var(--color-foreground)]">
                        {u.full_name}
                      </td>
                      <td className="py-3 px-4 text-[var(--color-muted)]">{u.email}</td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r} variant={roleVariant[r] ?? 'default'}>
                              {ROLE_LABELS[r as UserRole] ?? r}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={statusVariant[u.status] ?? 'default'}>
                          {u.status}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-[var(--color-muted)]">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
