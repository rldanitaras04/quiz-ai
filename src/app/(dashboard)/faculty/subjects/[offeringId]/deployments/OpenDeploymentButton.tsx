'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import { openDeployment } from '../assessments/[assessmentId]/deploy/actions';

interface OpenDeploymentButtonProps {
  deploymentId: string;
}

export default function OpenDeploymentButton({
  deploymentId,
}: OpenDeploymentButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleOpen = async () => {
    const confirmed = await confirmAction({
      title: 'Open this assessment now?',
      text: 'Students in this section will be notified and can start immediately.',
      confirmText: 'Open now',
    });
    if (!confirmed) return;

    setLoading(true);
    const result = await openDeployment(deploymentId);
    if (result.error) {
      notifyError('Could not open the deployment', result.error);
      setLoading(false);
      return;
    }
    notifySuccess('Assessment opened');
    setLoading(false);
    router.refresh();
  };

  return (
    <Button variant="primary" size="sm" onClick={handleOpen} loading={loading}>
      Open
    </Button>
  );
}
