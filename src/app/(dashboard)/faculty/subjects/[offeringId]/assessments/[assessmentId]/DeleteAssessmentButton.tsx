'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { deleteAssessment } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';

interface DeleteAssessmentButtonProps {
  assessmentId: string;
  title: string;
  /** Label on the trigger; defaults to "Delete". */
  label?: string;
  /** Button size; defaults to sm (lists) — pass nothing for header use. */
  size?: 'sm' | 'md' | 'lg';
  /** When set, navigate here after a successful delete (e.g. back to the list). */
  redirectTo?: string;
  className?: string;
}

export default function DeleteAssessmentButton({
  assessmentId,
  title,
  label = 'Delete',
  size = 'sm',
  redirectTo,
  className,
}: DeleteAssessmentButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    const confirmed = await confirmAction({
      title: `Delete “${title}”?`,
      text: 'This permanently removes the assessment, its questions, deployments, and schedules. This cannot be undone.',
      confirmText: 'Delete assessment',
      destructive: true,
    });
    if (!confirmed) return;

    setLoading(true);
    try {
      await deleteAssessment(assessmentId);
      notifySuccess('Assessment deleted', `"${title}" was removed.`);
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch (e) {
      notifyError('Could not delete assessment', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      variant="danger"
      size={size}
      onClick={() => void handleDelete()}
      loading={loading}
      className={className}
    >
      {label}
    </Button>
  );
}
