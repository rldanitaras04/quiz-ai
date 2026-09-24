import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import ProfileForm from './ProfileForm';
import ProfileNotificationsList from './ProfileNotificationsList';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email, avatar_path')
    .eq('id', user.id)
    .single();

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const role = getPrimaryRole(roles?.map((r) => r.role) ?? []);

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const notificationRows = (notifications ?? []) as unknown as Array<{
    id: string;
    type: string;
    title: string;
    body: string;
    data: Record<string, unknown> | null;
    read_at: string | null;
    created_at: string;
  }>;

  // Role-specific detail rows (null-safe: sections may not exist yet).
  interface StudentDetailRow {
    student_number?: string;
    verification_status?: string;
    program?: { code?: string; name?: string } | null;
    year_level?: { name?: string } | null;
    section?: { name?: string } | null;
  }
  // `faculty_profiles` holds only employee_number today — selecting
  // non-existent columns (department, academic_rank) made this query fail
  // outright, so the faculty card never rendered.
  interface FacultyDetailRow {
    employee_number?: string;
  }
  let studentDetails: StudentDetailRow | null = null;
  let facultyDetails: FacultyDetailRow | null = null;

  if (role === 'student') {
    const { data } = await supabase
      .from('student_profiles')
      .select(`
        student_number,
        verification_status,
        program:programs(id, code, name),
        year_level:year_levels(id, name),
        section:sections(id, name)
      `)
      .eq('user_id', user.id)
      .single();
    studentDetails = (data as StudentDetailRow) ?? null;
  } else if (role === 'faculty') {
    const { data } = await supabase
      .from('faculty_profiles')
      .select('employee_number')
      .eq('user_id', user.id)
      .maybeSingle();
    facultyDetails = (data as FacultyDetailRow) ?? null;
  }

  return (
    <div>
      <PageHeader
        title="My Profile"
        description="View and edit your profile information"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Profile Information</h2>
            </CardHeader>
            <CardContent>
              <ProfileForm
                userId={user.id}
                fullName={profile?.full_name ?? ''}
                avatarPath={profile?.avatar_path ?? null}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {role === 'student' && studentDetails && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Student Details</h2>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-[var(--color-muted)]">Student Number</p>
                  <p className="font-medium">{studentDetails.student_number ?? 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[var(--color-muted)]">Program</p>
                  <p className="font-medium">
                    {studentDetails.program ? `${studentDetails.program.code} - ${studentDetails.program.name}` : 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-[var(--color-muted)]">Year Level</p>
                  <p className="font-medium">{studentDetails.year_level?.name ?? 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[var(--color-muted)]">Section</p>
                  <p className="font-medium">{studentDetails.section?.name ?? 'N/A'}</p>
                </div>
                <div>
                  <p className="text-[var(--color-muted)]">Verification Status</p>
                  <Badge variant={studentDetails.verification_status === 'verified' ? 'success' : 'warning'}>
                    {studentDetails.verification_status ?? 'N/A'}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}

          {role === 'faculty' && facultyDetails && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Faculty Details</h2>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="text-[var(--color-muted)]">Employee Number</p>
                  <p className="font-medium">{facultyDetails.employee_number ?? 'N/A'}</p>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Notifications</h2>
            </CardHeader>
            <CardContent>
              <ProfileNotificationsList notifications={notificationRows} limit={5} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Account</h2>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-[var(--color-muted)]">Email</p>
                <p className="font-medium">{profile?.email ?? user.email}</p>
              </div>
              <div>
                <p className="text-[var(--color-muted)]">Role</p>
                <Badge variant={role === 'super_admin' ? 'danger' : role === 'faculty' ? 'info' : 'success'}>
                  {role}
                </Badge>
              </div>
              <div>
                <p className="text-[var(--color-muted)]">User ID</p>
                <p className="font-mono text-xs break-all">{user.id}</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
