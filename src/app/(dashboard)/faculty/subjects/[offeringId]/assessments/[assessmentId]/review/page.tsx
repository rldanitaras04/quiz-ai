import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth';
import PageHeader from '@/components/ui/PageHeader';
import ReviewClient from './ReviewClient';

export default async function ReviewPage({
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
    .select('title, subject_offering_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment || assessment.subject_offering_id !== offeringId) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Review — ${assessment.title}`}
        description="Manually review and score identification question responses"
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'Subjects', href: `/faculty/subjects/${offeringId}` },
          { label: assessment.title, href: `/faculty/subjects/${offeringId}/assessments/${assessmentId}` },
          { label: 'Review' },
        ]}
      />
      <Suspense fallback={<div className="flex justify-center py-8"><div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" /></div>}>
        <ReviewClient assessmentId={assessmentId} />
      </Suspense>
    </div>
  );
}
