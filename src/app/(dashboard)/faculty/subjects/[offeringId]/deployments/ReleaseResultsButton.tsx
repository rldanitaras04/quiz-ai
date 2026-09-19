'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
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
    if (
      !confirm(
        'Release results to students? They will be able to view their scores for this deployment.'
      )
    ) {
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);

    const result = await releaseResults(deploymentId);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setMessage(
      result.released && result.released > 0
        ? `Released ${result.released} result${result.released === 1 ? '' : 's'}.`
        : 'No pending results to release.'
    );
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
