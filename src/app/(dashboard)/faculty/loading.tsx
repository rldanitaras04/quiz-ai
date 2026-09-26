import type { JSX } from 'react';

/**
 * Dashboard skeleton: mirrors the real layout (header, four stat cards, right
 * column with two panels, chart + activity) so the shell never jumps on load.
 */
export default function FacultyDashboardLoading(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading dashboard">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="skeleton h-9 w-64 rounded-lg" />
          <div className="skeleton mt-3 h-4 w-80 rounded" />
        </div>
        <div className="skeleton h-10 w-72 rounded-[var(--radius-md)]" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-40 rounded-[var(--radius-lg)]" />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-4 lg:col-span-4 lg:col-start-9 lg:row-start-1">
          <div className="skeleton h-72 rounded-[var(--radius-lg)]" />
          <div className="skeleton h-56 rounded-[var(--radius-lg)]" />
        </div>
        <div className="skeleton h-96 rounded-[var(--radius-lg)] lg:col-span-4 lg:col-start-1 lg:row-start-1" />
        <div className="skeleton h-96 rounded-[var(--radius-lg)] lg:col-span-4 lg:col-start-5 lg:row-start-1" />
      </div>
    </div>
  );
}
