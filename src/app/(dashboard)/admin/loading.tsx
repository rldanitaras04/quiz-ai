import type { JSX } from 'react';

/**
 * Dashboard skeleton: mirrors the real layout (header, four stat cards, two
 * wide panels, two three-column rows) so the shell never jumps on load.
 */
export default function AdminDashboardLoading(): JSX.Element {
  return (
    <div
      className="admin-ambient -mx-4 -mt-6 min-h-[70vh] px-4 pb-4 pt-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-8"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="skeleton h-9 w-48 rounded-lg" />
          <div className="skeleton mt-3 h-4 w-72 rounded" />
        </div>
        <div className="skeleton h-10 w-60 rounded-[var(--radius-md)]" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-40 rounded-[var(--radius-lg)]" />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <div className="skeleton h-96 rounded-[var(--radius-lg)] lg:col-span-2" />
        <div className="skeleton h-96 rounded-[var(--radius-lg)] lg:col-span-3" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton h-96 rounded-[var(--radius-lg)]" />
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div key={index} className="skeleton h-56 rounded-[var(--radius-lg)]" />
        ))}
      </div>
    </div>
  );
}
