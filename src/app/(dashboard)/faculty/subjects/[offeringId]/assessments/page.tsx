import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import AssessmentsTable from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/AssessmentsTable';
import type { AssessmentListRow } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/AssessmentsTable';
import WorkspaceNavSetter from '@/components/layout/WorkspaceNavSetter';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingHeading {
  id: string;
  subject_id: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
}

interface AssessmentRow {
  id: string;
  title: string;
  assessment_type: string;
  status: string;
  created_at: string;
  current_version: { id: string; total_items: number; total_points: number } | null;
}

export default async function AssessmentsPage({ params }: Props) {
  const { offeringId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('id, subject_id, subject:subjects(id, code, title), section:sections(id, name)')
    .eq('id', offeringId)
    .single();

  if (!offering) redirect('/faculty/subjects');

  const o = offering as unknown as OfferingHeading;

  const { data: assessments } = await supabase
    .from('assessments')
    .select(`
      id,
      title,
      assessment_type,
      status,
      created_at,
      current_version:assessment_versions!assessments_current_version_id_fkey(id, total_items, total_points)
    `)
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  const listRows: AssessmentListRow[] = ((assessments ?? []) as unknown as AssessmentRow[]).map((a) => ({
    id: a.id,
    title: a.title,
    assessment_type: a.assessment_type,
    status: a.status,
    created_at: a.created_at,
    total_items: a.current_version?.total_items ?? null,
    total_points: a.current_version?.total_points ?? null,
    review_href: `/faculty/subjects/${offeringId}/assessments/${a.id}`,
    deploy_href: `/faculty/subjects/${offeringId}/assessments/${a.id}/deploy`,
    show_deploy: true,
  }));

  return (
    <div>
      <WorkspaceNavSetter
        offeringId={offeringId}
        currentPath={`/faculty/subjects/${offeringId}/assessments`}
      />
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o.subject?.code} - ${o.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Assessments' },
        ]}
        title="Assessments"
        description={`${o.subject?.code} - ${o.section?.name}`}
        actions={
          <Link href={`/faculty/subjects/${offeringId}/assessments/new`}>
            <Button variant="primary">New Assessment</Button>
          </Link>
        }
      />

      {listRows.length > 0 ? (
        <AssessmentsTable rows={listRows} />
      ) : (
        <EmptyState
          title="No assessments yet"
          description="Create your first assessment with the button above."
        />
      )}
    </div>
  );
}
