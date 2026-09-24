import { Suspense } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireRole, assessmentSharesSubjectWithOffering } from '@/lib/auth';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import ExceptionsClient from './ExceptionsClient';

interface DeploymentRow {
  id: string;
}

/**
 * Latest deployment of this assessment in the given section.
 * Prefers the assessment's current version, then falls back to any section
 * deployment (redeploys and older versions still own their exceptions).
 * Uses limit(1) so multiple rows never surface as a 404.
 */
async function findSectionDeployment(
  supabase: SupabaseClient,
  assessmentId: string,
  offeringId: string,
  currentVersionId: string | null
): Promise<DeploymentRow | null> {
  if (currentVersionId) {
    const { data } = await supabase
      .from('assessment_deployments')
      .select('id')
      .eq('assessment_id', assessmentId)
      .eq('subject_offering_id', offeringId)
      .eq('assessment_version_id', currentVersionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) return data as DeploymentRow;
  }

  const { data } = await supabase
    .from('assessment_deployments')
    .select('id')
    .eq('assessment_id', assessmentId)
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as DeploymentRow | null) ?? null;
}

export default async function ExceptionsPage({
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

  // Exceptions are per-section. Missing deployment is not a 404: the workspace
  // nav always links here, including before the first deploy.
  const deployment = await findSectionDeployment(
    supabase,
    assessmentId,
    offeringId,
    assessment.current_version_id
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Exceptions — ${assessment?.title ?? 'Assessment'}`}
        description="Manage student exceptions for this assessment deployment"
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'Subjects', href: `/faculty/subjects/${offeringId}` },
          { label: assessment?.title ?? 'Assessment', href: `/faculty/subjects/${offeringId}/assessments/${assessmentId}` },
          { label: 'Exceptions' },
        ]}
      />
      {deployment ? (
        <Suspense fallback={<div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" /></div>}>
          <ExceptionsClient deploymentId={deployment.id} />
        </Suspense>
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              title="Not deployed to this section yet"
              description="Student exceptions apply to a section deployment. Deploy this assessment to this section first, then grant extended time, attempts, or schedule overrides."
            />
            <div className="flex justify-center pb-6">
              <Link href={`/faculty/subjects/${offeringId}/assessments/${assessmentId}/deploy`}>
                <Button variant="primary">Deployment & Schedule</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
