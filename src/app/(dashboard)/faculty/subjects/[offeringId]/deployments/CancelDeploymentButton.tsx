'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { cancelDeployment } from '../assessments/[assessmentId]/deploy/actions';

interface CancelDeploymentButtonProps {
  deploymentId: string;
}

export default function CancelDeploymentButton({
  deploymentId,
}: CancelDeploymentButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCancel = async () => {
    const confirmed = await confirmAction({
      title: 'Cancel this deployment?',
      text: 'Students will no longer be able to start it.',
      confirmText: 'Cancel deployment',
      cancelText: 'Keep it',
      destructive: true,
    });
    if (!confirmed) return;

    setLoading(true);
    setError(null);

    const result = await cancelDeployment(deploymentId);
    if (result.error) {
      setError(result.error);
      notifyError('Could not cancel the deployment', result.error);
      setLoading(false);
      return;
    }

    notifySuccess('Deployment cancelled');
    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCancel}
        loading={loading}
      >
        Cancel
      </Button>
    </div>
  );
}
