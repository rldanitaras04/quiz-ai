import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import Link from 'next/link';

interface FacultyOffering {
  id: string;
  status: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
  semester: {
    id: string;
    name: string;
    academic_year: { id: string; name: string } | null;
  } | null;
}

interface FacultyAssignmentRow {
  id: string;
  subject_offering: FacultyOffering | null;
}

export default async function FacultyDashboardPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: assignments } = await supabase
    .from('faculty_assignments')
    .select('id, subject_offering:subject_offerings(id, subject:subjects(id, code, title), section:sections(id, name), semester:semesters(id, name, academic_year:academic_years(id, name)), status)')
    .eq('faculty_id', user.id);

  const assignmentRows = (assignments ?? []) as unknown as FacultyAssignmentRow[];

  const offeringIds = assignmentRows
    .map((a) => a.subject_offering?.id)
    .filter((id): id is string => Boolean(id));

  const [enrollmentsCount, assessmentsCount, deploymentsCount] = await Promise.all([
    offeringIds.length > 0
      ? supabase.from('enrollments').select('id', { count: 'exact', head: true })
          .in('subject_offering_id', offeringIds)
          .eq('status', 'enrolled')
      : { count: 0 },
    offeringIds.length > 0
      ? supabase.from('assessments').select('id', { count: 'exact', head: true })
          .in('subject_offering_id', offeringIds)
      : { count: 0 },
    offeringIds.length > 0
      ? supabase.from('assessment_deployments').select('id', { count: 'exact', head: true })
          .in('subject_offering_id', offeringIds)
          .eq('status', 'active')
      : { count: 0 },
  ]);

  const totalSubjects = assignmentRows.length;
  const totalStudents = enrollmentsCount.count ?? 0;
  const totalAssessments = assessmentsCount.count ?? 0;
  const activeDeployments = deploymentsCount.count ?? 0;

  const stats = [
    { label: 'My Subjects', value: totalSubjects },
    { label: 'Total Students', value: totalStudents },
    { label: 'Assessments', value: totalAssessments },
    { label: 'Active Deployments', value: activeDeployments },
  ];

  return (
    <div>
      <PageHeader
        title="Faculty Dashboard"
        description="Manage your subjects and assessments"
        actions={
          <div className="flex gap-2">
            <Link href="/faculty/subjects">
              <Button variant="secondary">My Subjects</Button>
            </Link>
          </div>
        }
      />

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
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">My Subjects</h2>
          {assignmentRows.length > 0 ? (
            <div className="space-y-3">
              {assignmentRows.slice(0, 5).map((a) => {
                const offering = a.subject_offering;
                const subject = offering?.subject;
                return (
                  <Link key={a.id} href={`/faculty/subjects/${offering?.id}`}>
                    <Card className="hover:shadow-md transition-shadow cursor-pointer">
                      <CardContent className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-[var(--color-foreground)]">
                            {subject?.code} - {subject?.title}
                          </p>
                          <p className="text-sm text-[var(--color-muted)]">
                            {offering?.section?.name} | {offering?.semester?.name} {offering?.semester?.academic_year?.name}
                          </p>
                        </div>
                        <Badge variant={offering?.status === 'active' ? 'success' : 'default'}>
                          {offering?.status}
                        </Badge>
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No subjects assigned"
              description="Contact your administrator to get assigned to subjects."
            />
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link href="/faculty/subjects">
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="flex items-center gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[var(--color-primary-light)] flex items-center justify-center">
                    <svg className="w-5 h-5 text-[var(--color-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-[var(--color-foreground)]">View Subjects</p>
                    <p className="text-sm text-[var(--color-muted)]">Manage your assigned subjects</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
