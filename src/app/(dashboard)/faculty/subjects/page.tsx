import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Link from 'next/link';

interface SubjectOfferingSummary {
  id: string;
  status: string;
  subject: { id: string; code: string; title: string } | null;
  semester: { id: string; name: string; academic_year: { id: string; name: string } | null } | null;
  section: {
    id: string;
    name: string;
    program: { id: string; code: string; name: string } | null;
    year_level: { id: string; name: string } | null;
  } | null;
}

interface AssignmentRow {
  id: string;
  subject_offering: SubjectOfferingSummary | null;
}

export default async function FacultySubjectsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: assignments } = await supabase
    .from('faculty_assignments')
    .select(`
      id,
      subject_offering:subject_offerings(
        id,
        status,
        subject:subjects(id, code, title),
        semester:semesters(id, name, academic_year:academic_years(id, name)),
        section:sections(id, name, program:programs(id, code, name), year_level:year_levels(id, name))
      )
    `)
    .eq('faculty_id', user.id);

  const assignmentRows = (assignments ?? []) as unknown as AssignmentRow[];

  const offeringIds = assignmentRows
    .map((a) => a.subject_offering?.id)
    .filter((id): id is string => Boolean(id));

  const enrollmentCounts: Record<string, number> = {};
  if (offeringIds.length > 0) {
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('subject_offering_id')
      .in('subject_offering_id', offeringIds)
      .eq('status', 'enrolled');

    (enrollments ?? []).forEach((e: { subject_offering_id: string }) => {
      enrollmentCounts[e.subject_offering_id] = (enrollmentCounts[e.subject_offering_id] ?? 0) + 1;
    });
  }

  const breadcrumbs = [
    { label: 'Faculty', href: '/faculty' },
    { label: 'My Subjects' },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={breadcrumbs}
        title="My Subjects"
        description="Subject offerings you are assigned to"
      />

      {assignmentRows.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {assignmentRows.map((a) => {
            const offering = a.subject_offering;
            const subject = offering?.subject;
            const section = offering?.section;
            const semester = offering?.semester;
            const studentCount = offering ? enrollmentCounts[offering.id] ?? 0 : 0;

            return (
              <Link key={a.id} href={`/faculty/subjects/${offering?.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardContent className="flex flex-col h-full">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-mono text-xs text-[var(--color-muted)]">{subject?.code}</p>
                        <h3 className="font-semibold text-[var(--color-foreground)]">{subject?.title}</h3>
                      </div>
                      <Badge variant={offering?.status === 'active' ? 'success' : 'default'}>
                        {offering?.status}
                      </Badge>
                    </div>

                    <div className="mt-auto space-y-1 text-sm text-[var(--color-muted)]">
                      <p>Section: {section?.name}</p>
                      <p>{section?.program?.code} - {section?.year_level?.name}</p>
                      <p>{semester?.name} {semester?.academic_year?.name}</p>
                      <p className="font-medium text-[var(--color-foreground)]">
                        {studentCount} enrolled student{studentCount !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No subjects assigned"
          description="You have not been assigned to any subject offerings yet."
        />
      )}
    </div>
  );
}
