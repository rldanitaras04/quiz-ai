import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import StartExamButton from './StartExamButton';
import { ATTEMPT_STATUS_LABELS } from '@/lib/constants';

interface Props {
  params: Promise<{ assessmentId: string }>;
}

export default async function AssessmentDetailPage({ params }: Props) {
  const { assessmentId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: assessment } = await supabase
    .from('assessments')
    .select(`
      id,
      title,
      assessment_type,
      status,
      subject_offering:subject_offerings(
        subject:subjects(id, code, title)
      )
    `)
    .eq('id', assessmentId)
    .single();

  if (!assessment) notFound();

  const a = assessment as Record<string, unknown> & {
    title?: string;
    assessment_type?: string;
    subject_offering?: { subject?: { id?: string; code?: string; title?: string } };
  };
  const subject = a.subject_offering?.subject;

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('subject_offering_id')
    .eq('student_id', user.id)
    .eq('status', 'enrolled');

  const offeringIds = (enrollments ?? []).map((e: Record<string, unknown>) => e.subject_offering_id as string).filter(Boolean);

  // Deployments are linked to this assessment via its versions. Resolve the
  // version IDs first (embed-filters on nested relations are fragile).
  const { data: versionRows } = await supabase
    .from('assessment_versions')
    .select('id')
    .eq('assessment_id', assessmentId);

  const versionIds = (versionRows ?? []).map((v: { id: string }) => v.id);

  const { data: deployments } = versionIds.length > 0 && offeringIds.length > 0
    ? await supabase
      .from('assessment_deployments')
      .select(`
        id,
        opens_at,
        closes_at,
        duration_minutes,
        attempt_limit,
        status,
        score_release_mode,
        show_raw_score,
        show_percentage,
        show_item_correctness,
        show_correct_answers,
        show_explanations,
        assessment_version:assessment_versions(
          id,
          total_items,
          total_points,
          version_number
        )
      `)
      .in('subject_offering_id', offeringIds)
      .in('assessment_version_id', versionIds)
      .in('status', ['active', 'scheduled', 'closed'])
      .order('opens_at', { ascending: false })
    : { data: [] };

  const deploymentIds = (deployments ?? []).map((d: Record<string, unknown>) => d.id as string);

  const { data: attempts } = deploymentIds.length > 0
    ? await supabase
      .from('exam_attempts')
      .select('id, deployment_id, status, attempt_number, started_at, submitted_at')
      .eq('student_id', user.id)
      .in('deployment_id', deploymentIds)
      .order('created_at', { ascending: false })
    : { data: [] };

  const { data: results } = deploymentIds.length > 0
    ? await supabase
      .from('assessment_results')
      .select('id, attempt_id, raw_score, possible_score, percentage, status, released_at')
      .eq('student_id', user.id)
      .in('deployment_id', deploymentIds)
    : { data: [] };

  const resultsByAttempt = new Map<string, Record<string, unknown>>();
  (results ?? []).forEach((r: Record<string, unknown>) => resultsByAttempt.set(r.attempt_id as string, r));

  const now = new Date();
  // A deployment is startable when its time window is open — 'scheduled'
  // deployments never transition to 'active' (no scheduler exists), so the
  // time window, not the status column, is the source of truth here.
  const activeDeployment = (deployments ?? []).find((d: Record<string, unknown>) => {
    const opensAt = new Date(d.opens_at as string);
    const closesAt = new Date(d.closes_at as string);
    const studentAttempts = (attempts ?? []).filter((a: Record<string, unknown>) => a.deployment_id === d.id);
    const submittedCount = studentAttempts.filter((a) => ['submitted', 'auto_submitted'].includes(a.status as string)).length;
    const hasInProgress = studentAttempts.some((a) => a.status === 'in_progress');
    return now >= opensAt && now <= closesAt && !hasInProgress && submittedCount < (d.attempt_limit as number);
  });

  const resumableDeployment = (deployments ?? []).find((d: Record<string, unknown>) => {
    const closesAt = new Date(d.closes_at as string);
    return (attempts ?? []).some((a: Record<string, unknown>) =>
      a.deployment_id === d.id && a.status === 'in_progress') && now <= closesAt;
  });

  const resumeAttemptId = resumableDeployment
    ? ((attempts ?? []).find(
        (a: Record<string, unknown>) =>
          a.deployment_id === resumableDeployment.id && a.status === 'in_progress'
      )?.id as string | undefined)
    : undefined;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Student', href: '/student' },
          { label: 'Assessments', href: '/student/assessments' },
          { label: a.title ?? '' },
        ]}
        title={a.title ?? ''}
        description={`${subject?.code} - ${subject?.title}`}
        actions={
          resumableDeployment && resumeAttemptId ? (
            <Link
              href={`/student/assessments/${assessmentId}/exam/${resumeAttemptId}`}
            >
              <Button variant="primary">Resume Exam</Button>
            </Link>
          ) : activeDeployment ? (
            <StartExamButton
              assessmentId={assessmentId}
              deploymentId={activeDeployment.id as string}
            />
          ) : undefined
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold">Assessment Details</h2>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">Type</span>
                <span className="font-medium">{a.assessment_type === 'multiple_choice' ? 'Multiple Choice' : 'Identification'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">Subject</span>
                <span className="font-medium">{subject?.code}</span>
              </div>
            </CardContent>
          </Card>

          {deployments && deployments.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Deployments</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                {deployments.map((d: Record<string, unknown>) => {
                  const version = d.assessment_version as Record<string, unknown> | undefined;
                  const opensAt = new Date(d.opens_at as string);
                  const closesAt = new Date(d.closes_at as string);
                  const isPast = now > closesAt;
                  // The time window — not the status column — decides whether a
                  // deployment is open: nothing transitions 'scheduled' to
                  // 'active', so status alone would mislabel live exams.
                  const isOpen = now >= opensAt && now <= closesAt;

                  return (
                    <div key={d.id as string} className="p-3 rounded-lg border border-[var(--color-border)] space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">
                          Version {version?.version_number as number} \u00B7 {version?.total_items as number} items \u00B7 {version?.total_points as number} pts
                        </span>
                        <Badge variant={isOpen ? 'success' : isPast ? 'default' : 'info'}>
                          {isOpen ? 'Open' : isPast ? 'Closed' : 'Scheduled'}
                        </Badge>
                      </div>
                      <p className="text-xs text-[var(--color-muted)]">
                        {opensAt.toLocaleDateString()} {opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' \u2014 '}
                        {closesAt.toLocaleDateString()} {closesAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {` \u00B7 ${d.duration_minutes} min`}
                      </p>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {attempts && attempts.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold">Attempt History</h2>
              </CardHeader>
              <CardContent className="space-y-3">
                {attempts.map((at: Record<string, unknown>) => {
                  const result = resultsByAttempt.get(at.id as string);
                  return (
                    <div key={at.id as string} className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]">
                      <div>
                        <p className="text-sm font-medium">Attempt {at.attempt_number as number}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          Started {new Date(at.started_at as string).toLocaleDateString()}
                          {at.submitted_at ? ` \u00B7 Submitted ${new Date(at.submitted_at as string).toLocaleDateString()}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {result && (
                          <Badge variant={(result.percentage as number) >= 75 ? 'success' : (result.percentage as number) >= 50 ? 'warning' : 'danger'}>
                            {Math.round(result.percentage as number)}%
                          </Badge>
                        )}
                        <Badge variant={at.status === 'in_progress' ? 'warning' : 'default'}>
                          {ATTEMPT_STATUS_LABELS[at.status as keyof typeof ATTEMPT_STATUS_LABELS] ?? (at.status as string)}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {(activeDeployment || resumableDeployment) && (
            <Card className="sticky top-6">
              <CardHeader>
                <h2 className="text-lg font-semibold">Active Deployment</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Duration</span>
                    <span className="font-medium">{(activeDeployment ?? resumableDeployment)?.duration_minutes as number} min</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--color-muted)]">Attempts</span>
                    <span className="font-medium">{(activeDeployment ?? resumableDeployment)?.attempt_limit as number}</span>
                  </div>
                </div>
                {resumableDeployment && resumeAttemptId ? (
                  <Link
                    href={`/student/assessments/${assessmentId}/exam/${resumeAttemptId}`}
                    className="block"
                  >
                    <Button variant="primary" className="w-full">
                      Resume Exam
                    </Button>
                  </Link>
                ) : activeDeployment ? (
                  <StartExamButton
                    assessmentId={assessmentId}
                    deploymentId={activeDeployment.id as string}
                    className="w-full [&>button]:w-full"
                  />
                ) : null}
              </CardContent>
            </Card>
          )}

          {!activeDeployment && !resumableDeployment && (
            <Card>
              <CardContent>
                <p className="text-sm text-[var(--color-muted)] text-center py-4">
                  No active deployment at this time.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
