'use client';

import { useMemo, useSyncExternalStore, type JSX } from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, type ChartOptions } from 'chart.js';
import { Doughnut } from 'react-chartjs-2';
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
} from '@/lib/ui-preferences';
import type { AdminRoleSegment } from '@/app/(dashboard)/admin/actions';

ChartJS.register(ArcElement, Tooltip);

const PALETTE = [
  '#2563eb',
  '#10b981',
  '#8b5cf6',
  '#f59e0b',
  '#ef4444',
  '#0ea5e9',
  '#64748b',
];

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Doughnut of users by primary role with a center total and an HTML legend
 * (label, count, share) matching the dashboard design. Colors come from a
 * fixed palette; center/legend text colors follow the resolved theme.
 */
export default function RoleDistributionChart({
  segments,
  totalUsers,
}: {
  segments: AdminRoleSegment[];
  totalUsers: number | null;
}): JSX.Element {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getThemeServerSnapshot);

  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const centerTotal = (totalUsers ?? total).toLocaleString();

  const centerPlugin = useMemo(
    () => ({
      id: 'centerTotal',
      afterDraw(chart: ChartJS) {
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        const x = (chartArea.left + chartArea.right) / 2;
        const y = (chartArea.top + chartArea.bottom) / 2;
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = readVar('--color-foreground', '#0f172a');
        ctx.font = '700 22px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(centerTotal, x, y - 1);
        ctx.fillStyle = readVar('--color-muted', '#64748b');
        ctx.font = '400 11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('Total Users', x, y + 17);
        ctx.restore();
      },
    }),
    // Recreate on theme flip so the drawn text re-reads the color tokens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, centerTotal]
  );

  const data = useMemo(
    () => ({
      labels: segments.map((segment) => segment.label),
      datasets: [
        {
          data: segments.map((segment) => segment.value),
          backgroundColor: segments.map((_, index) => PALETTE[index % PALETTE.length]),
          borderColor: readVar('--color-surface', '#ffffff'),
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    }),
    // Theme flip changes the border color read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments, theme]
  );

  const options = useMemo<ChartOptions<'doughnut'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.parsed;
              const share = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
              return `${context.label}: ${value.toLocaleString()} (${share}%)`;
            },
          },
        },
      },
    }),
    [total]
  );

  if (segments.length === 0) {
    return (
      <p className="py-14 text-center text-sm text-[var(--color-muted)]">
        Role data is unavailable right now.
      </p>
    );
  }

  return (
    <div>
      <div className="h-52">
        <Doughnut data={data} options={options} plugins={[centerPlugin]} />
      </div>
      <ul className="mt-4 space-y-2">
        {segments.map((segment, index) => {
          const share = total > 0 ? ((segment.value / total) * 100).toFixed(1) : '0.0';
          return (
            <li key={segment.label} className="flex items-center gap-2.5 text-sm">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
                aria-hidden="true"
              />
              <span className="truncate text-[var(--color-foreground)]">{segment.label}</span>
              <span className="ml-auto whitespace-nowrap text-[var(--color-muted)]">
                {segment.value.toLocaleString()}{' '}
                <span className="text-[var(--color-muted-light)]">({share}%)</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
