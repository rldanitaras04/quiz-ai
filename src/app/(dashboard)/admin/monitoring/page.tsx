import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';

export default async function MonitoringPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!roles?.some((r) => r.role === 'super_admin')) redirect('/');

  const [usersResult, rolesResult, assessmentsResult, examsResult, auditResult, notificationsResult] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('user_roles').select('role'),
    supabase.from('assessments').select('id, status'),
    supabase.from('exam_attempts').select('id, status'),
    supabase.from('audit_logs').select('action').order('created_at', { ascending: false }).limit(100),
    supabase.from('notifications').select('id, read_at'),
  ]);

  const totalUsers = usersResult.count ?? 0;
  const roleDistribution = (rolesResult.data ?? []).reduce(
    (acc, r) => {
      acc[r.role] = (acc[r.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const assessments = assessmentsResult.data ?? [];
  const assessmentStatuses = assessments.reduce(
    (acc, a) => {
      acc[a.status] = (acc[a.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const exams = examsResult.data ?? [];
  const examStatuses = exams.reduce(
    (acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const auditLogs = auditResult.data ?? [];
  const actionCounts = auditLogs.reduce(
    (acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalNotifications = notificationsResult.data?.length ?? 0;
  const unreadNotifications = notificationsResult.data?.filter((n) => !n.read_at).length ?? 0;

  return (
    <div>
      <PageHeader title="System Monitoring" description="Monitor system activity and health" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">Total Users</p>
            <p className="text-3xl font-bold text-[var(--color-foreground)]">{totalUsers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">Assessments</p>
            <p className="text-3xl font-bold text-[var(--color-foreground)]">{assessments.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">Exam Attempts</p>
            <p className="text-3xl font-bold text-[var(--color-foreground)]">{exams.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm text-[var(--color-muted)]">Unread Notifications</p>
            <p className="text-3xl font-bold text-[var(--color-foreground)]">{unreadNotifications}/{totalNotifications}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>Role Distribution</CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(roleDistribution).map(([role, count]) => (
                <div key={role} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-foreground)] capitalize">{role.replace('_', ' ')}</span>
                  <span className="text-sm font-medium text-[var(--color-foreground)]">{count}</span>
                </div>
              ))}
              {Object.keys(roleDistribution).length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">No users found</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>Assessment Status</CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(assessmentStatuses).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-foreground)] capitalize">{status}</span>
                  <span className="text-sm font-medium text-[var(--color-foreground)]">{count}</span>
                </div>
              ))}
              {Object.keys(assessmentStatuses).length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">No assessments found</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>Exam Attempt Status</CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(examStatuses).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between">
                  <span className="text-sm text-[var(--color-foreground)] capitalize">{status.replace('_', ' ')}</span>
                  <span className="text-sm font-medium text-[var(--color-foreground)]">{count}</span>
                </div>
              ))}
              {Object.keys(examStatuses).length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">No exam attempts found</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>Recent Audit Activity</CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(actionCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([action, count]) => (
                  <div key={action} className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-foreground)] capitalize">{action}</span>
                    <span className="text-sm font-medium text-[var(--color-foreground)]">{count}</span>
                  </div>
                ))}
              {Object.keys(actionCounts).length === 0 && (
                <p className="text-sm text-[var(--color-muted)]">No audit logs found</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
