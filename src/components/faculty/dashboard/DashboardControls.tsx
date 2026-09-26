'use client';

import type { JSX } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Select from '@/components/ui/Select';

interface DashboardControlsProps {
  semesters: Array<{ id: string; label: string }>;
  selectedSemesterId: string | null;
  rangeMonths: number;
}

/**
 * Semester + time-range selectors for the faculty dashboard. Both filter real
 * data via `?semester=` / `?range=` search params, so the state is shareable
 * and survives refresh. Renders nothing when the caller has no semesters.
 */
export default function DashboardControls({
  semesters,
  selectedSemesterId,
  rangeMonths,
}: DashboardControlsProps): JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (semesters.length === 0) return null;

  const apply = (next: { semester?: string; range?: number }): void => {
    const params = new URLSearchParams(searchParams.toString());
    if (next.semester !== undefined) {
      if (next.semester) params.set('semester', next.semester);
      else params.delete('semester');
    }
    if (next.range !== undefined) {
      if (next.range !== 6) params.set('range', String(next.range));
      else params.delete('range');
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        id="faculty-semester-select"
        aria-label="Semester"
        className="w-auto min-w-48 text-sm"
        value={selectedSemesterId ?? ''}
        onChange={(event) => apply({ semester: event.target.value })}
      >
        {semesters.map((semester) => (
          <option key={semester.id} value={semester.id}>
            {semester.label}
          </option>
        ))}
      </Select>
      <Select
        id="faculty-range-select"
        aria-label="Time range"
        className="w-auto text-sm"
        value={String(rangeMonths)}
        onChange={(event) => apply({ range: Number(event.target.value) })}
      >
        <option value="3">Last 3 months</option>
        <option value="6">Last 6 months</option>
        <option value="12">Last 12 months</option>
      </Select>
    </div>
  );
}
