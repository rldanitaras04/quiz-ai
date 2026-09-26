'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';
import type { AuditLogEntry } from '../actions';
import { AUDIT_ACTION_LABELS, AUDIT_ACTIONS, ENTITY_TYPES, actionVariant } from './constants';

interface AuditLogsFilterProps {
  logs: AuditLogEntry[];
  /** Full match count, so pagination can size the page window. */
  totalCount: number;
  /** 1-based server-side page currently displayed. */
  page: number;
  /** Rows per page from admin settings. */
  pageSize: number;
  currentAction?: string;
  currentEntityType?: string;
}

export default function AuditLogsFilter({
  logs,
  totalCount,
  page,
  pageSize,
  currentAction,
  currentEntityType,
}: AuditLogsFilterProps) {
  const router = useRouter();

  function updateFilter(key: string, value: string) {
    // Page is intentionally dropped: changing a filter returns to page 1.
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

  function goToPage(next: number) {
    const params = new URLSearchParams();
    if (currentAction) params.set('action', currentAction);
    if (currentEntityType) params.set('entityType', currentEntityType);
    if (next > 1) params.set('page', String(next));
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
            Activity Log ({totalCount.toLocaleString()})
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
            <>
              <Table cards caption="Activity log">
                <THead>
                  <TR>
                    <TH>Actor</TH>
                    <TH>Action</TH>
                    <TH>Entity</TH>
                    <TH>Entity ID</TH>
                    <TH>Timestamp</TH>
                  </TR>
                </THead>
                <TBody>
                  {logs.map((log) => (
                    <TR key={log.id}>
                      <TD primary label="Actor">
                        <p className="font-medium text-[var(--color-foreground)]">
                          {log.actor_name ?? 'System'}
                        </p>
                        {log.actor_email && (
                          <p className="text-xs text-[var(--color-muted)]">{log.actor_email}</p>
                        )}
                      </TD>
                      <TD label="Action">
                        <Badge variant={actionVariant[log.action] ?? 'default'}>
                          {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                      </TD>
                      <TD label="Entity" className="text-[var(--color-muted)]">
                        {log.entity_type}
                      </TD>
                      <TD label="Entity ID" className="text-[var(--color-muted)] font-mono text-xs">
                        {log.entity_id ? log.entity_id.slice(0, 8) + '…' : '—'}
                      </TD>
                      <TD label="Timestamp" className="text-[var(--color-muted)]">
                        {new Date(log.created_at).toLocaleString()}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <Pagination page={page} pageSize={pageSize} total={totalCount} onPageChange={goToPage} />
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
