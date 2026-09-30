import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import AssessmentNavSetter from '../AssessmentNavSetter';
import MonitorClient, { type MonitorStudent, type MonitorDeployment } from './MonitorClient';

interface Props {
  params: Promise<{ offeringId: string; assessmentId: string }>;
}

export default async function LiveMonitorPage({ params }: Props) {
  const { offeringId, assessmentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  // RLS: only faculty assigned to this offering can read these rows.
  const { data: assignment } = await supabase
    .from('faculty_assignments')
    .select('id')
    .eq('subject_offering_id', offeringId)
    .eq('faculty_id', user.id)
    .maybeSingle();

  if (!assignment) redirect('/faculty/subjects');

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, title, status')
    .eq('id', assessmentId)
    .maybeSingle();

  if (!assessment) notFound();

  // Subject + section context for the monitor header.
  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject:subjects(code, title), section:sections(name)')
    .eq('id', offeringId)
    .maybeSingle();

  const offeringTyped = (offering ?? null) as {
    subject?: { code?: string; title?: string } | { code?: string; title?: string }[] | null;
    section?: { name?: string } | { name?: string }[] | null;
  } | null;
  const subjectFirst = Array.isArray(offeringTyped?.subject)
    ? offeringTyped?.subject?.[0]
    : offeringTyped?.subject;
  const sectionFirst = Array.isArray(offeringTyped?.section)
    ? offeringTyped?.section?.[0]
    : offeringTyped?.section;
  const contextLabel = [subjectFirst?.code, sectionFirst?.name]
    .filter(Boolean)
    .join(' · ');

  const { data: deployments } = await supabase
    .from('assessment_deployments')
    .select(
      'id, status, opens_at, closes_at, duration_minutes, attempt_limit, security_mode, created_at'
    )
    .eq('assessment_id', assessmentId)
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  const deploymentList = (deployments ?? []) as unknown as MonitorDeployment[];

  // The roster: every enrolled student plus anyone who already has an attempt
  // (the monitor must show both groups even if enrollment changes mid-exam).
  const deploymentIds = deploymentList.map((d) => d.id);
  const [enrollmentRows, attemptStudents] = await Promise.all([
    supabase.from('enrollments').select('student_id').eq('subject_offering_id', offeringId),
    deploymentIds.length > 0
      ? supabase.from('exam_attempts').select('student_id').in('deployment_id', deploymentIds)
      : Promise.resolve({ data: [] as { student_id: string }[] }),
  ]);

  const studentIds = Array.from(
    new Set(
      [...(enrollmentRows.data ?? []), ...(attemptStudents.data ?? [])].map(
        (r) => r.student_id as string
      )
    )
  );

  const [profilesRes, studentProfilesRes] = await Promise.all([
    studentIds.length > 0
      ? supabase.from('profiles').select('id, full_name, email').in('id', studentIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string; email: string }[] }),
    studentIds.length > 0
      ? supabase.from('student_profiles').select('user_id, student_number').in('user_id', studentIds)
      : Promise.resolve({ data: [] as { user_id: string; student_number: string }[] }),
  ]);

  const profiles = new Map(
    ((profilesRes.data ?? []) as { id: string; full_name: string; email: string }[]).map((p) => [
      p.id,
      p,
    ])
  );
  const numbers = new Map(
    ((studentProfilesRes.data ?? []) as { user_id: string; student_number: string }[]).map((p) => [
      p.user_id,
      p.student_number,
    ])
  );

  const roster: MonitorStudent[] = studentIds.map((id) => ({
    id,
    fullName: profiles.get(id)?.full_name ?? 'Unknown student',
    email: profiles.get(id)?.email ?? '',
    studentNumber: numbers.get(id) ?? '',
  }));

  return (
    <div>
      <AssessmentNavSetter offeringId={offeringId} assessmentId={assessmentId} />
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: 'Subject', href: `/faculty/subjects/${offeringId}` },
          { label: 'Assessments', href: `/faculty/subjects/${offeringId}/assessments` },
          { label: assessment.title, href: `/faculty/subjects/${offeringId}/assessments/${assessmentId}` },
          { label: 'Live Monitor' },
        ]}
        title="Live Exam Monitor"
        description="Live session status, security events, and faculty controls for this assessment."
      />
      {deploymentList.length === 0 ? (
        <EmptyState
          title="No deployments yet"
          description="Deploy this assessment to students first — the Live Monitor shows sessions per deployment."
        />
      ) : (
        <MonitorClient
          offeringId={offeringId}
          assessmentId={assessmentId}
          deployments={deploymentList}
          roster={roster}
          contextLabel={contextLabel}
        />
      )}
    </div>
  );
}
