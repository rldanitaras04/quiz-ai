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
        faculty:faculty_profiles(profiles(id, full_name))
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
  const facultyRaw = facultyAssignments?.[0]?.faculty as Record<string, unknown> | undefined;
  const facultyProfilesRaw = facultyRaw?.profiles;
  const faculty = (Array.isArray(facultyProfilesRaw)
    ? facultyProfilesRaw[0]
    : facultyProfilesRaw) as Record<string, unknown> | undefined;

  // Fetch deployments for this offering (exclude unpublished drafts).
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
          assessment:assessments!assessment_versions_assessment_id_fkey(id, title, assessment_type)
        )
    `)
    .eq('subject_offering_id', offeringId)
    .in('status', ['active', 'scheduled', 'closed'])
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

  // Released results for this offering only.
  const { data: results } = deploymentIds.length > 0
    ? await supabase
      .from('assessment_results')
      .select(`
        id,
        attempt_id,
        raw_score,
        possible_score,
        percentage,
        status,
        released_at,
        created_at,
        deployment:assessment_deployments(
          id,
          assessment_version:assessment_versions(
            id,
            assessment:assessments!assessment_versions_assessment_id_fkey(id, title, assessment_type)
          )
        )
      `)
      .eq('student_id', user.id)
      .eq('status', 'released')
      .in('deployment_id', deploymentIds)
      .order('released_at', { ascending: false })
    : { data: [] };

  const now = new Date();

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
      results={(results ?? []) as Array<Record<string, unknown>>}
      now={now}
    />
  );
}