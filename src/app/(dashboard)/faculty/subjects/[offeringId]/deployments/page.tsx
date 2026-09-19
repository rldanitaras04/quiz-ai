import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
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
        <div className="space-y-3">
          {list.map((d) => {
            const assessment = d.assessment;
            const version = d.assessment_version;
            const opensAt = new Date(d.opens_at);
            const closesAt = new Date(d.closes_at);

            return (
              <Card key={d.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-[var(--color-foreground)]">
                      {assessment?.title ?? 'Untitled Assessment'}
                      {version ? ` · v${version.version_number}` : ''}
                    </h3>
                    <p className="text-sm text-[var(--color-muted)]">
                      {version ? `${version.total_items} items, ${version.total_points} pts · ` : ''}
                      {d.duration_minutes} min · {d.attempt_limit} attempt{d.attempt_limit === 1 ? '' : 's'}
                    </p>
                    <p className="text-xs text-[var(--color-muted-light)]">
                      {opensAt.toLocaleString()} — {closesAt.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={deploymentVariant(d.status)}>
                      {d.status}
                    </Badge>
                    {(d.status === 'scheduled' || d.status === 'active') && (
                      <CancelDeploymentButton deploymentId={d.id} />
                    )}
                    {d.status === 'active' || d.status === 'closed' ? (
                      <ReleaseResultsButton deploymentId={d.id} />
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No deployments yet"
          description="Deploy an approved assessment to make it available to students."
        />
      )}
    </div>
  );
}
