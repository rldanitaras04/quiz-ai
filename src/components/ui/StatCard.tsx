import type { JSX } from 'react';
import { TrendUp, TrendDown, type Icon } from '@/components/ui/icons';

export interface StatCardTone {
  icon: Icon;
  tile: string;
  spark: string;
}

function Sparkline({ data, color }: { data: number[]; color: string }): JSX.Element {
  const width = 88;
  const height = 30;
  const pad = 3;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = pad + (index * (width - pad * 2)) / Math.max(data.length - 1, 1);
      const y = height - pad - ((value - min) / range) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-[30px] w-[88px] shrink-0"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Delta({
  deltaPct,
  deltaNote,
}: {
  deltaPct: number | null;
  deltaNote: string | null;
}): JSX.Element | null {
  if (deltaPct === null && deltaNote) {
    return <span className="text-sm font-semibold text-[var(--color-primary)]">{deltaNote}</span>;
  }
  if (deltaPct === null) return null;

  if (deltaPct > 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
        <TrendUp className="h-4 w-4" weight="bold" />
        +{deltaPct}%
        <span className="hidden text-xs font-normal text-[var(--color-muted)] sm:inline">vs last month</span>
      </span>
    );
  }
  if (deltaPct < 0) {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-600 dark:text-red-400">
        <TrendDown className="h-4 w-4" weight="bold" />
        {deltaPct}%
        <span className="hidden text-xs font-normal text-[var(--color-muted)] sm:inline">vs last month</span>
      </span>
    );
  }
  return (
    <span className="text-sm font-medium text-[var(--color-muted)]">No change vs last month</span>
  );
}

export interface StatCardProps {
  label: string;
  value: number | null;
  tone: StatCardTone;
  /** Small honest note under the value (e.g. "This semester"). */
  caption?: string | null;
  /** Change vs. last month in percent; null when last month had no data. */
  deltaPct?: number | null;
  /** Fallback note (e.g. "+3 this month") when deltaPct is null. */
  deltaNote?: string | null;
  /** One entry per month for the visible window (oldest first); null = unavailable. */
  series?: number[] | null;
}

/**
 * One dashboard summary card: real value, honest month-over-month delta, and a
 * monthly sparkline. A null value or series renders as "unavailable" rather
 * than a fabricated number. Shared by the admin and faculty dashboards.
 */
export default function StatCard({
  label,
  value,
  tone,
  caption = null,
  deltaPct = null,
  deltaNote = null,
  series = null,
}: StatCardProps): JSX.Element {
  const Icon = tone.icon;

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone.tile}`}>
          <Icon className="h-6 w-6" weight="regular" />
        </div>
        <p className="pt-1 text-right text-sm font-medium text-[var(--color-muted)]">{label}</p>
      </div>

      <p className="mt-4 text-3xl font-bold tracking-tight text-[var(--color-foreground)]">
        {value === null ? '—' : value.toLocaleString()}
      </p>

      {caption && (
        <p className="mt-1 text-xs font-medium text-[var(--color-muted)]">{caption}</p>
      )}

      <div className="mt-3 flex items-end justify-between gap-3">
        <Delta deltaPct={deltaPct} deltaNote={deltaNote} />
        {series && series.length > 1 && <Sparkline data={series} color={tone.spark} />}
      </div>
    </div>
  );
}
