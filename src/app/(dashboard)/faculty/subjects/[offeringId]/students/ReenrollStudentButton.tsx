'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { restoreStudentToOffering } from './actions';

interface ReenrollStudentButtonProps {
  offeringId: string;
  studentId: string;
  studentName: string;
  onChanged?: () => void;
}

/** Restores a withdrawn/dropped/completed enrollment back to `enrolled`. */
export default function ReenrollStudentButton({
  offeringId,
  studentId,
  studentName,
  onChanged,
}: ReenrollStudentButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleRestore = async () => {
    setLoading(true);
    const result = await restoreStudentToOffering(offeringId, studentId);
    setLoading(false);

    if (result.error) {
      notifyError('Could not re-enroll the student', result.error);
      return;
    }

    notifySuccess('Student re-enrolled', `${studentName} is enrolled again.`);
    router.refresh();
    onChanged?.();
  };

  return (
    <Button
      variant="outline"
      size="sm"
      loading={loading}
      onClick={() => void handleRestore()}
    >
      Re-enroll
    </Button>
  );
}
