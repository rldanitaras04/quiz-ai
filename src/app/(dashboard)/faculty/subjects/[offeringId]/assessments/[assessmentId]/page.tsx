import { redirect, notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { assessmentSharesSubjectWithOffering } from '@/lib/auth';
import { ASSESSMENT_STATUS_LABELS } from '@/lib/constants';
import { getAssessmentDetail } from '../actions';
import AssessmentWorkspaceClient from './AssessmentWorkspaceClient';

interface Props {
  params: Promise<{ offeringId: string; assessmentId: string }>;
}

interface OfferingHeading {
  subject: { code: string; title: string } | null;
  section: { name: string } | null;
}

/**
 * Review surface for a saved assessment: read the questions the wizard
 * generated, edit or delete them, add one by hand, and publish the assessment.
 * Without this route the question-editing server actions were unreachable.
 */
export default async function AssessmentDetailPage({ params }: Props) {
  const { offeringId, assessmentId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  // Authorizes against the offering: null means not faculty on this assessment.
  const detail = await getAssessmentDetail(assessmentId);
  if (!detail) notFound();

  // Sibling sections of the same subject share subject-level assessments.
  const sharesSubject = await assessmentSharesSubjectWithOffering(
    supabase,
    detail.subjectOfferingId,
    offeringId
  );
  if (!sharesSubject) notFound();

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject:subjects(code, title), section:sections(name)')
    .eq('id', offeringId)
    .single();

  const heading = offering as unknown as OfferingHeading | null;
  const subjectName = heading?.subject
    ? `${heading.subject.code} - ${heading.section?.name ?? heading.subject.title}`
    : '';
  const statusLabel =
    ASSESSMENT_STATUS_LABELS[detail.status as keyof typeof ASSESSMENT_STATUS_LABELS] ??
    detail.status;

  return (
    <AssessmentWorkspaceClient
      offeringId={offeringId}
      assessmentId={assessmentId}
      detail={detail}
      subjectName={subjectName}
      statusLabel={statusLabel}
      heading={heading}
    />
  );
}