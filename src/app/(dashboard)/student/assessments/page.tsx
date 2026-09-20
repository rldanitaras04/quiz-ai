import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Link from 'next/link';

export default async function StudentAssessmentsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('subject_offering_id')
    .eq('student_id', user.id)
    .eq('status', 'enrolled');

  const offeringIds = (enrollments ?? []).map((e: Record<string, unknown>) => e.subject_offering_id as string).filter(Boolean);

  const { data: deployments } = offeringIds.length > 0
    ? await supabase
      .from('assessment_deployments')
      .select(`
        id,
        opens_at,
        closes_at,
        duration_minutes,
        attempt_limit,
        status,
        assessment_version:assessment_versions(
          id,
          total_items,
          total_points,
          assessment:assessments(id, title, assessment_type)
        )
      `)
      .in('subject_offering_id', offeringIds)
      .in('status', ['active', 'scheduled'])
      .order('opens_at', { ascending: true })
    : { data: [] };

  const deploymentIds = (deployments ?? []).map((d: Record<string, unknown>) => d.id as string);

  const { data: attempts } = deploymentIds.length > 0
    ? await supabase
      .from('exam_attempts')
      .select('id, deployment_id, status, attempt_number')
      .eq('student_id', user.id)
      .in('deployment_id', deploymentIds)
    : { data: [] };

  const attemptsByDeployment = new Map<string, Record<string, unknown>[]>();
  (attempts ?? []).forEach((a: Record<string, unknown>) => {
    const list = attemptsByDeployment.get(a.deployment_id as string) ?? [];
    list.push(a);
    attemptsByDeployment.set(a.deployment_id as string, list);
  });

  const now = new Date();

  const getDeploymentStatus = (d: Record<string, unknown>) => {
    const opensAt = new Date(d.opens_at as string);
    const closesAt = new Date(d.closes_at as string);
    const studentAttempts = attemptsByDeployment.get(d.id as string) ?? [];
    const inProgress = studentAttempts.find((a) => a.status === 'in_progress');
    const submittedCount = studentAttempts.filter((a) => ['submitted', 'auto_submitted'].includes(a.status as string)).length;
    const withinWindow = now >= opensAt && now <= closesAt;

    if (inProgress && withinWindow) return { label: 'In Progress', variant: 'warning' as const, attemptId: inProgress.id };
    if (inProgress) return { label: 'Expired', variant: 'danger' as const, attemptId: null };
    if (now < opensAt) return { label: 'Upcoming', variant: 'info' as const, attemptId: null };
    if (now > closesAt) return { label: 'Closed', variant: 'default' as const, attemptId: null };

    if (submittedCount >= (d.attempt_limit as number)) return { label: 'Completed', variant: 'success' as const, attemptId: null };

    // Time window open, no in-progress attempt, attempts remaining → startable.
    return { label: 'Available', variant: 'success' as const, attemptId: null };
  };

  return (
    <div>
      <PageHeader
        title="Assessments"
        description="All assessments from your enrolled subjects"
      />

      {deployments && deployments.length > 0 ? (
        <Card>
          <Table caption="Assessments available from your enrolled subjects">
            <THead>
              <TR>
                <TH>Assessment</TH>
                <TH>Type</TH>
                <TH align="right">Items</TH>
                <TH align="right">Points</TH>
                <TH align="right">Duration</TH>
                <TH>Window</TH>
                <TH>Status</TH>
                <TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {deployments.map((d: Record<string, unknown>) => {
                const assessment = (d.assessment_version as Record<string, unknown>)?.assessment as Record<string, unknown> | undefined;
                const version = d.assessment_version as Record<string, unknown> | undefined;
                const opensAt = new Date(d.opens_at as string);
                const closesAt = new Date(d.closes_at as string);
                const status = getDeploymentStatus(d);
                const isAvailable = now >= opensAt && now <= closesAt && !status.attemptId;
                const canResume = !!status.attemptId;
                const href = `/student/assessments/${(assessment?.id as string) ?? (d.id as string)}`;

                return (
                  <TR key={d.id as string} className="hover:bg-[var(--color-surface-hover)] align-top">
                    <TD>
                      <Link
                        href={href}
                        className="font-medium text-[var(--color-primary)] hover:underline"
                      >
                        {(assessment?.title as string) ?? 'Untitled Assessment'}
                      </Link>
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {assessment?.assessment_type === 'multiple_choice'
                        ? 'Multiple Choice'
                        : 'Identification'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {(version?.total_items as number) ?? '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {(version?.total_points as number) ?? '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-muted)]">
                      {d.duration_minutes as number} min
                    </TD>
                    <TD className="text-xs text-[var(--color-muted)]">
                      Opens {opensAt.toLocaleDateString()}{' '}
                      {opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      <span className="block">
                        Closes {closesAt.toLocaleDateString()}{' '}
                        {closesAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      {isAvailable || canResume ? (
                        <Link
                          href={href}
                          className="inline-flex items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"
                        >
                          {canResume ? 'Resume' : 'Start'}
                        </Link>
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No assessments available"
          description="Assessments from your enrolled subjects will appear here."
        />
      )}
    </div>
  );
}
