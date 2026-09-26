import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import WorkspaceNavSetter from '@/components/layout/WorkspaceNavSetter';
import GradebookTable, {
  type GradebookCell,
  type GradebookColumn,
  type GradebookRow,
} from './GradebookTable';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingHeading {
  id: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
}

interface EnrollmentRow {
  student_id: string;
  student: {
    student_number: string | null;
    profiles:
      | { id: string; full_name: string | null }
      | { id: string; full_name: string | null }[]
      | null;
  } | null;
}

interface DeploymentRow {
  id: string;
  opens_at: string;
  status: string;
  assessment: { id: string; title: string } | null;
  version: { id: string; total_points: number | null } | null;
}

interface ResultRow {
  student_id: string;
  deployment_id: string;
  raw_score: number | string | null;
  possible_score: number | string | null;
  percentage: number | string;
  status: string;
}

interface AttemptRow {
  student_id: string;
  deployment_id: string;
}

function studentName(student: EnrollmentRow['student']): { number: string; name: string } {
  const profileRaw = student?.profiles ?? null;
  const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
  return {
    number: student?.student_number || 'N/A',
    name: profile?.full_name || '(unknown)',
  };
}

/**
 * Per-subject gradebook: every enrolled student against every deployment of
 * this section. All reads run as the signed-in faculty member (subject-level
 * RLS), so no service-role client is involved. Cells show the student's best
 * raw score and percentage across attempts (e.g. "20 (50%)"), attempt counts
 * when interesting, and a lock while the score is still pending release;
 * column headers carry the assessment's total points.
 */
export default async function SubjectResultsPage({ params }: Props) {
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

  const [enrollmentsResult, deploymentsResult] = await Promise.all([
    supabase
      .from('enrollments')
      .select(`
        student_id,
        student:student_profiles(student_number, profiles(id, full_name))
      `)
      .eq('subject_offering_id', offeringId)
      .eq('status', 'enrolled')
      .order('enrolled_at', { ascending: true }),
    supabase
      .from('assessment_deployments')
      .select('id, opens_at, status, assessment:assessments(id, title), version:assessment_versions(id, total_points)')
      .eq('subject_offering_id', offeringId)
      .order('opens_at', { ascending: true }),
  ]);

  const roster = ((enrollmentsResult.data ?? []) as unknown as EnrollmentRow[]).map((e) => {
    const display = studentName(e.student);
    return { studentId: e.student_id, studentNumber: display.number, name: display.name };
  });
  roster.sort((a, b) => a.name.localeCompare(b.name));

  const deployments = (deploymentsResult.data ?? []) as unknown as DeploymentRow[];

  const columns: GradebookColumn[] = deployments.map((d) => ({
    id: d.id,
    title: d.assessment?.title ?? 'Untitled Assessment',
    date: new Date(d.opens_at).toLocaleDateString(),
    points: d.version?.total_points ?? null,
  }));

  const studentIds = new Set(roster.map((r) => r.studentId));
  const deploymentIds = deployments.map((d) => d.id);

  const [resultsResponse, attemptsResponse] = await Promise.all([
    supabase
      .from('assessment_results')
      .select('student_id, deployment_id, raw_score, possible_score, percentage, status')
      .in('deployment_id', deploymentIds),
    supabase
      .from('exam_attempts')
      .select('student_id, deployment_id')
      .in('deployment_id', deploymentIds)
      .neq('status', 'cancelled'),
  ]);

  // Best percentage per (student, deployment); released follows that attempt.
  const bestByKey = new Map<string, { pct: number; score: number | null; released: boolean }>();
  // Per-deployment possible points seen so far — fallback for the column
  // header when the deployment's version join is unavailable.
  const possibleByDeployment = new Map<string, number>();
  for (const result of (resultsResponse.data ?? []) as unknown as ResultRow[]) {
    if (!studentIds.has(result.student_id)) continue;
    const pct = Number(result.percentage);
    const possible = result.possible_score == null ? null : Number(result.possible_score);
    if (possible != null && !Number.isNaN(possible)) {
      possibleByDeployment.set(
        result.deployment_id,
        Math.max(possibleByDeployment.get(result.deployment_id) ?? 0, possible)
      );
    }
    const key = `${result.student_id}:${result.deployment_id}`;
    const current = bestByKey.get(key);
    if (!current || pct > current.pct) {
      const score = result.raw_score == null ? null : Number(result.raw_score);
      bestByKey.set(key, {
        pct,
        score: score != null && !Number.isNaN(score) ? score : null,
        released: result.status === 'released',
      });
    }
  }

  // Backfill any column still missing its total points from result data.
  for (const column of columns) {
    if (column.points == null) {
      const possible = possibleByDeployment.get(column.id);
      if (possible != null) column.points = possible;
    }
  }

  const attemptsByKey = new Map<string, number>();
  for (const attempt of (attemptsResponse.data ?? []) as unknown as AttemptRow[]) {
    if (!studentIds.has(attempt.student_id)) continue;
    const key = `${attempt.student_id}:${attempt.deployment_id}`;
    attemptsByKey.set(key, (attemptsByKey.get(key) ?? 0) + 1);
  }

  const rows: GradebookRow[] = roster.map((student) => ({
    id: student.studentId,
    studentNumber: student.studentNumber,
    name: student.name,
    cells: deploymentIds.map((deploymentId): GradebookCell => {
      const key = `${student.studentId}:${deploymentId}`;
      const best = bestByKey.get(key) ?? null;
      return {
        pct: best ? best.pct : null,
        score: best ? best.score : null,
        released: best ? best.released : false,
        attempts: attemptsByKey.get(key) ?? 0,
      };
    }),
  }));

  const heading = `${o.subject?.code} - ${o.section?.name}`;
  const emptyDescription = 'Deploy an assessment to this section to start collecting scores.';

  return (
    <div>
      <WorkspaceNavSetter
        offeringId={offeringId}
        currentPath={`/faculty/subjects/${offeringId}/results`}
      />
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o.subject?.code} - ${o.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Results' },
        ]}
        title="Student Results"
        description={`${heading} · ${rows.length} ${rows.length === 1 ? 'student' : 'students'} · ${columns.length} ${columns.length === 1 ? 'assessment' : 'assessments'}`}
      />

      {columns.length === 0 ? (
        <EmptyState title="No assessments deployed yet" description={emptyDescription} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No students enrolled"
          description="Enroll students in this section to see their scores here."
        />
      ) : (
        <Card>
          <GradebookTable columns={columns} rows={rows} />
        </Card>
      )}
    </div>
  );
}
