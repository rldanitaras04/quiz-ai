'use client';

import { useMemo, useSyncExternalStore, type JSX } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
} from '@/lib/ui-preferences';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

const TICK_LIMIT = 12;

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function truncate(label: string): string {
  return label.length > TICK_LIMIT ? `${label.slice(0, TICK_LIMIT - 1)}…` : label;
}

// Score above each bar, drawn at paint time so it always matches the live theme.
const valueLabelsPlugin: Plugin<'bar'> = {
  id: 'studentScoreLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const values = chart.data.datasets[0]?.data ?? [];
    ctx.save();
    ctx.fillStyle = readVar('--color-muted', '#64748b');
    ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    chart.getDatasetMeta(0).data.forEach((bar, index) => {
      const value = values[index];
      if (value == null) return;
      ctx.fillText(`${value}`, bar.x, bar.y - 4);
    });
    ctx.restore();
  },
};

/**
 * Bar chart of released assessment scores (0–100). Bars alternate the two brand
 * colors, and every color — bars, axes, grid, labels, tooltip — is read from
 * the CSS design tokens so the chart follows the resolved light/dark theme.
 */
export default function PerformanceChart({
  labels,
  values,
}: {
  labels: string[];
  values: number[];
}): JSX.Element {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getThemeServerSnapshot);

  const data = useMemo<ChartData<'bar'>>(
    () => {
      const primary = readVar('--color-primary', '#2563eb');
      const success = readVar('--color-success', '#16a34a');
      return {
        labels,
        datasets: [
          {
            label: 'Score',
            data: values,
            backgroundColor: values.map((_, index) => (index % 2 === 0 ? primary : success)),
            borderRadius: 4,
            maxBarThickness: 32,
          },
        ],
      };
    },
    // Re-read the tokens whenever the theme flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, values, theme]
  );

  const options = useMemo<ChartOptions<'bar'>>(() => {
    const muted = readVar('--color-muted', '#64748b');
    const grid = readVar('--color-border', '#e2e8f0');
    const surface = readVar('--color-surface', '#ffffff');
    const foreground = readVar('--color-foreground', '#0f172a');
    const border = readVar('--color-border', '#e2e8f0');
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: surface,
          titleColor: foreground,
          bodyColor: foreground,
          borderColor: border,
          borderWidth: 1,
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            title(items) {
              const index = items[0]?.dataIndex ?? 0;
              return labels[index] ?? '';
            },
            label(context) {
              return `Score: ${context.parsed.y}%`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: muted,
            font: { size: 11 },
            maxRotation: 0,
            callback(value) {
              const index = typeof value === 'number' ? value : Number(value);
              return truncate(labels[index] ?? '');
            },
          },
          border: { color: grid },
        },
        y: {
          beginAtZero: true,
          max: 100,
          grid: { color: grid },
          ticks: {
            color: muted,
            stepSize: 25,
            font: { size: 11 },
            callback(value) {
              return `${value}%`;
            },
          },
          border: { display: false },
        },
      },
    };
    // Re-create options when the theme flips so axis/tooltip colors re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  return (
    <div className="h-64">
      <Bar data={data} options={options} plugins={[valueLabelsPlugin]} />
    </div>
  );
}
