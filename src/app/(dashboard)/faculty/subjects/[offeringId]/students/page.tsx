import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import WorkspaceNavSetter from '@/components/layout/WorkspaceNavSetter';
import AddStudentButton from './AddStudentButton';
import EnrollBulkButton from './EnrollBulkButton';
import RemoveStudentButton from './RemoveStudentButton';
import ReenrollStudentButton from './ReenrollStudentButton';

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

const statusBadge: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default' }> = {
  enrolled: { label: 'Enrolled', variant: 'success' },
  withdrawn: { label: 'Withdrawn', variant: 'warning' },
  dropped: { label: 'Dropped', variant: 'danger' },
  completed: { label: 'Completed', variant: 'info' },
};

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

  // Every status is shown: withdrawn/dropped students stay visible with a
  // re-enroll action instead of silently disappearing from the roster.
  const rows = ((enrollments ?? []) as unknown as EnrollmentRow[]);
  const activeCount = rows.filter((e) => e.status === 'enrolled').length;

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
        description={`${o.subject?.code} - ${o.section?.name} · ${activeCount} enrolled · ${rows.length} total`}
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

      {rows.length > 0 ? (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left px-6 py-3 font-medium text-[var(--color-muted)]">Student Number</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--color-muted)]">Name</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--color-muted)]">Email</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--color-muted)]">Status</th>
                  <th className="text-left px-6 py-3 font-medium text-[var(--color-muted)]">Enrolled</th>
                  <th className="text-right px-6 py-3 font-medium text-[var(--color-muted)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const display = studentDisplay(e.student);
                  const badge = statusBadge[e.status] ?? { label: e.status, variant: 'default' as const };

                  return (
                    <tr
                      key={e.id}
                      className={`border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)] ${
                        e.status !== 'enrolled' ? 'opacity-80' : ''
                      }`}
                    >
                      <td className="px-6 py-3 font-mono text-[var(--color-foreground)]">{display.number}</td>
                      <td className="px-6 py-3 text-[var(--color-foreground)]">{display.name}</td>
                      <td className="px-6 py-3 text-[var(--color-muted)]">{display.email}</td>
                      <td className="px-6 py-3">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </td>
                      <td className="px-6 py-3 text-[var(--color-muted)]">
                        {new Date(e.enrolled_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex justify-end">
                          {e.status === 'enrolled' ? (
                            <RemoveStudentButton
                              offeringId={offeringId}
                              studentId={e.student_id}
                              studentName={display.name}
                            />
                          ) : (
                            <ReenrollStudentButton
                              offeringId={offeringId}
                              studentId={e.student_id}
                              studentName={display.name}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
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
