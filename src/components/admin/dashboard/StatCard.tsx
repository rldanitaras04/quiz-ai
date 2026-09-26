import type { JSX } from 'react';
import { Users, BookOpen, ClipboardText, Exam } from '@/components/ui/icons';
import UiStatCard, { type StatCardTone } from '@/components/ui/StatCard';
import type { AdminStatCard } from '@/app/(dashboard)/admin/actions';

const TONES: Record<AdminStatCard['key'], StatCardTone> = {
  totalUsers: {
    icon: Users,
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    spark: '#2563eb',
  },
  totalSubjects: {
    icon: BookOpen,
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    spark: '#16a34a',
  },
  totalAssessments: {
    icon: ClipboardText,
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
    spark: '#7c3aed',
  },
  completedExams: {
    icon: Exam,
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    spark: '#d97706',
  },
};

/**
 * Admin stat card adapter: maps the dashboard's `key` to its tone and delegates
 * rendering to the shared `ui/StatCard` so both dashboards stay pixel-identical.
 */
export default function StatCard({ card }: { card: AdminStatCard }): JSX.Element {
  return (
    <UiStatCard
      label={card.label}
      value={card.value}
      tone={TONES[card.key]}
      deltaPct={card.deltaPct}
      deltaNote={card.deltaNote}
      series={card.series}
    />
  );
}
