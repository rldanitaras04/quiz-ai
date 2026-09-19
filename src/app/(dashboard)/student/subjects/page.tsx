import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';

export default async function StudentSubjectsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(`
      id,
      status,
      enrolled_at,
      subject_offering:subject_offerings(
        id,
        status,
        subject:subjects(id, code, title),
        semester:semesters(id, name, academic_year:academic_years(id, name)),
        section:sections(id, name, program:programs(id, code, name), year_level:year_levels(id, name)),
        faculty_assignments:faculty_assignments(
          id,
          faculty:profiles(id, full_name)
        )
      )
    `)
    .eq('student_id', user.id)
    .eq('status', 'enrolled')
    .order('enrolled_at', { ascending: false });

  return (
    <div>
      <PageHeader
        title="My Subjects"
        description="Subject offerings you are enrolled in"
      />

      {enrollments && enrollments.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {enrollments.map((e) => {
            const offering = e.subject_offering as unknown as Record<string, unknown> | undefined;
            const subject = offering?.subject as Record<string, unknown> | undefined;
            const section = offering?.section as Record<string, unknown> | undefined;
            const semester = offering?.semester as Record<string, unknown> | undefined;
            const facultyAssignments = offering?.faculty_assignments as Array<Record<string, unknown>> | undefined;
            const faculty = facultyAssignments?.[0]?.faculty as Record<string, unknown> | undefined;

            return (
              <Card key={e.id as string} className="h-full">
                <CardContent className="flex flex-col h-full">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-mono text-xs text-[var(--color-muted)]">{subject?.code as string}</p>
                      <h3 className="font-semibold text-[var(--color-foreground)]">{subject?.title as string}</h3>
                    </div>
                    <Badge variant={offering?.status === 'active' ? 'success' : 'default'}>
                      {offering?.status as string}
                    </Badge>
                  </div>

                  <div className="mt-auto space-y-1 text-sm text-[var(--color-muted)]">
                    <p>Section: {section?.name as string}</p>
                    <p>{(section?.program as Record<string, unknown>)?.code as string} - {(section?.year_level as Record<string, unknown>)?.name as string}</p>
                    <p>{semester?.name as string} {(semester?.academic_year as Record<string, unknown>)?.name as string}</p>
                    {faculty && (
                      <p>Instructor: {faculty.full_name as string}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No enrolled subjects"
          description="You are not currently enrolled in any subject offerings."
        />
      )}
    </div>
  );
}
