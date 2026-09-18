import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import AddStudentButton from './AddStudentButton';

interface Props {
  params: Promise<{ offeringId: string }>;
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

  const o = offering as any;

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select(`
      id,
      status,
      enrolled_at,
      student:profiles(id, full_name, email, student_profiles(student_number))
    `)
    .eq('subject_offering_id', offeringId)
    .order('enrolled_at', { ascending: true });

  const activeEnrollments = (enrollments ?? []).filter((e: any) => e.status === 'enrolled');

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o.subject?.code} - ${o.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Students' },
        ]}
        title="Student Enrollment"
        description={`${o.subject?.code} - ${o.section?.name}`}
        actions={<AddStudentButton offeringId={offeringId} />}
      />

      {activeEnrollments.length > 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {activeEnrollments.map((e: any) => {
                  const studentProfile = e.student?.student_profiles;
                  const studentNumber = Array.isArray(studentProfile) && studentProfile.length > 0
                    ? studentProfile[0].student_number
                    : 'N/A';

                  return (
                    <tr key={e.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-hover)]">
                      <td className="px-6 py-3 font-mono text-[var(--color-foreground)]">{studentNumber}</td>
                      <td className="px-6 py-3 text-[var(--color-foreground)]">{e.student?.full_name}</td>
                      <td className="px-6 py-3 text-[var(--color-muted)]">{e.student?.email}</td>
                      <td className="px-6 py-3">
                        <Badge variant="success">Enrolled</Badge>
                      </td>
                      <td className="px-6 py-3 text-[var(--color-muted)]">
                        {new Date(e.enrolled_at).toLocaleDateString()}
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
          description="Students will appear here once they enroll in this offering."
        />
      )}
    </div>
  );
}
