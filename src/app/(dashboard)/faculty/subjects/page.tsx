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

interface SubjectGroup {
  subjectId: string;
  code: string;
  title: string;
  offerings: {
    offeringId: string;
    sectionName: string;
    programCode: string;
    yearLevel: string;
    term: string;
    enrolled: number;
    status: string;
  }[];
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

  // Group by subject
  const subjectMap = new Map<string, SubjectGroup>();
  for (const assignment of assignmentRows) {
    const offering = assignment.subject_offering;
    if (!offering?.subject) continue;

    const subjectId = offering.subject.id;
    if (!subjectMap.has(subjectId)) {
      subjectMap.set(subjectId, {
        subjectId,
        code: offering.subject.code,
        title: offering.subject.title,
        offerings: [],
      });
    }

    const group = subjectMap.get(subjectId)!;
    group.offerings.push({
      offeringId: offering.id,
      sectionName: offering.section?.name ?? '—',
      programCode: offering.section?.program?.code ?? '—',
      yearLevel: offering.section?.year_level?.name ?? '—',
      term: offering.semester?.name ?? '—',
      enrolled: 0,
      status: offering.status,
    });
  }

  // Get enrollment counts
  const allOfferingIds = assignmentRows
    .map((a) => a.subject_offering?.id)
    .filter((id): id is string => Boolean(id));

  if (allOfferingIds.length > 0) {
    const { data: enrollments } = await supabase
      .from('enrollments')
      .select('subject_offering_id')
      .in('subject_offering_id', allOfferingIds)
      .eq('status', 'enrolled');

    const enrollmentCounts: Record<string, number> = {};
    (enrollments ?? []).forEach((e: { subject_offering_id: string }) => {
      enrollmentCounts[e.subject_offering_id] = (enrollmentCounts[e.subject_offering_id] ?? 0) + 1;
    });

    // Update enrollment counts in groups
    for (const group of subjectMap.values()) {
      for (const offering of group.offerings) {
        offering.enrolled = enrollmentCounts[offering.offeringId] ?? 0;
      }
    }
  }

  const subjects = Array.from(subjectMap.values());

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

      {subjects.length > 0 ? (
        <div className="space-y-4">
          {subjects.map((subject) => (
            <Card key={subject.subjectId}>
              <div className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Link
                    href={`/faculty/subjects/subject/${subject.subjectId}`}
                    className="text-lg font-semibold text-[var(--color-primary)] hover:underline"
                  >
                    {subject.code} - {subject.title}
                  </Link>
                  <Badge variant="info">
                    {subject.offerings.length} section{subject.offerings.length !== 1 ? 's' : ''}
                  </Badge>
                </div>

                <Table caption={`Sections for ${subject.code}`}>
                  <THead>
                    <TR>
                      <TH>Section</TH>
                      <TH>Program / Year</TH>
                      <TH>Term</TH>
                      <TH align="right">Enrolled</TH>
                      <TH>Status</TH>
                      <TH align="right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {subject.offerings.map((offering) => (
                      <TR key={offering.offeringId}>
                        <TD className="font-medium text-[var(--color-foreground)]">
                          {offering.sectionName}
                        </TD>
                        <TD className="text-[var(--color-muted)]">
                          {offering.programCode} · {offering.yearLevel}
                        </TD>
                        <TD className="text-[var(--color-muted)]">
                          {offering.term}
                        </TD>
                        <TD numeric className="text-[var(--color-foreground)]">
                          {offering.enrolled}
                        </TD>
                        <TD>
                          <Badge variant={offering.status === 'active' ? 'success' : 'default'}>
                            {offering.status}
                          </Badge>
                        </TD>
                        <TD className="whitespace-nowrap text-right">
                          <Link
                            href={`/faculty/subjects/${offering.offeringId}`}
                            className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                          >
                            Manage
                          </Link>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </div>
            </Card>
          ))}
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
