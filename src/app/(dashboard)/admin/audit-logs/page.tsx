import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAuditLogs } from '../actions';
import type { AuditAction } from '@/lib/types';
import AuditLogsFilter from './AuditLogsFilter';

interface AuditLogsPageProps {
  searchParams: Promise<{ action?: string; entityType?: string; page?: string }>;
}

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  // Access is gated by the admin layout; `getAuditLogs` re-authorizes the caller
  // server-side before it reads anything.
  const params = await searchParams;
  const requestedPage = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const filters = {
    action: params.action as AuditAction | undefined,
    entityType: params.entityType,
    page,
  };
  let result = await getAuditLogs(filters);

  // A stale deep link (?page=999) lands past the end — clamp to the last page.
  const pageCount = Math.max(1, Math.ceil(result.totalCount / result.pageSize));
  if (page > pageCount && result.totalCount > 0) {
    result = await getAuditLogs({ ...filters, page: pageCount });
  }

  const { logs, totalCount, pageSize } = result;
  const safePage = Math.min(page, pageCount);

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
              {pageSize} per page · page {safePage} of {pageCount}
            </p>
          </CardContent>
        </Card>
      </div>

      <AuditLogsFilter
        logs={logs}
        totalCount={totalCount}
        page={safePage}
        pageSize={pageSize}
        currentAction={params.action}
        currentEntityType={params.entityType}
      />
    </div>
  );
}
