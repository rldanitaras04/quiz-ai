import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth';
import PageHeader from '@/components/ui/PageHeader';
import ExceptionsClient from './ExceptionsClient';

export default async function ExceptionsPage({
  params,
}: {
  params: Promise<{ offeringId: string; assessmentId: string }>;
}) {
  const { offeringId, assessmentId } = await params;
  const gate = await requireRole(['faculty', 'super_admin']);
  if (gate.status === 'blocked') return null;

  const { supabase } = gate;

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, assessment_version_id, opens_at, closes_at, status')
    .eq('assessment_version_id',
      (await supabase
        .from('assessments')
        .select('current_version_id')
        .eq('id', assessmentId)
        .single()
      ).data?.current_version_id ?? ''
    )
    .eq('subject_offering_id', offeringId)
    .single();

  if (!deployment) notFound();

  const { data: assessment } = await supabase
    .from('assessments')
    .select('title')
    .eq('id', assessmentId)
    .single();

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
      <Suspense fallback={<div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" /></div>}>
        <ExceptionsClient deploymentId={deployment.id} />
      </Suspense>
    </div>
  );
}
