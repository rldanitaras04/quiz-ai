import Skeleton from '@/components/ui/Skeleton';
import type { JSX } from 'react';

/** Shape-matching fallback for the proctoring management page. */
export default function ProctoringLoading(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading proctoring">
      <div className="mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    </div>
  );
}
