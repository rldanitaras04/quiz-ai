'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import { deleteSourceMaterial } from './actions';

interface DeleteSourceButtonProps {
  sourceMaterialId: string;
  offeringId: string;
  title: string;
}

export default function DeleteSourceButton({
  sourceMaterialId,
  offeringId,
  title,
}: DeleteSourceButtonProps): JSX.Element {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (!confirm(`Remove "${title}"? This cannot be undone.`)) return;

    setLoading(true);
    setError(null);

    const result = await deleteSourceMaterial(sourceMaterialId, offeringId);

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setLoading(false);
    router.refresh();
  };

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="max-w-[220px] text-xs text-[var(--color-danger)]">{error}</span>
      )}
      <Button variant="ghost" size="sm" onClick={handleDelete} loading={loading}>
        Remove
      </Button>
    </div>
  );
}
