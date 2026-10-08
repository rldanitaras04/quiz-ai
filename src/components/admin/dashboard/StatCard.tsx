import type { JSX } from 'react';
import { Users, BookOpen, ClipboardText, Exam } from '@/components/ui/icons';
import UiStatCard, { STAT_TILE_ACCENT, type StatCardTone } from '@/components/ui/StatCard';
import type { AdminStatCard } from '@/app/(dashboard)/admin/actions';

const ICONS: Record<AdminStatCard['key'], StatCardTone['icon']> = {
  totalUsers: Users,
  totalSubjects: BookOpen,
  totalAssessments: ClipboardText,
  completedExams: Exam,
};

/**
 * Admin stat card adapter: every tile uses the one shared accent so the four
 * figures read as a single summary strip rather than four competing colours.
 * The per-card sparkline is intentionally not forwarded — the dashboard trend
 * panel already carries the month-over-month shape, so repeating it four times
 * only added noise.
 */
export default function StatCard({ card }: { card: AdminStatCard }): JSX.Element {
  return (
    <UiStatCard
      label={card.label}
      value={card.value}
      tone={{ icon: ICONS[card.key], tile: STAT_TILE_ACCENT }}
      deltaPct={card.deltaPct}
      deltaNote={card.deltaNote}
    />
  );
}
