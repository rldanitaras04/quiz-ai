import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import SubjectNewAssessmentClient from './SubjectNewAssessmentClient';

interface Props {
  params: Promise<{ subjectId: string }>;
}

interface OfferingInfo {
  id: string;
  section: { name: string } | null;
}

interface SubjectInfo {
  id: string;
  code: string;
  title: string;
}

export default async function SubjectNewAssessmentPage({ params }: Props) {
  const { subjectId } = await params;
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

  // Get all offerings for this subject that the faculty is assigned to
  const { data: offerings } = await supabase
    .from('subject_offerings')
    .select('id, section:sections(name)')
    .eq('subject_id', subjectId)
    .eq('status', 'active');

  const offeringList = (offerings ?? []) as unknown as OfferingInfo[];

  if (offeringList.length === 0) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[
            { label: 'Faculty', href: '/faculty' },
            { label: 'My Subjects', href: '/faculty/subjects' },
            { label: `${s.code} - ${s.title}`, href: `/faculty/subjects/subject/${subjectId}` },
            { label: 'New Assessment' },
          ]}
          title="Create Assessment"
          description="No active offerings found"
        />
        <div className="text-center py-12">
          <p className="text-[var(--color-muted)]">No active offerings found for this subject.</p>
        </div>
      </div>
    );
  }

  // Use the first offering ID for creating the assessment
  const primaryOfferingId = offeringList[0].id;

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${s.code} - ${s.title}`, href: `/faculty/subjects/subject/${subjectId}` },
          { label: 'New Assessment' },
        ]}
        title="Create Assessment"
        description={`Build a new assessment for ${s.code} (can be deployed to all ${offeringList.length} section${offeringList.length !== 1 ? 's' : ''} after creation)`}
      />

      <SubjectNewAssessmentClient
        subjectId={subjectId}
        primaryOfferingId={primaryOfferingId}
        subjectName={`${s.code} - ${s.title}`}
      />
    </div>
  );
}
