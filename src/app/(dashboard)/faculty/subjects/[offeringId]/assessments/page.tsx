import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { ASSESSMENT_STATUS_LABELS } from '@/lib/constants';
import Link from 'next/link';

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
      current_version:assessment_versions(id, total_items, total_points)
    `)
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  const statusVariant = (status: string): 'success' | 'warning' | 'info' | 'default' => {
    switch (status) {
      case 'published': return 'success';
      case 'approved': return 'info';
      case 'draft': return 'warning';
      default: return 'default';
    }
  };

  return (
    <div>
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

      {assessments && assessments.length > 0 ? (
        <Card>
          <Table caption="Assessments for this offering">
            <THead>
              <TR>
                <TH>Assessment</TH>
                <TH>Type</TH>
                <TH align="right">Items</TH>
                <TH align="right">Points</TH>
                <TH>Created</TH>
                <TH>Status</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {(assessments as unknown as AssessmentRow[]).map((a) => {
                const version = a.current_version;
                return (
                  <TR key={a.id} className="hover:bg-[var(--color-surface-hover)]">
                    <TD className="font-medium">
                      <Link
                        href={`/faculty/subjects/${offeringId}/assessments/${a.id}`}
                        className="text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
                      >
                        {a.title}
                      </Link>
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {a.assessment_type === 'multiple_choice' ? 'Multiple Choice' : 'Identification'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {version?.total_items ?? '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {version?.total_points ?? '—'}
                    </TD>
                    <TD className="text-xs text-[var(--color-muted)]">
                      {new Date(a.created_at).toLocaleDateString()}
                    </TD>
                    <TD>
                      <Badge variant={statusVariant(a.status)}>
                        {ASSESSMENT_STATUS_LABELS[a.status as keyof typeof ASSESSMENT_STATUS_LABELS] ?? a.status}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      <Link
                        href={`/faculty/subjects/${offeringId}/assessments/${a.id}`}
                        className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                      >
                        Review
                      </Link>
                      <span className="mx-2 text-[var(--color-border)]">|</span>
                      <Link
                        href={`/faculty/subjects/${offeringId}/assessments/${a.id}/deploy`}
                        className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                      >
                        Deploy
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No assessments yet"
          description="Create your first assessment with the button above."
        />
      )}
    </div>
  );
}
