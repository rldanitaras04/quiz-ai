import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import FacultySubjectWorkspaceClient from './FacultySubjectWorkspaceClient';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingDetail {
  id: string;
  status: string;
  subject: { id: string; code: string; title: string; description: string | null } | null;
  semester: {
    id: string;
    name: string;
    academic_year: {
      id: string;
      name: string;
      starts_on: string;
      ends_on: string;
    } | null;
  } | null;
  section: {
    id: string;
    name: string;
    program: { id: string; code: string; name: string } | null;
    year_level: { id: string; name: string } | null;
  } | null;
  faculty_assignments: Array<{
    id: string;
    faculty: { id: string; full_name: string; email: string | null } | null;
  }>;
}

export default async function SubjectOfferingDetailPage({ params }: Props) {
  const { offeringId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select(`
      id,
      status,
      subject:subjects(id, code, title, description),
      semester:semesters(id, name, academic_year:academic_years(id, name, starts_on, ends_on)),
      section:sections(id, name, program:programs(id, code, name), year_level:year_levels(id, name)),
      faculty_assignments:faculty_assignments(id, faculty:faculty_profiles(profiles(id, full_name, email)))
    `)
    .eq('id', offeringId)
    .single();

  if (!offering) redirect('/faculty/subjects');

  const o = offering as unknown as Omit<OfferingDetail, 'faculty_assignments'> & {
    faculty_assignments: Array<{
      id: string;
      faculty: {
        profiles:
          | { id: string; full_name: string | null; email: string | null }
          | { id: string; full_name: string | null; email: string | null }[]
          | null;
      } | null;
    }>;
  };

  const facultyAssignments = (o.faculty_assignments ?? []).map((fa) => {
    const profileRaw = fa.faculty?.profiles ?? null;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;
    return {
      id: fa.id,
      faculty: profile
        ? {
            id: profile.id,
            full_name: profile.full_name ?? '',
            email: profile.email ?? null,
          }
        : null,
    };
  });

  const [enrollmentsCount, assessmentsCount, sourcesCount] = await Promise.all([
    supabase.from('enrollments').select('id', { count: 'exact', head: true })
      .eq('subject_offering_id', offeringId).eq('status', 'enrolled'),
    supabase.from('assessments').select('id', { count: 'exact', head: true })
      .eq('subject_offering_id', offeringId),
    supabase.from('source_materials').select('id', { count: 'exact', head: true })
      .eq('subject_offering_id', offeringId),
  ]);

  return (
    <FacultySubjectWorkspaceClient
      offeringId={offeringId}
      subject={o.subject}
      section={o.section}
      semester={o.semester}
      enrollmentsCount={enrollmentsCount.count ?? 0}
      assessmentsCount={assessmentsCount.count ?? 0}
      sourcesCount={sourcesCount.count ?? 0}
      status={o.status}
      facultyAssignments={facultyAssignments}
    />
  );
}