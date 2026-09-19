'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import type { AuditLogEntry } from '../actions';
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS, ENTITY_TYPES, actionVariant } from './constants';

interface AuditLogsFilterProps {
  logs: AuditLogEntry[];
  currentAction?: string;
  currentEntityType?: string;
}

export default function AuditLogsFilter({
  logs,
  currentAction,
  currentEntityType,
}: AuditLogsFilterProps) {
  const router = useRouter();

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams();
    if (key === 'action') {
      if (value && value !== currentAction) params.set('action', value);
      if (currentEntityType) params.set('entityType', currentEntityType);
    } else {
      if (value && value !== currentEntityType) params.set('entityType', value);
      if (currentAction) params.set('action', currentAction);
    }
    const qs = params.toString();
    router.push(`/admin/audit-logs${qs ? `?${qs}` : ''}`);
  }

  return (
    <>
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--color-foreground)]">Action</label>
          <select
            value={currentAction ?? ''}
            onChange={(e) => updateFilter('action', e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
          >
            <option value="">All Actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--color-foreground)]">Entity Type</label>
          <select
            value={currentEntityType ?? ''}
            onChange={(e) => updateFilter('entityType', e.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
          >
            <option value="">All Entities</option>
            {ENTITY_TYPES.map((et) => (
              <option key={et} value={et}>
                {et}
              </option>
            ))}
          </select>
        </div>

        {(currentAction || currentEntityType) && (
          <div className="flex items-end">
            <button
              onClick={() => router.push('/admin/audit-logs')}
              className="text-sm text-[var(--color-primary)] hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
            Activity Log ({logs.length})
          </h2>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <EmptyState
              title="No logs found"
              description={
                currentAction || currentEntityType
                  ? 'Try adjusting your filters.'
                  : 'No audit logs have been recorded yet.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Actor</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Action</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Entity</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Entity ID</th>
                    <th className="text-left py-3 px-4 font-medium text-[var(--color-muted)]">Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]"
                    >
                      <td className="py-3 px-4">
                        <div>
                          <p className="font-medium text-[var(--color-foreground)]">
                            {log.actor_name ?? 'System'}
                          </p>
                          {log.actor_email && (
                            <p className="text-xs text-[var(--color-muted)]">{log.actor_email}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant={actionVariant[log.action] ?? 'default'}>
                          {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                      </td>
                      <td className="py-3 px-4 text-[var(--color-muted)]">{log.entity_type}</td>
                      <td className="py-3 px-4 text-[var(--color-muted)] font-mono text-xs">
                        {log.entity_id ? log.entity_id.slice(0, 8) + '…' : '—'}
                      </td>
                      <td className="py-3 px-4 text-[var(--color-muted)]">
                        {new Date(log.created_at).toLocaleString()}
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
