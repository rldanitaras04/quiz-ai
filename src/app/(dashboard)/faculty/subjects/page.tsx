import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Link from 'next/link';

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

  const offeringIds = (assignments ?? []).map((a: any) => a.subject_offering?.id).filter(Boolean);

  let enrollmentCounts: Record<string, number> = {};
  if (offeringIds.length > 0) {
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('subject_offering_id')
      .in('subject_offering_id', offeringIds)
      .eq('status', 'enrolled');

    (enrollments ?? []).forEach((e: any) => {
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

      {assignments && assignments.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {assignments.map((a: any) => {
            const offering = a.subject_offering;
            const subject = offering?.subject;
            const section = offering?.section;
            const semester = offering?.semester;
            const studentCount = enrollmentCounts[offering?.id] ?? 0;

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
