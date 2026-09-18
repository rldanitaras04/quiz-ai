import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Link from 'next/link';

export default async function StudentDashboardPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('id, status, subject_offering:subject_offerings(id, subject:subjects(id, code, title), section:sections(id, name))')
    .eq('student_id', user.id)
    .eq('status', 'enrolled');

  const { data: deployments } = await supabase
    .from('assessment_deployments')
    .select('id, opens_at, closes_at, status, assessment_version:assessment_versions(id, assessment:assessments(id, title))')
    .in('subject_offering_id', (enrollments ?? []).map((e: any) => e.subject_offering?.id).filter(Boolean))
    .eq('status', 'active')
    .gte('closes_at', new Date().toISOString())
    .order('opens_at', { ascending: true })
    .limit(5);

  const { data: results } = await supabase
    .from('assessment_results')
    .select('id, raw_score, possible_score, percentage, status, released_at, deployment:assessment_deployments(id, assessment_version:assessment_versions(id, assessment:assessments(id, title)))')
    .eq('student_id', user.id)
    .eq('status', 'released')
    .order('released_at', { ascending: false })
    .limit(5);

  const enrolledCount = enrollments?.length ?? 0;
  const upcomingCount = deployments?.length ?? 0;
  const completedCount = results?.length ?? 0;
  const avgScore = completedCount > 0
    ? Math.round((results ?? []).reduce((sum: number, r: any) => sum + (r.percentage ?? 0), 0) / completedCount)
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
              {deployments.map((d: any) => {
                const assessment = d.assessment_version?.assessment;
                const opensAt = new Date(d.opens_at);
                const closesAt = new Date(d.closes_at);
                const now = new Date();
                const timeUntilOpen = opensAt > now
                  ? `Opens ${opensAt.toLocaleDateString()} ${opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : `Closes ${closesAt.toLocaleDateString()} ${closesAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

                return (
                  <Card key={d.id}>
                    <CardContent className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-[var(--color-foreground)]">
                          {assessment?.title ?? 'Untitled Assessment'}
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
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">Recent Results</h2>
          {results && results.length > 0 ? (
            <div className="space-y-3">
              {results.map((r: any) => {
                const assessment = r.deployment?.assessment_version?.assessment;
                return (
                  <Card key={r.id}>
                    <CardContent className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-[var(--color-foreground)]">
                          {assessment?.title ?? 'Untitled'}
                        </p>
                        <p className="text-sm text-[var(--color-muted)]">
                          Score: {r.raw_score}/{r.possible_score} ({Math.round(r.percentage)}%)
                        </p>
                      </div>
                      <Badge variant={r.percentage >= 75 ? 'success' : r.percentage >= 50 ? 'warning' : 'danger'}>
                        {Math.round(r.percentage)}%
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
