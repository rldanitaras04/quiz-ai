import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';

export default async function StudentDashboardPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('id, status, subject_offering:subject_offerings(id, subject:subjects(id, code, title), section:sections(id, name))')
    .eq('student_id', user.id)
    .eq('status', 'enrolled');

  // Deployments are created as 'scheduled' and nothing ever flips them to
  // 'active' (the time window is authoritative — see the
  // deployment_effective_status view), so filtering on status = 'active'
  // permanently hid every exam from students. Filter on the window instead.
  const { data: deployments } = await supabase
    .from('assessment_deployments')
    .select('id, opens_at, closes_at, status, assessment_version:assessment_versions(id, assessment:assessments!assessment_versions_assessment_id_fkey(id, title))')
    .in('subject_offering_id', (enrollments ?? []).map((e: Record<string, unknown>) => (e.subject_offering as Record<string, unknown>)?.id as string).filter(Boolean))
    .in('status', ['active', 'scheduled'])
    .gte('closes_at', new Date().toISOString())
    .order('opens_at', { ascending: true })
    .limit(5);

  const { data: results } = await supabase
    .from('assessment_results')
    .select('id, raw_score, possible_score, percentage, status, released_at, deployment:assessment_deployments(id, assessment_version:assessment_versions(id, assessment:assessments!assessment_versions_assessment_id_fkey(id, title)))')
    .eq('student_id', user.id)
    .eq('status', 'released')
    .order('released_at', { ascending: false })
    .limit(5);

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(5);

  const enrolledCount = enrollments?.length ?? 0;
  const upcomingCount = deployments?.length ?? 0;
  const completedCount = results?.length ?? 0;
  const avgScore = completedCount > 0
    ? Math.round((results ?? []).reduce((sum: number, r: Record<string, unknown>) => sum + ((r.percentage as number) ?? 0), 0) / completedCount)
    : 0;

  const stats = [
    { label: 'Enrolled Subjects', value: enrolledCount },
    { label: 'Upcoming Exams', value: upcomingCount },
    { label: 'Completed Exams', value: completedCount },
    { label: 'Average Score', value: `${avgScore}%` },
  ];

  return (
    <div>
      <PageHeader title="Student Dashboard" description="Your courses and upcoming assessments" />

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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">Upcoming Assessments</h2>
          {deployments && deployments.length > 0 ? (
            <div className="space-y-3">
              {deployments.map((d: Record<string, unknown>) => {
                const assessment = (d.assessment_version as Record<string, unknown>)?.assessment as Record<string, unknown> | undefined;
                const opensAt = new Date(d.opens_at as string);
                const closesAt = new Date(d.closes_at as string);
                const now = new Date();
                const timeUntilOpen = opensAt > now
                  ? `Opens ${opensAt.toLocaleDateString()} ${opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : `Closes ${closesAt.toLocaleDateString()} ${closesAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

                return (
                  <Card key={d.id as string}>
                    <CardContent className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-[var(--color-foreground)]">
                          {(assessment?.title as string) ?? 'Untitled Assessment'}
                        </p>
                        <p className="text-sm text-[var(--color-muted)]">{timeUntilOpen}</p>
                      </div>
                      <Badge variant="info">Active</Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No upcoming assessments"
              description="When assessments are published, they will appear here."
            />
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Notifications</h2>
            <Link href="/notifications" className="text-sm font-medium text-[var(--color-primary)] hover:underline">
              View all
            </Link>
          </div>
          {notifications && notifications.length > 0 ? (
            <div className="space-y-3">
              {notifications.map((n) => {
                const data = (n.data ?? null) as Record<string, unknown> | null;
                const assessmentId = typeof data?.assessment_id === 'string' ? data.assessment_id : null;
                const href = assessmentId
                  ? typeof data?.attempt_id === 'string'
                    ? `/student/assessments/${assessmentId}/exam/${data.attempt_id}/results`
                    : `/student/assessments/${assessmentId}`
                  : '/notifications';

                return (
                  <Card key={n.id} className={!n.read_at ? 'border-l-4 border-l-[var(--color-primary)]' : ''}>
                    <CardContent className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-[var(--color-foreground)]">{n.title}</p>
                          <Badge variant={n.type === 'result_released' || n.type === 'submission_confirmed' ? 'success' : n.type === 'assessment_closed' || n.type === 'reminder' ? 'warning' : 'info'}>
                            {n.type.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <p className="text-sm text-[var(--color-muted)] mt-1">{n.body}</p>
                        <p className="text-xs text-[var(--color-muted-light)] mt-1">
                          {new Date(n.created_at).toLocaleString()}
                        </p>
                        <Link href={href} className="mt-2 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline">
                          View
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No notifications"
              description="Exam schedules, releases, and other updates will appear here."
            />
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">Recent Results</h2>
          {results && results.length > 0 ? (
            <div className="space-y-3">
              {results.map((r: Record<string, unknown>) => {
                const deployment = r.deployment as Record<string, unknown> | undefined;
                const assessmentVersion = deployment?.assessment_version as Record<string, unknown> | undefined;
                const assessment = assessmentVersion?.assessment as Record<string, unknown> | undefined;
                return (
                  <Card key={r.id as string}>
                    <CardContent className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-[var(--color-foreground)]">
                          {(assessment?.title as string) ?? 'Untitled'}
                        </p>
                        <p className="text-sm text-[var(--color-muted)]">
                          Score: {r.raw_score as number}/{r.possible_score as number} ({Math.round(r.percentage as number)}%)
                        </p>
                      </div>
                      <Badge variant={(r.percentage as number) >= 75 ? 'success' : (r.percentage as number) >= 50 ? 'warning' : 'danger'}>
                        {Math.round(r.percentage as number)}%
                      </Badge>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No results yet"
              description="Your exam results will appear here once released."
            />
          )}
        </div>
      </div>
    </div>
  );
}
