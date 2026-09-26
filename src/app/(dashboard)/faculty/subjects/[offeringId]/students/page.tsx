import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import WorkspaceNavSetter from '@/components/layout/WorkspaceNavSetter';
import AddStudentButton from './AddStudentButton';
import EnrollBulkButton from './EnrollBulkButton';
import EnrollmentTable, { type RosterRow } from './EnrollmentTable';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingHeading {
  id: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
}

interface EnrollmentRow {
  id: string;
  student_id: string;
  status: string;
  enrolled_at: string;
  student: {
    student_number: string | null;
    profiles:
      | { id: string; full_name: string | null; email: string | null }
      | { id: string; full_name: string | null; email: string | null }[]
      | null;
  } | null;
}

function studentDisplay(student: EnrollmentRow['student']): { number: string; name: string; email: string | null } {
  const profileRaw = student?.profiles ?? null;
  const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
  return {
    number: student?.student_number || 'N/A',
    name: profile?.full_name || '(unknown)',
    email: profile?.email ?? null,
  };
}

export default async function StudentsPage({ params }: Props) {
  const { offeringId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('id, subject:subjects(id, code, title), section:sections(id, name)')
    .eq('id', offeringId)
    .single();

  if (!offering) redirect('/faculty/subjects');

  const o = offering as unknown as OfferingHeading;

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(`
      id,
      student_id,
      status,
      enrolled_at,
      student:student_profiles(student_number, profiles(id, full_name, email))
    `)
    .eq('subject_offering_id', offeringId)
    .order('enrolled_at', { ascending: true });

  // Withdrawn / dropped / completed rows stay visible so faculty can see why a
  // student disappeared and restore them with Re-enroll.
  const rows = ((enrollments ?? []) as unknown as EnrollmentRow[]);
  const activeCount = rows.filter((e) => e.status === 'enrolled').length;

  const roster: RosterRow[] = rows.map((e) => {
    const display = studentDisplay(e.student);
    return {
      id: e.id,
      studentId: e.student_id,
      studentNumber: display.number,
      name: display.name,
      email: display.email,
      status: e.status,
      enrolledAt: e.enrolled_at,
    };
  });

  return (
    <div>
      <WorkspaceNavSetter
        offeringId={offeringId}
        currentPath={`/faculty/subjects/${offeringId}/students`}
      />
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o.subject?.code} - ${o.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Students' },
        ]}
        title="Student Enrollment"
        description={`${o.subject?.code} - ${o.section?.name} · ${activeCount} enrolled${
          rows.length > activeCount ? ` · ${rows.length - activeCount} inactive` : ''
        }`}
        actions={
          <>
            <EnrollBulkButton
              offeringId={offeringId}
              sectionName={o.section?.name ?? 'this section'}
            />
            <AddStudentButton offeringId={offeringId} />
          </>
        }
      />

      {roster.length > 0 ? (
        <Card>
          <EnrollmentTable offeringId={offeringId} rows={roster} />
        </Card>
      ) : (
        <EmptyState
          title="No students enrolled"
          description="Add students by student number, paste a list in bulk, or enroll everyone assigned to this section."
        />
      )}
    </div>
  );
}
