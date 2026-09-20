import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import CancelDeploymentButton from './CancelDeploymentButton';
import ReleaseResultsButton from './ReleaseResultsButton';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingHeading {
  id: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
}

interface DeploymentRow {
  id: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempt_limit: number;
  status: string;
  created_at: string;
  assessment: { id: string; title: string } | null;
  assessment_version: {
    id: string;
    version_number: number;
    total_items: number;
    total_points: number;
  } | null;
}

function deploymentVariant(status: string): 'success' | 'warning' | 'info' | 'default' {
  switch (status) {
    case 'active': return 'success';
    case 'scheduled': return 'info';
    case 'closed': return 'default';
    default: return 'warning';
  }
}

export default async function DeploymentsPage({ params }: Props) {
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

  const { data: deployments } = await supabase
    .from('assessment_deployments')
    .select(`
      id,
      opens_at,
      closes_at,
      duration_minutes,
      attempt_limit,
      status,
      created_at,
      assessment:assessments(id, title),
      assessment_version:assessment_versions(id, version_number, total_items, total_points)
    `)
    .eq('subject_offering_id', offeringId)
    .order('opens_at', { ascending: false });

  const list = (deployments ?? []) as unknown as DeploymentRow[];

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o.subject?.code} - ${o.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Deployments' },
        ]}
        title="Deployments"
        description={`${o.subject?.code} - ${o.section?.name}`}
      />

      {list.length > 0 ? (
        <Card>
          <Table caption="Assessment deployments for this offering">
            <THead>
              <TR>
                <TH>Assessment</TH>
                <TH>Version</TH>
                <TH align="right">Items</TH>
                <TH align="right">Points</TH>
                <TH align="right">Duration</TH>
                <TH align="right">Attempts</TH>
                <TH>Window</TH>
                <TH>Status</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((d) => {
                const assessment = d.assessment;
                const version = d.assessment_version;
                const opensAt = new Date(d.opens_at);
                const closesAt = new Date(d.closes_at);

                return (
                  <TR key={d.id} className="hover:bg-[var(--color-surface-hover)] align-top">
                    <TD className="font-medium text-[var(--color-foreground)]">
                      {assessment?.title ?? 'Untitled Assessment'}
                    </TD>
                    <TD className="text-[var(--color-muted)] tabular-nums">
                      {version ? `v${version.version_number}` : '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {version?.total_items ?? '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {version?.total_points ?? '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-muted)]">
                      {d.duration_minutes} min
                    </TD>
                    <TD numeric className="text-[var(--color-muted)]">
                      {d.attempt_limit}
                    </TD>
                    <TD className="text-xs text-[var(--color-muted)]">
                      {opensAt.toLocaleString()}
                      <span className="block">→ {closesAt.toLocaleString()}</span>
                    </TD>
                    <TD>
                      <Badge variant={deploymentVariant(d.status)}>{d.status}</Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1">
                        {(d.status === 'scheduled' || d.status === 'active') && (
                          <CancelDeploymentButton deploymentId={d.id} />
                        )}
                        {(d.status === 'active' || d.status === 'closed') && (
                          <ReleaseResultsButton deploymentId={d.id} />
                        )}
                        {d.status !== 'scheduled' &&
                          d.status !== 'active' &&
                          d.status !== 'closed' && (
                            <span className="text-xs text-[var(--color-muted)]">—</span>
                          )}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No deployments yet"
          description="Deploy an approved assessment to make it available to students."
        />
      )}
    </div>
  );
}
