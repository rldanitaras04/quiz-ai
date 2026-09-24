import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireRole, assessmentSharesSubjectWithOffering } from '@/lib/auth';
import PageHeader from '@/components/ui/PageHeader';
import AnalyticsClient from './AnalyticsClient';

export default async function AnalyticsPage({
  params,
}: {
  params: Promise<{ offeringId: string; assessmentId: string }>;
}) {
  const { offeringId, assessmentId } = await params;
  const gate = await requireRole(['faculty', 'super_admin']);
  if (gate.status === 'blocked') return null;

  const { supabase } = gate;

  const { data: assessment } = await supabase
    .from('assessments')
    .select('title, subject_offering_id, current_version_id')
    .eq('id', assessmentId)
    .maybeSingle();

  if (!assessment) notFound();

  const sharesSubject = await assessmentSharesSubjectWithOffering(
    supabase,
    assessment.subject_offering_id,
    offeringId
  );
  if (!sharesSubject) notFound();

  // Latest deployment of this assessment in the current section (per-section data).
  const { data: deployment } = assessment.current_version_id
    ? await supabase
        .from('assessment_deployments')
        .select('id')
        .eq('assessment_version_id', assessment.current_version_id)
        .eq('subject_offering_id', offeringId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Analytics — ${assessment.title}`}
        description="View assessment performance metrics and item analysis"
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'Subjects', href: `/faculty/subjects/${offeringId}` },
          { label: assessment.title, href: `/faculty/subjects/${offeringId}/assessments/${assessmentId}` },
          { label: 'Analytics' },
        ]}
      />
      <Suspense fallback={<div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" /></div>}>
        {deployment ? (
          <AnalyticsClient deploymentId={deployment.id} />
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-muted">No deployments found for this assessment.</p>
          </div>
        )}
      </Suspense>
    </div>
  );
}
