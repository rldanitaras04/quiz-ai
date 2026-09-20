import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAuditLogs } from '../actions';
import type { AuditAction } from '@/lib/types';
import AuditLogsFilter from './AuditLogsFilter';

interface AuditLogsPageProps {
  searchParams: Promise<{ action?: string; entityType?: string }>;
}

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  // Access is gated by the admin layout; `getAuditLogs` re-authorizes the caller
  // server-side before it reads anything.
  const params = await searchParams;
  const { logs, totalCount } = await getAuditLogs({
    action: params.action as AuditAction | undefined,
    entityType: params.entityType,
  });

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="View system activity and change history"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Audit Logs' },
        ]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Total Logs</p>
            <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{totalCount}</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Showing the {logs.length} most recent
            </p>
          </CardContent>
        </Card>
      </div>

      <AuditLogsFilter
        logs={logs}
        totalCount={totalCount}
        currentAction={params.action}
        currentEntityType={params.entityType}
      />
    </div>
  );
}
