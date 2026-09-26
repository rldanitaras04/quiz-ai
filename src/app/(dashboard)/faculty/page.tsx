import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import StatCard, { type StatCardTone } from '@/components/ui/StatCard';
import { Books, ClipboardText, Clock, Users } from '@/components/ui/icons';
import AssessmentTrendsChart from '@/components/admin/dashboard/AssessmentTrendsChart';
import { getFacultyDashboardData, type FacultyStatCard } from './actions';
import DashboardControls from '@/components/faculty/dashboard/DashboardControls';
import ActionRequiredPanel from '@/components/faculty/dashboard/ActionRequiredPanel';
import UpcomingAssessmentsPanel from '@/components/faculty/dashboard/UpcomingAssessmentsPanel';
import RecentActivityPanel from '@/components/faculty/dashboard/RecentActivityPanel';
import QuickActionsPanel from '@/components/faculty/dashboard/QuickActionsPanel';
import { Panel, PanelNote } from '@/components/faculty/dashboard/Panel';

const TONES: Record<FacultyStatCard['key'], StatCardTone> = {
  subjects: {
    icon: Books,
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    spark: '#2563eb',
  },
  assessments: {
    icon: ClipboardText,
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
    spark: '#7c3aed',
  },
  students: {
    icon: Users,
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    spark: '#16a34a',
  },
  toCheck: {
    icon: Clock,
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    spark: '#d97706',
  },
};

/**
 * Faculty dashboard. Plain string hrefs only: importing the nav config here
 * would value-import @phosphor-icons/react, which calls createContext at
 * module scope and is illegal in a Server Component.
 */
export default async function FacultyDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ semester?: string; range?: string }>;
}): Promise<JSX.Element> {
  const params = await searchParams;
  const semesterId =
    typeof params.semester === 'string' && params.semester ? params.semester : null;
  const rangeValue = Number(params.range);
  const rangeMonths = rangeValue === 3 || rangeValue === 12 ? rangeValue : 6;

  const data = await getFacultyDashboardData({ semesterId, rangeMonths });

  const welcome = data.firstName ? `Welcome back, ${data.firstName}` : 'Welcome back';
  const chartTotal = data.trends
    ? data.trends.assessmentsCreated.reduce((sum, value) => sum + value, 0) +
      data.trends.examsConducted.reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <div>
      <PageHeader
        title={welcome}
        description="Here's what's happening across your subjects."
        actions={
          <DashboardControls
            semesters={data.semesterOptions}
            selectedSemesterId={data.selectedSemesterId}
            rangeMonths={data.rangeMonths}
          />
        }
      />

      {!data.hasAssignments ? (
        <EmptyState
          title="No subjects assigned"
          description="Contact your administrator to get assigned to subjects."
        />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {data.statCards.map((card) => (
              <StatCard
                key={card.key}
                label={card.label}
                value={card.value}
                tone={TONES[card.key]}
                caption={card.caption}
                deltaPct={card.deltaPct}
                deltaNote={card.deltaNote}
                series={card.series}
              />
            ))}
          </div>

          {/* Constitution §13 priority 1 — hidden when there is nothing to do */}
          <ActionRequiredPanel items={data.actionItems} className="mt-4" />

          {/* Desktop columns are pinned with col-start/row-start; DOM order
              (upcoming → chart → recent) is the mobile stack order, which
              follows the constitution's priority: upcoming, performance,
              recent activity. */}
          <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
            <div className="flex flex-col gap-4 lg:col-span-4 lg:col-start-9 lg:row-start-1">
              <UpcomingAssessmentsPanel items={data.upcoming} />
              <QuickActionsPanel />
            </div>

            <Panel
              title="Assessment Activity"
              action={
                <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)]">
                  Last {data.rangeMonths} months
                </span>
              }
              className="lg:col-span-4 lg:col-start-1 lg:row-start-1"
            >
              {!data.trends ? (
                <PanelNote>Trend data is unavailable right now.</PanelNote>
              ) : chartTotal === 0 ? (
                <PanelNote>
                  No assessments or exams recorded in the last {data.rangeMonths} months.
                </PanelNote>
              ) : (
                <AssessmentTrendsChart trends={data.trends} />
              )}
            </Panel>

            <RecentActivityPanel
              items={data.recentActivity}
              className="lg:col-span-4 lg:col-start-5 lg:row-start-1"
            />
          </div>
        </>
      )}
    </div>
  );
}
