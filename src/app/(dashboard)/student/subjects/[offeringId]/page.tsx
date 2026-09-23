import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import StudentSubjectWorkspaceClient from './StudentSubjectWorkspaceClient';

interface Props {
  params: Promise<{ offeringId: string }>;
}

export default async function StudentSubjectDetailPage({ params }: Props) {
  const { offeringId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  // Verify enrollment.
  const { data: enrollment } = await supabase
    .from('enrollments')
    .select('id')
    .eq('student_id', user.id)
    .eq('subject_offering_id', offeringId)
    .eq('status', 'enrolled')
    .maybeSingle();

  if (!enrollment) redirect('/student/subjects');

  // Fetch offering details.
  const { data: offering } = await supabase
    .from('subject_offerings')
    .select(`
      id,
      subject:subjects(id, code, title, description),
      section:sections(id, name, program:programs(id, code, name), year_level:year_levels(id, name)),
      semester:semesters(id, name, academic_year:academic_years(id, name)),
      faculty_assignments:faculty_assignments(
        faculty:profiles(id, full_name)
      )
    `)
    .eq('id', offeringId)
    .single();

  if (!offering) notFound();

  const o = offering as unknown as Record<string, unknown>;
  const subject = o.subject as Record<string, unknown> | undefined;
  const section = o.section as Record<string, unknown> | undefined;
  const program = section?.program as Record<string, unknown> | undefined;
  const yearLevel = section?.year_level as Record<string, unknown> | undefined;
  const semester = o.semester as Record<string, unknown> | undefined;
  const academicYear = semester?.academic_year as Record<string, unknown> | undefined;
  const facultyAssignments = o.faculty_assignments as Array<Record<string, unknown>> | undefined;
  const faculty = facultyAssignments?.[0]?.faculty as Record<string, unknown> | undefined;

  // Fetch deployments for this offering that the student can see.
  const { data: deployments } = await supabase
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
    .eq('subject_offering_id', offeringId)
    .in('status', ['active', 'scheduled'])
    .order('opens_at', { ascending: true });

  // Fetch student's attempts for these deployments.
  const deploymentIds = (deployments ?? []).map((d: Record<string, unknown>) => d.id as string);

  const { data: attempts } = deploymentIds.length > 0
    ? await supabase
      .from('exam_attempts')
      .select('id, deployment_id, status, attempt_number')
      .eq('student_id', user.id)
      .in('deployment_id', deploymentIds)
    : { data: [] };

  const attemptsByDeployment = new Map<string, Array<Record<string, unknown>>>();
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
    const submittedCount = studentAttempts.filter((a) =>
      ['submitted', 'auto_submitted'].includes(a.status as string)
    ).length;
    const withinWindow = now >= opensAt && now <= closesAt;

    if (inProgress && withinWindow) return { label: 'In Progress' as const, variant: 'warning' as const, attemptId: inProgress.id as string };
    if (inProgress) return { label: 'Expired' as const, variant: 'danger' as const, attemptId: null as string | null };
    if (now < opensAt) return { label: 'Upcoming' as const, variant: 'info' as const, attemptId: null as string | null };
    if (now > closesAt) return { label: 'Closed' as const, variant: 'default' as const, attemptId: null as string | null };
    if (submittedCount >= (d.attempt_limit as number)) return { label: 'Completed' as const, variant: 'success' as const, attemptId: null as string | null };
    return { label: 'Available' as const, variant: 'success' as const, attemptId: null as string | null };
  };

  return (
    <StudentSubjectWorkspaceClient
      offeringId={offeringId}
      subject={subject}
      section={section}
      program={program}
      yearLevel={yearLevel}
      semester={semester}
      academicYear={academicYear}
      faculty={faculty}
      deployments={deployments as Array<Record<string, unknown>> | undefined}
      attemptsByDeployment={attemptsByDeployment}
      now={now}
      getDeploymentStatus={getDeploymentStatus}
    />
  );
}