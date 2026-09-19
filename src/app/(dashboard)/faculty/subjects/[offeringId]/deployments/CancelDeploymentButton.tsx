'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
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
    if (!confirm('Cancel this deployment? Students will no longer be able to start it.')) return;

    setLoading(true);
    setError(null);

    const result = await cancelDeployment(deploymentId);
    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

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
