import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import { ASSESSMENT_STATUS_LABELS } from '@/lib/constants';
import { getAssessmentDetail } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import AssessmentDetailClient from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/[assessmentId]/AssessmentDetailClient';

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
}

export default async function SubjectAssessmentDetailPage({ params }: Props) {
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
    .select('id, section:sections(name)')
    .eq('subject_id', subjectId)
    .eq('status', 'active');

  const offeringList = (offerings ?? []) as unknown as OfferingInfo[];
  const offeringIds = offeringList.map((o) => o.id);

  // Get assessment detail using the first offering that this assessment belongs to
  const detail = await getAssessmentDetail(assessmentId);
  if (!detail) notFound();

  // Verify assessment belongs to one of this subject's offerings
  if (!offeringIds.includes(detail.subjectOfferingId)) notFound();

  const sectionNames = offeringList.map(o => o.section?.name ?? '—').join(', ');

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${s.code} - ${s.title}`, href: `/faculty/subjects/subject/${subjectId}` },
          { label: detail.title },
        ]}
        title={detail.title}
        description={`${s.code} · Sections: ${sectionNames}`}
        actions={
          <Link href={`/faculty/subjects/subject/${subjectId}/assessments/${assessmentId}/deploy`}>
            <Button variant="primary">Deploy to Sections</Button>
          </Link>
        }
      />

      <AssessmentDetailClient detail={detail} subjectName={`${s.code} - ${s.title}`} />
    </div>
  );
}
