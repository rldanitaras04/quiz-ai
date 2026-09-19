import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAuditLogs } from '../actions';
import type { AuditAction } from '@/lib/types';
import AuditLogsFilter from './AuditLogsFilter';

interface AuditLogsPageProps {
  searchParams: Promise<{ action?: string; entityType?: string }>;
}

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!roles?.some((r) => r.role === 'super_admin')) redirect('/');

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
          </CardContent>
        </Card>
      </div>

      <AuditLogsFilter
        logs={logs}
        currentAction={params.action}
        currentEntityType={params.entityType}
      />
    </div>
  );
}
