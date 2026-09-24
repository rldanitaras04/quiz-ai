'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { closeDeployment } from '../assessments/[assessmentId]/deploy/actions';

interface CloseDeploymentButtonProps {
  deploymentId: string;
}

export default function CloseDeploymentButton({
  deploymentId,
}: CloseDeploymentButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClose = async () => {
    const confirmed = await confirmAction({
      title: 'Close this assessment now?',
      text: 'Students will no longer be able to start new attempts. In-progress attempts follow the exam rules.',
      confirmText: 'Close now',
      cancelText: 'Keep open',
      destructive: true,
    });
    if (!confirmed) return;

    setLoading(true);
    const result = await closeDeployment(deploymentId);
    if (result.error) {
      notifyError('Could not close the deployment', result.error);
      setLoading(false);
      return;
    }
    notifySuccess('Assessment closed');
    setLoading(false);
    router.refresh();
  };

  return (
    <Button variant="secondary" size="sm" onClick={handleClose} loading={loading}>
      Close
    </Button>
  );
}
