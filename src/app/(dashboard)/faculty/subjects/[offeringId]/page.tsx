import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Link from 'next/link';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingDetail {
  id: string;
  status: string;
  subject: { id: string; code: string; title: string; description: string | null } | null;
  semester: {
    id: string;
    name: string;
    academic_year: {
      id: string;
      name: string;
      starts_on: string;
      ends_on: string;
    } | null;
  } | null;
  section: {
    id: string;
    name: string;
    program: { id: string; code: string; name: string } | null;
    year_level: { id: string; name: string } | null;
  } | null;
  faculty_assignments: Array<{
    id: string;
    faculty: { id: string; full_name: string; email: string | null } | null;
  }>;
}

export default async function SubjectOfferingDetailPage({ params }: Props) {
  const { offeringId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select(`
      id,
      status,
      subject:subjects(id, code, title, description),
      semester:semesters(id, name, academic_year:academic_years(id, name, starts_on, ends_on)),
      section:sections(id, name, program:programs(id, code, name), year_level:year_levels(id, name)),
      faculty_assignments:faculty_assignments(id, faculty:profiles(id, full_name, email))
    `)
    .eq('id', offeringId)
    .single();

  if (!offering) redirect('/faculty/subjects');

  const o = offering as unknown as OfferingDetail;

  const [enrollmentsCount, assessmentsCount, sourcesCount] = await Promise.all([
    supabase.from('enrollments').select('id', { count: 'exact', head: true })
      .eq('subject_offering_id', offeringId).eq('status', 'enrolled'),
    supabase.from('assessments').select('id', { count: 'exact', head: true })
      .eq('subject_offering_id', offeringId),
    supabase.from('source_materials').select('id', { count: 'exact', head: true })
      .eq('subject_offering_id', offeringId),
  ]);

  const subject = o.subject;
  const section = o.section;
  const semester = o.semester;

  const tabs = [
    { label: 'Overview', href: `/faculty/subjects/${offeringId}` },
    { label: 'Students', href: `/faculty/subjects/${offeringId}/students` },
    { label: 'Assessments', href: `/faculty/subjects/${offeringId}/assessments` },
    { label: 'Source Materials', href: `/faculty/subjects/${offeringId}/sources` },
    { label: 'Deployments', href: `/faculty/subjects/${offeringId}/deployments` },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${subject?.code} - ${subject?.title}` },
        ]}
        title={`${subject?.code} - ${subject?.title}`}
        description={`${section?.name} | ${semester?.name} ${semester?.academic_year?.name}`}
      />

      <nav className="flex gap-1 mb-6 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab.href === `/faculty/subjects/${offeringId}`
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border)]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Enrolled Students</p>
            <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{enrollmentsCount.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Assessments</p>
            <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{assessmentsCount.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Source Materials</p>
            <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{sourcesCount.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Status</p>
            <div className="mt-1">
              <Badge variant={o.status === 'active' ? 'success' : 'default'}>
                {o.status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--color-foreground)]">Subject Information</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-[var(--color-muted)]">Description</p>
              <p className="text-[var(--color-foreground)]">{subject?.description || 'No description available.'}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Program</p>
              <p className="text-[var(--color-foreground)]">{section?.program?.code} - {section?.program?.name}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Year Level</p>
              <p className="text-[var(--color-foreground)]">{section?.year_level?.name}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Academic Year</p>
              <p className="text-[var(--color-foreground)]">
                {semester?.academic_year?.name} ({new Date(semester?.academic_year?.starts_on ?? '').toLocaleDateString()} - {new Date(semester?.academic_year?.ends_on ?? '').toLocaleDateString()})
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--color-foreground)]">Assigned Faculty</h3>
          </CardHeader>
          <CardContent>
            {o.faculty_assignments && o.faculty_assignments.length > 0 ? (
              <ul className="space-y-3">
                {o.faculty_assignments.map((fa) => (
                  <li key={fa.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center">
                      <span className="text-sm font-medium text-[var(--color-muted)]">
                        {fa.faculty?.full_name?.charAt(0) ?? '?'}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{fa.faculty?.full_name}</p>
                      <p className="text-xs text-[var(--color-muted)]">{fa.faculty?.email}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">No faculty assigned.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
