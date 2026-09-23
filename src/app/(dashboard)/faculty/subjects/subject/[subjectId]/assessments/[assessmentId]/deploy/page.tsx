import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import MultiSectionDeployClient from './MultiSectionDeployClient';

interface Props {
  params: Promise<{ subjectId: string; assessmentId: string }>;
}

interface SubjectInfo {
  id: string;
  code: string;
  title: string;
}

interface OfferingInfo {
  id: string;
  section: { name: string } | null;
  semester: { name: string } | null;
}

export default async function MultiSectionDeployPage({ params }: Props) {
  const { subjectId, assessmentId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  // Get subject info
  const { data: subject } = await supabase
    .from('subjects')
    .select('id, code, title')
    .eq('id', subjectId)
    .single();

  if (!subject) notFound();
  const s = subject as SubjectInfo;

  // Get all offerings for this subject
  const { data: offerings } = await supabase
    .from('subject_offerings')
    .select('id, section:sections(name), semester:semesters(name)')
    .eq('subject_id', subjectId)
    .eq('status', 'active');

  const offeringList = (offerings ?? []) as unknown as OfferingInfo[];

  // Get assessment info
  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, title, status, current_version_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment) notFound();

  // Get version info
  const { data: version } = await supabase
    .from('assessment_versions')
    .select('id, version_number, total_items, total_points')
    .eq('id', assessment.current_version_id)
    .maybeSingle();

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${s.code} - ${s.title}`, href: `/faculty/subjects/subject/${subjectId}` },
          { label: assessment.title, href: `/faculty/subjects/subject/${subjectId}/assessments/${assessmentId}` },
          { label: 'Deploy to Sections' },
        ]}
        title={`Deploy: ${assessment.title}`}
        description={`Deploy to ${offeringList.length} section${offeringList.length !== 1 ? 's' : ''} of ${s.code}`}
      />

      <MultiSectionDeployClient
        assessmentId={assessmentId}
        subjectId={subjectId}
        offerings={offeringList.map(o => ({
          id: o.id,
          sectionName: o.section?.name ?? '—',
          semesterName: o.semester?.name ?? '—',
        }))}
        assessmentTitle={assessment.title}
        versionNumber={version?.version_number ?? 1}
        totalItems={version?.total_items ?? 0}
        totalPoints={version?.total_points ?? 0}
      />
    </div>
  );
}
