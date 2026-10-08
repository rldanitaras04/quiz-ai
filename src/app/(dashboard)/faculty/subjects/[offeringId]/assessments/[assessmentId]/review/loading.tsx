import Skeleton from '@/components/ui/Skeleton';
import type { JSX } from 'react';

/** Shape-matching fallback for the identification review queue. */
export default function ReviewLoading(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading review queue">
      <div className="mb-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}
