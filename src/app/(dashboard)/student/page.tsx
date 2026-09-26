import type { JSX } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import StatCard, { type StatCardTone } from '@/components/ui/StatCard';
import {
  Bell,
  Books,
  CalendarBlank,
  ChartBar,
  CheckCircle,
  ClipboardText,
  type Icon,
} from '@/components/ui/icons';
import PerformanceChart from '@/components/student/dashboard/PerformanceChart';
import {
  getStudentDashboardData,
  type StudentSubjectItem,
  type StudentUpcomingItem,
} from './actions';

const TONES: Record<'subjects' | 'upcoming' | 'completed' | 'average', StatCardTone> = {
  subjects: {
    icon: Books,
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
    spark: '#2563eb',
  },
  upcoming: {
    icon: ClipboardText,
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
    spark: '#f59e0b',
  },
  completed: {
    icon: CheckCircle,
    tile: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
    spark: '#16a34a',
  },
  average: {
    icon: ChartBar,
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
    spark: '#7c3aed',
  },
};

/** Date-tile colors keyed by the deployment's real status variant. */
const DATE_TILES: Record<'success' | 'warning' | 'danger' | 'info' | 'default', string> = {
  info: 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  warning: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  danger: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400',
  default: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400',
};

const SUBJECT_TILES = [
  'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400',
];

const QUICK_ACTIONS: Array<{
  label: string;
  href: string;
  icon: Icon;
  tile: string;
}> = [
  {
    label: 'My Subjects',
    href: '/student/subjects',
    icon: Books,
    tile: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  },
  {
    label: 'Take Assessment',
    href: '/student/assessments',
    icon: ClipboardText,
    tile: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  },
  {
    label: 'View Results',
    href: '/student/results',
    icon: ChartBar,
    tile: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  },
  {
    label: 'Notifications',
    href: '/notifications',
    icon: Bell,
    tile: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  },
];

function greetingFor(firstName: string): string {
  const hour = new Date().getHours();
  const who = firstName ? `, ${firstName}` : '';
  if (hour < 12) return `Good morning${who}!`;
  if (hour < 17) return `Good afternoon${who}!`;
  if (hour < 22) return `Good evening${who}!`;
  return `Good day${who}!`;
}

function UpcomingRow({ item }: { item: StudentUpcomingItem }): JSX.Element {
  return (
    <Link
      href={`/student/assessments/${item.assessmentId}`}
      className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <div
        className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-[var(--radius-md)] ${DATE_TILES[item.status.variant]}`}
        aria-hidden="true"
      >
        <span className="text-[10px] font-bold leading-none opacity-80">{item.monthLabel}</span>
        <span className="text-base font-bold leading-tight">{item.dayLabel}</span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
          {item.subjectCode}
          {item.sectionLabel ? ` · ${item.sectionLabel}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Badge variant={item.status.variant}>{item.status.label}</Badge>
        <span className="text-xs text-[var(--color-muted)]">{item.timeLabel}</span>
      </div>
    </Link>
  );
}

function SubjectRow({ item, index }: { item: StudentSubjectItem; index: number }): JSX.Element {
  return (
    <Link
      href={`/student/subjects/${item.offeringId}`}
      className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2.5 transition-colors hover:bg-[var(--color-surface-hover)]"
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${SUBJECT_TILES[index % SUBJECT_TILES.length]}`}
        aria-hidden="true"
      >
        <Books className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
          {item.code}
          {item.sectionLabel ? ` · ${item.sectionLabel}` : ''}
        </p>
      </div>
      <Badge variant="info">Enrolled</Badge>
    </Link>
  );
}

function SectionHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-[var(--color-foreground)]">{title}</h2>
      <Link
        href={href}
        className="text-sm font-medium text-[var(--color-primary)] hover:underline"
      >
        {linkLabel}
      </Link>
    </div>
  );
}

/**
 * Student dashboard. Every figure comes from real rows (enrollments, open
 * deployment windows, released results only) — nothing here is seeded. Hrefs
 * are plain strings: importing the nav config would value-import
 * @phosphor-icons/react, which is illegal in a Server Component.
 */
export default async function StudentDashboardPage(): Promise<JSX.Element> {
  const data = await getStudentDashboardData();
  if (!data) redirect('/login');

  const { sectionLabel, yearLevelName, semesterLabel } = data.context;
  const contextActions =
    sectionLabel || semesterLabel ? (
      <div className="text-right">
        {sectionLabel && (
          <div>
            <p className="text-sm font-semibold text-[var(--color-foreground)]">{sectionLabel}</p>
            {yearLevelName && (
              <p className="text-xs text-[var(--color-muted)]">{yearLevelName}</p>
            )}
          </div>
        )}
        {semesterLabel && (
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--color-muted)]">
            <CalendarBlank className="h-3.5 w-3.5" />
            {semesterLabel}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <div>
      <PageHeader
        title={greetingFor(data.firstName)}
        description="Stay on track with your classes and upcoming assessments."
        actions={contextActions}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="My Subjects"
          value={data.stats.subjects.value}
          tone={TONES.subjects}
          caption={data.stats.subjects.caption}
        />
        <StatCard
          label="Upcoming Assessments"
          value={data.stats.upcoming.value}
          tone={TONES.upcoming}
          caption={data.stats.upcoming.caption}
        />
        <StatCard
          label="Completed Assessments"
          value={data.stats.completed.value}
          tone={TONES.completed}
          caption={data.stats.completed.caption}
        />
        <StatCard
          label="Average Score"
          value={data.stats.average.value}
          tone={TONES.average}
          caption={data.stats.average.caption}
        />
      </div>

      {/* Main grid: upcoming | subjects | performance + quick actions */}
      <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardContent>
            <SectionHeader
              title="Upcoming Assessments"
              href="/student/assessments"
              linkLabel="View All"
            />
            {data.upcoming.length > 0 ? (
              <div className="mt-3 space-y-1">
                {data.upcoming.map((item) => (
                  <UpcomingRow key={item.id} item={item} />
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState
                  title="No upcoming assessments"
                  description="When assessments are published for your subjects, they will appear here."
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <SectionHeader title="My Subjects" href="/student/subjects" linkLabel="View All" />
            {data.subjects.length > 0 ? (
              <div className="mt-3 space-y-1">
                {data.subjects.map((item, index) => (
                  <SubjectRow key={item.offeringId} item={item} index={index} />
                ))}
              </div>
            ) : (
              <div className="mt-4">
                <EmptyState
                  title="No enrolled subjects"
                  description="Your subjects will appear here once you are enrolled."
                />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
                  Assessment Performance
                </h2>
                <span className="shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)]">
                  {data.performance.scopeLabel}
                </span>
              </div>
              {data.performance.values.length > 0 ? (
                <div className="mt-4">
                  <PerformanceChart
                    labels={data.performance.labels}
                    values={data.performance.values}
                  />
                </div>
              ) : (
                <div className="mt-4">
                  <EmptyState
                    title="No released results yet"
                    description="Your scores will be charted here once results are released."
                  />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Quick Actions</h2>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {QUICK_ACTIONS.map((action) => {
                  const ActionIcon = action.icon;
                  return (
                    <Link
                      key={action.label}
                      href={action.href}
                      className="flex flex-col items-center gap-1.5 rounded-[var(--radius-lg)] border border-[var(--color-border)] p-2.5 text-center transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-surface-hover)]"
                    >
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] ${action.tile}`}
                        aria-hidden="true"
                      >
                        <ActionIcon className="h-5 w-5" />
                      </span>
                      <span className="text-[11px] font-medium leading-tight text-[var(--color-foreground)]">
                        {action.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
