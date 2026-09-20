import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';

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
        <Card>
          <Table caption="Subject offerings you are enrolled in">
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Subject</TH>
                <TH>Section</TH>
                <TH>Program / Year</TH>
                <TH>Term</TH>
                <TH>Instructor</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {enrollments.map((e) => {
                const offering = e.subject_offering as unknown as Record<string, unknown> | undefined;
                const subject = offering?.subject as Record<string, unknown> | undefined;
                const section = offering?.section as Record<string, unknown> | undefined;
                const semester = offering?.semester as Record<string, unknown> | undefined;
                const facultyAssignments = offering?.faculty_assignments as
                  | Array<Record<string, unknown>>
                  | undefined;
                const faculty = facultyAssignments?.[0]?.faculty as
                  | Record<string, unknown>
                  | undefined;
                const program = section?.program as Record<string, unknown> | undefined;
                const yearLevel = section?.year_level as Record<string, unknown> | undefined;
                const academicYear = semester?.academic_year as
                  | Record<string, unknown>
                  | undefined;

                return (
                  <TR key={e.id as string} className="hover:bg-[var(--color-surface-hover)]">
                    <TD className="font-mono text-xs text-[var(--color-muted)]">
                      {(subject?.code as string) ?? '—'}
                    </TD>
                    <TD className="font-medium text-[var(--color-foreground)]">
                      {(subject?.title as string) ?? '—'}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {(section?.name as string) ?? '—'}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {(program?.code as string) ?? '—'}
                      {yearLevel?.name ? ` · ${yearLevel.name as string}` : ''}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {(semester?.name as string) ?? '—'}
                      {academicYear?.name ? ` (${academicYear.name as string})` : ''}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {(faculty?.full_name as string) ?? 'Unassigned'}
                    </TD>
                    <TD>
                      <Badge variant={offering?.status === 'active' ? 'success' : 'default'}>
                        {(offering?.status as string) ?? 'unknown'}
                      </Badge>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No enrolled subjects"
          description="You are not currently enrolled in any subject offerings."
        />
      )}
    </div>
  );
}
