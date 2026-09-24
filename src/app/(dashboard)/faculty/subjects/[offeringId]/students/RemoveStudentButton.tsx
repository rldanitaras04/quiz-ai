'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { removeStudentFromOffering } from './actions';

interface RemoveStudentButtonProps {
  offeringId: string;
  studentId: string;
  studentName: string;
  onChanged?: () => void;
}

/**
 * Withdraws a student from the offering. The enrollment row is kept with
 * status `withdrawn` (with its submissions intact) rather than deleted.
 */
export default function RemoveStudentButton({
  offeringId,
  studentId,
  studentName,
  onChanged,
}: RemoveStudentButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleRemove = async () => {
    const confirmed = await confirmAction({
      title: `Remove ${studentName}?`,
      text: 'They lose access to this offering and its assessments. Their submissions are kept.',
      confirmText: 'Remove student',
      destructive: true,
    });
    if (!confirmed) return;

    setLoading(true);
    const result = await removeStudentFromOffering(offeringId, studentId);
    setLoading(false);

    if (result.error) {
      notifyError('Could not remove the student', result.error);
      return;
    }

    notifySuccess('Student removed', `${studentName} is no longer enrolled.`);
    router.refresh();
    onChanged?.();
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={loading}
      onClick={() => void handleRemove()}
      className="text-[var(--color-danger)]"
    >
      Remove
    </Button>
  );
}
