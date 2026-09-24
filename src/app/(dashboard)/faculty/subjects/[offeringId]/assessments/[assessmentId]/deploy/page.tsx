import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import DeployClient from './DeployClient';
import type { AssessmentVersion } from '@/lib/types';

interface Props {
  params: Promise<{ offeringId: string; assessmentId: string }>;
}

interface AssessmentHeading {
  id: string;
  title: string;
  status: string;
  current_version_id: string | null;
}

interface OfferingHeading {
  subject: { code: string; title: string } | null;
}

export default async function DeployPage({ params }: Props) {
  const { offeringId, assessmentId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  // RLS: only the faculty assigned to this offering can read these rows.
  const { data: assignment } = await supabase
    .from('faculty_assignments')
    .select('id')
    .eq('subject_offering_id', offeringId)
    .eq('faculty_id', user.id)
    .single();

  if (!assignment) redirect('/faculty/subjects');

  const { data: assessment } = await supabase
    .from('assessments')
    .select(`
      id,
      title,
      status,
      current_version_id,
      current_version:assessment_versions!assessments_current_version_id_fkey(id, version_number, status, total_items, total_points)
    `)
    .eq('id', assessmentId)
    .single();

  if (!assessment) notFound();

  const a = assessment as unknown as AssessmentHeading;

  // Only published assessments may be deployed.
  if (a.status !== 'published') {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[
            { label: 'Subjects', href: '/faculty/subjects' },
            { label: a.title, href: `/faculty/subjects/${offeringId}/assessments/${assessmentId}` },
            { label: 'Deploy' },
          ]}
          title="Deploy Assessment"
          description="This assessment is not published yet"
        />
        <EmptyState
          title="Publish before deploying"
          description="Only published assessments can be deployed to students. Publish the assessment, then return here to schedule or open it."
        />
        <div className="flex justify-center">
          <Link href={`/faculty/subjects/${offeringId}/assessments/${assessmentId}`}>
            <Button variant="primary">Go to assessment</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { data: versions } = await supabase
    .from('assessment_versions')
    .select('id, version_number, status, total_items, total_points')
    .eq('assessment_id', assessmentId)
    .order('version_number', { ascending: true });

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject:subjects(code, title)')
    .eq('id', offeringId)
    .single();

  const versionsList = (versions ?? []) as unknown as AssessmentVersion[];
  const offeringHeading = offering as unknown as OfferingHeading | null;

  // Default selection: current version if published, else latest.
  const fallback =
    versionsList.find((v) => v.id === a.current_version_id) ??
    versionsList[versionsList.length - 1] ??
    null;

  return (
    <DeployClient
      assessmentId={a.id}
      offeringId={offeringId}
      assessmentTitle={a.title}
      subjectName={
        offeringHeading?.subject
          ? `${offeringHeading.subject.code} - ${offeringHeading.subject.title}`
          : ''
      }
      versions={versionsList}
      defaultVersionId={fallback?.id ?? ''}
    />
  );
}
