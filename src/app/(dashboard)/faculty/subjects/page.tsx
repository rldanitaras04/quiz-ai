import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';

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

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects' },
        ]}
        title="My Subjects"
        description="Subject offerings you are assigned to"
      />

      {assignmentRows.length > 0 ? (
        <Card>
          <Table caption="Subject offerings you are assigned to">
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Subject</TH>
                <TH>Section</TH>
                <TH>Program / Year</TH>
                <TH>Term</TH>
                <TH align="right">Enrolled</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {assignmentRows.map((a) => {
                const offering = a.subject_offering;
                const subject = offering?.subject;
                const section = offering?.section;
                const semester = offering?.semester;
                const studentCount = offering ? enrollmentCounts[offering.id] ?? 0 : 0;

                return (
                  <TR key={a.id} className="hover:bg-[var(--color-surface-hover)]">
                    <TD className="font-mono text-xs text-[var(--color-muted)]">
                      {subject?.code ?? '—'}
                    </TD>
                    <TD>
                      <Link
                        href={`/faculty/subjects/${offering?.id}`}
                        className="font-medium text-[var(--color-primary)] hover:underline"
                      >
                        {subject?.title ?? 'Untitled offering'}
                      </Link>
                    </TD>
                    <TD className="text-[var(--color-muted)]">{section?.name ?? '—'}</TD>
                    <TD className="text-[var(--color-muted)]">
                      {section?.program?.code ?? '—'}
                      {section?.year_level?.name ? ` · ${section.year_level.name}` : ''}
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {semester?.name ?? '—'}
                      {semester?.academic_year?.name ? ` (${semester.academic_year.name})` : ''}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {studentCount}
                    </TD>
                    <TD>
                      <Badge variant={offering?.status === 'active' ? 'success' : 'default'}>
                        {offering?.status ?? 'unknown'}
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
          title="No subjects assigned"
          description="You have not been assigned to any subject offerings yet."
        />
      )}
    </div>
  );
}
