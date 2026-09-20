'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { ROLE_LABELS } from '@/lib/constants';
import type { UserRole } from '@/lib/types';
import type { AdminUserRow } from './actions';
import { setUserStatus, assignRole, revokeRole, setStudentVerification } from './actions';

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

const ASSIGNABLE_ROLES = ['super_admin', 'faculty', 'student'] as const;

interface UsersManagerProps {
  users: AdminUserRow[];
  /** The signed-in administrator, so self-destructive controls can be disabled. */
  currentUserId: string;
}

export default function UsersManager({ users, currentUserId }: UsersManagerProps): JSX.Element {
  const router = useRouter();
  const [search, setSearch] = useState('');

  const query = search.toLowerCase();
  const filtered = query
    ? users.filter(
        (u) =>
          u.email.toLowerCase().includes(query) ||
          u.fullName.toLowerCase().includes(query) ||
          u.roles.some((r) => r.toLowerCase().includes(query))
      )
    : users;

  return (
    <>
      <div className="mb-4">
        <Input
          placeholder="Search by name, email, or role…"
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
              description={
                query ? 'Try adjusting your search query.' : 'No users have been registered yet.'
              }
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
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Verification</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      isSelf={user.id === currentUserId}
                      onChanged={() => router.refresh()}
                    />
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

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function UserRow({
  user,
  isSelf,
  onChanged,
}: {
  user: AdminUserRow;
  isSelf: boolean;
  onChanged: () => void;
}): JSX.Element {
  const isStudent = user.roles.includes('student');
  const grantable = ASSIGNABLE_ROLES.filter(
    (r) => !user.roles.includes(r) && !(r === 'student' && !user.studentNumber)
  );

  return (
    <tr className="border-b border-[var(--color-border)] last:border-0 align-top hover:bg-[var(--color-surface-hover)]">
      <td className="py-3 px-4 font-medium text-[var(--color-foreground)]">
        {user.fullName}
        {isSelf && <span className="ml-2 text-xs text-[var(--color-muted)]">(you)</span>}
        {user.studentNumber && (
          <span className="block text-xs text-[var(--color-muted)]">{user.studentNumber}</span>
        )}
      </td>
      <td className="py-3 px-4 text-[var(--color-muted)]">{user.email}</td>

      <td className="py-3 px-4">
        <div className="flex flex-wrap items-center gap-1">
          {user.roles.length === 0 && (
            <span className="text-xs text-[var(--color-muted)]">No roles</span>
          )}
          {user.roles.map((r) => (
            <span key={r} className="inline-flex items-center gap-0.5">
              <Badge variant={roleVariant[r] ?? 'default'}>
                {ROLE_LABELS[r as UserRole] ?? r}
              </Badge>
              <RowAction
                label="Remove role"
                text="×"
                confirmMessage={
                  r === 'super_admin'
                    ? 'Remove the administrator role from this user?'
                    : `Remove the ${r} role from this user?`
                }
                disabled={isSelf && r === 'super_admin'}
                onClick={() => revokeRole(user.id, r)}
                onDone={onChanged}
                successMessage={`Removed the ${ROLE_LABELS[r as UserRole] ?? r} role.`}
              />
            </span>
          ))}
          {grantable.length > 0 && (
            <Select
              aria-label="Add role"
              value=""
              className="!w-auto !py-1 !text-xs"
              onChange={(e) => {
                const role = e.target.value;
                if (!role) return;
                void (async () => {
                  const result = await assignRole(user.id, role);
                  if ('error' in result) {
                    notifyError('Could not assign the role', result.error);
                    return;
                  }
                  notifySuccess(
                    'Role assigned',
                    `${ROLE_LABELS[role as UserRole] ?? role} granted to ${user.fullName}.`
                  );
                  onChanged();
                })();
              }}
            >
              <option value="">Add role…</option>
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r as UserRole] ?? r}
                </option>
              ))}
            </Select>
          )}
        </div>
      </td>

      <td className="py-3 px-4">
        <div className="flex flex-col gap-1">
          <Badge variant={statusVariant[user.status] ?? 'default'}>{user.status}</Badge>
          <div className="flex items-center gap-1">
            {user.status !== 'active' && (
              <RowAction
                label="Approve"
                text={user.status === 'pending' ? 'Approve' : 'Activate'}
                onClick={() => setUserStatus(user.id, 'active')}
                onDone={onChanged}
                disabled={isSelf}
                successMessage={
                  user.status === 'pending'
                    ? `${user.fullName} approved.`
                    : `${user.fullName} activated.`
                }
              />
            )}
            {user.status === 'active' && !isSelf && (
              <RowAction
                label="Suspend"
                text="Suspend"
                confirmMessage={`Suspend ${user.fullName}?`}
                onClick={() => setUserStatus(user.id, 'suspended')}
                onDone={onChanged}
                successMessage={`${user.fullName} suspended.`}
              />
            )}
          </div>
        </div>
      </td>

      <td className="py-3 px-4">
        {isStudent ? (
          <Select
            aria-label="Identity verification"
            value={user.verificationStatus ?? 'pending'}
            className="!w-auto !py-1 !text-xs"
            onChange={(e) => {
              const status = e.target.value;
              void (async () => {
                const result = await setStudentVerification(user.id, status);
                if ('error' in result) {
                  notifyError('Could not update verification', result.error);
                  return;
                }
                notifySuccess('Verification updated', `${user.fullName}: ${status}.`);
                onChanged();
              })();
            }}
          >
            <option value="pending">pending</option>
            <option value="verified">verified</option>
            <option value="failed">failed</option>
          </Select>
        ) : (
          <span className="text-xs text-[var(--color-muted)]">—</span>
        )}
      </td>

      <td className="py-3 px-4 text-[var(--color-muted)]">
        {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------

function RowAction({
  label,
  text,
  onClick,
  onDone,
  confirmMessage,
  successMessage,
  disabled = false,
}: {
  label: string;
  text: string;
  onClick: () => Promise<{ success: true } | { error: string }>;
  onDone: () => void;
  confirmMessage?: string;
  successMessage?: string;
  disabled?: boolean;
}): JSX.Element {
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    if (confirmMessage) {
      const confirmed = await confirmAction({
        title: confirmMessage,
        confirmText: label,
        destructive: true,
      });
      if (!confirmed) return;
    }

    setBusy(true);
    const result = await onClick();
    setBusy(false);

    if ('error' in result) {
      notifyError(`Could not ${label.toLowerCase()}`, result.error);
      return;
    }

    if (successMessage) notifySuccess(successMessage);
    onDone();
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      loading={busy}
      disabled={disabled}
      title={label}
      aria-label={label}
      onClick={() => void run()}
      className="!h-6 !px-1.5 !text-xs"
    >
      {text}
    </Button>
  );
}
