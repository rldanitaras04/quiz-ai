'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { confirmAction, notifyError, notifyInfo, notifySuccess } from '@/components/ui/alerts';
import { releaseResults } from '../assessments/[assessmentId]/deploy/actions';

interface ReleaseResultsButtonProps {
  deploymentId: string;
}

/**
 * Releases scored results to students. Students only ever see results whose
 * row is `released`, so without this action nothing but an
 * `immediate`-release deployment could ever surface a score.
 */
export default function ReleaseResultsButton({
  deploymentId,
}: ReleaseResultsButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleRelease = async () => {
    const confirmed = await confirmAction({
      title: 'Release results to students?',
      text: 'They will be able to view their scores for this deployment.',
      confirmText: 'Release results',
    });
    if (!confirmed) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    const result = await releaseResults(deploymentId);

    if (result.error) {
      setError(result.error);
      notifyError('Could not release results', result.error);
      setLoading(false);
      return;
    }

    const released = result.released ?? 0;
    const summary =
      released > 0
        ? `Released ${released} result${released === 1 ? '' : 's'}.`
        : 'No pending results to release.';

    setMessage(summary);
    if (released > 0) notifySuccess('Results released', summary);
    else notifyInfo('Nothing to release', summary);

    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-[var(--color-danger)]">{error}</span>}
      {message && <span className="text-xs text-[var(--color-muted)]">{message}</span>}
      <Button variant="secondary" size="sm" onClick={handleRelease} loading={loading}>
        Release Results
      </Button>
    </div>
  );
}
