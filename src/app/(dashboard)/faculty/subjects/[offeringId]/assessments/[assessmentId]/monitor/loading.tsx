import Skeleton from '@/components/ui/Skeleton';
import type { JSX } from 'react';

/** Shape-matching fallback for the live monitor while it streams in. */
export default function MonitorLoading(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading live monitor">
      <div className="mb-6">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
