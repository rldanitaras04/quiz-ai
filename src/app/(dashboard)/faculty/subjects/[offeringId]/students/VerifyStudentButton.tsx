'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { verifyStudentIdentity } from './actions';

interface VerifyStudentButtonProps {
  offeringId: string;
  studentId: string;
  studentName: string;
  onChanged?: () => void;
}

/**
 * Faculty-authorized manual identity verification (scope §5): grants the
 * `verified` status that deployments with `requires_identity_verification`
 * check before an exam starts.
 *
 * No photo or biometric data is captured or stored — faculty attest against
 * the student's institutional ID, and the confirm copy says exactly what is
 * recorded (the status only).
 */
export default function VerifyStudentButton({
  offeringId,
  studentId,
  studentName,
  onChanged,
}: VerifyStudentButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleVerify = async () => {
    const confirmed = await confirmAction({
      title: `Verify ${studentName}'s identity?`,
      text: 'Confirm you have checked this student against their institutional ID. Only the verification status is recorded — no photo or biometric data is stored. This authorizes them for exams that require identity verification.',
      confirmText: 'Verify identity',
    });
    if (!confirmed) return;

    setLoading(true);
    const result = await verifyStudentIdentity(offeringId, studentId);
    setLoading(false);

    if (result.error) {
      notifyError('Could not verify identity', result.error);
      return;
    }

    notifySuccess(
      'Identity verified',
      result.alreadyVerified
        ? `${studentName} was already verified.`
        : `${studentName} can now start exams that require verification.`
    );
    router.refresh();
    onChanged?.();
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      loading={loading}
      onClick={() => void handleVerify()}
    >
      Verify identity
    </Button>
  );
}
