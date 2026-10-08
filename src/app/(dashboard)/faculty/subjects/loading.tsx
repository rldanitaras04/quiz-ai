import Skeleton from '@/components/ui/Skeleton';
import type { JSX } from 'react';

/** Shape-matching fallback for the subject list while it streams in. */
export default function SubjectsLoading(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading subjects">
      <div className="mb-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
