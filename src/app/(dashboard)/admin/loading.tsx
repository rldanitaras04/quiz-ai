import Skeleton from '@/components/ui/Skeleton';
import type { JSX } from 'react';

/**
 * Segment fallback while a route streams in. Deliberately NEUTRAL (title +
 * two generic blocks): this boundary also covers child routes like
 * `/admin/users`, so guessing the dashboard's stat-card shape here made every
 * navigation flash a layout the target screen won't have. Routes that want a
 * shape-matching skeleton ship their own `loading.tsx` next to `page.tsx`.
 */
export default function AdminRouteLoading(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading page">
      <div className="mb-6">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-3 h-4 w-80 max-w-full" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    </div>
  );
}
