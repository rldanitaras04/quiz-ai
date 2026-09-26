'use client';

import { useMemo, useSyncExternalStore, type JSX } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend,
  type ChartData,
  type ChartDataset,
  type ChartOptions,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
} from '@/lib/ui-preferences';
import type { AdminTrendsData } from '@/app/(dashboard)/admin/actions';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  LineController,
  Tooltip,
  Legend
);

const BLUE = '#2563eb';
const GREEN = '#16a34a';
const AMBER = '#f59e0b';

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Mixed bar + line chart of the last six months: assessments created and
 * exams conducted (bars, left axis) plus average score (line, right axis %).
 * Axis/legend colors are read from the CSS tokens so the chart follows the
 * resolved light/dark theme.
 */
export default function AssessmentTrendsChart({
  trends,
}: {
  trends: AdminTrendsData;
}): JSX.Element {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getThemeServerSnapshot);

  const data = useMemo<ChartData<'bar'>>(() => {
    // Mixed chart: bar datasets with one line dataset on the right axis.
    const datasets: Array<ChartDataset<'bar' | 'line'>> = [
      {
        type: 'bar',
        label: 'Assessments Created',
        data: trends.assessmentsCreated,
        backgroundColor: BLUE,
        borderRadius: 4,
        maxBarThickness: 20,
        order: 2,
      },
      {
        type: 'bar',
        label: 'Exams Conducted',
        data: trends.examsConducted,
        backgroundColor: GREEN,
        borderRadius: 4,
        maxBarThickness: 20,
        order: 2,
      },
      {
        type: 'line',
        label: 'Average Score',
        data: trends.averageScore,
        borderColor: AMBER,
        backgroundColor: AMBER,
        borderWidth: 2,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        spanGaps: true,
        yAxisID: 'y1',
        order: 1,
      },
    ];
    return { labels: trends.labels, datasets } as unknown as ChartData<'bar'>;
  }, [trends]);

  const options = useMemo<ChartOptions<'bar'>>(() => {
    const muted = readVar('--color-muted', '#64748b');
    const grid = readVar('--color-border', '#e2e8f0');
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: {
            color: muted,
            boxWidth: 10,
            boxHeight: 10,
            padding: 16,
            font: { size: 11 },
          },
        },
        tooltip: {
          callbacks: {
            label(context) {
              const label = context.dataset.label ?? '';
              if (context.dataset.yAxisID === 'y1') {
                return context.parsed.y === null ? `${label}: —` : `${label}: ${context.parsed.y}%`;
              }
              return `${label}: ${context.parsed.y}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: muted, font: { size: 11 } },
          border: { color: grid },
        },
        y: {
          beginAtZero: true,
          position: 'left',
          grid: { color: grid },
          ticks: { color: muted, precision: 0, font: { size: 11 } },
          border: { display: false },
        },
        y1: {
          beginAtZero: true,
          max: 100,
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: {
            color: muted,
            stepSize: 25,
            callback: (value) => `${value}%`,
            font: { size: 11 },
          },
          border: { display: false },
        },
      },
    };
    // Re-create options when the theme flips so axis/legend colors re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return (
    <div className="h-72">
      <Bar data={data} options={options} />
    </div>
  );
}
