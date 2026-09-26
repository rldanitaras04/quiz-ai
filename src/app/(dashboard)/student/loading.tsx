import type { JSX } from 'react';

/**
 * Dashboard skeleton: mirrors the real layout (header, four stat cards,
 * upcoming + subjects, performance + quick actions) so the shell never jumps.
 */
export default function StudentDashboardLoading(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="skeleton h-9 w-72 rounded-lg" />
          <div className="skeleton mt-3 h-4 w-96 max-w-full rounded" />
        </div>
        <div className="skeleton h-16 w-56 rounded-[var(--radius-lg)]" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-40 rounded-[var(--radius-lg)]" />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <div className="skeleton h-96 rounded-[var(--radius-lg)]" />
        <div className="skeleton h-96 rounded-[var(--radius-lg)]" />
        <div className="flex flex-col gap-4">
          <div className="skeleton h-96 rounded-[var(--radius-lg)]" />
          <div className="skeleton h-44 rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </div>
  );
}
