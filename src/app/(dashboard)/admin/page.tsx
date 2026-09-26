import type { ComponentProps, JSX, ReactNode } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Books,
  Buildings,
  CalendarCheck,
  CheckCircle,
  ChalkboardTeacher,
  ClipboardText,
  Exam,
  FileText,
  Gear,
  GraduationCap,
  NotePencil,
  Pulse,
  Question,
  Robot,
  ShieldCheck,
  Stack,
  SquaresFour,
  Student,
  UserPlus,
  Users,
  UsersFour,
  WarningCircle,
  type Icon,
} from '@/components/ui/icons';
import { getAdminDashboardData } from './actions';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import StatCard from '@/components/admin/dashboard/StatCard';
import AssessmentTrendsChart from '@/components/admin/dashboard/AssessmentTrendsChart';
import RoleDistributionChart from '@/components/admin/dashboard/RoleDistributionChart';

const TILE = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
} as const;

type BadgeVariant = ComponentProps<typeof Badge>['variant'];

interface EntityMeta {
  label: string;
  icon: Icon;
  tile: string;
  badge: BadgeVariant;
}

const ENTITY_META: Record<string, EntityMeta> = {
  profile: { label: 'User Profile', icon: UserPlus, tile: TILE.green, badge: 'success' },
  user_role: { label: 'User Role', icon: Users, tile: TILE.blue, badge: 'info' },
  student_profile: { label: 'Student Profile', icon: Student, tile: TILE.green, badge: 'success' },
  faculty_profile: { label: 'Faculty Profile', icon: ChalkboardTeacher, tile: TILE.green, badge: 'success' },
  subject: { label: 'Subject', icon: BookOpen, tile: TILE.blue, badge: 'info' },
  subject_offering: { label: 'Subject Offering', icon: Books, tile: TILE.blue, badge: 'info' },
  faculty_assignment: { label: 'Faculty Assignment', icon: UsersFour, tile: TILE.violet, badge: 'outline' },
  enrollment: { label: 'Enrollment', icon: UsersFour, tile: TILE.green, badge: 'success' },
  academic_year: { label: 'Academic Year', icon: CalendarCheck, tile: TILE.amber, badge: 'warning' },
  semester: { label: 'Semester', icon: CalendarCheck, tile: TILE.amber, badge: 'warning' },
  program: { label: 'Program', icon: GraduationCap, tile: TILE.amber, badge: 'warning' },
  year_level: { label: 'Year Level', icon: SquaresFour, tile: TILE.amber, badge: 'warning' },
  section: { label: 'Section', icon: SquaresFour, tile: TILE.amber, badge: 'warning' },
  assessment: { label: 'Assessment', icon: ClipboardText, tile: TILE.violet, badge: 'outline' },
  assessment_version: { label: 'Assessment Version', icon: ClipboardText, tile: TILE.violet, badge: 'outline' },
  assessment_deployment: { label: 'Exam Deployment', icon: FileText, tile: TILE.violet, badge: 'outline' },
  exam_attempt: { label: 'Exam Attempt', icon: Exam, tile: TILE.violet, badge: 'outline' },
  question: { label: 'Question', icon: Question, tile: TILE.blue, badge: 'info' },
  question_bank: { label: 'Question Bank Item', icon: Question, tile: TILE.blue, badge: 'info' },
  system_settings: { label: 'System Settings', icon: Gear, tile: TILE.slate, badge: 'default' },
  source_material: { label: 'Source Material', icon: FileText, tile: TILE.blue, badge: 'info' },
  student_response: { label: 'Student Response', icon: NotePencil, tile: TILE.green, badge: 'success' },
  assessment_exception: { label: 'Exam Exception', icon: WarningCircle, tile: TILE.amber, badge: 'warning' },
  assessment_generation_job: { label: 'AI Generation Job', icon: Robot, tile: TILE.violet, badge: 'outline' },
};

const DEFAULT_META: EntityMeta = {
  label: 'System Record',
  icon: Pulse,
  tile: TILE.slate,
  badge: 'default',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  delete: 'Deleted',
  publish: 'Published',
  approve: 'Approved',
  submit: 'Submitted',
  score: 'Scored',
  release: 'Released',
  invalidate: 'Invalidated',
  login: 'Signed in',
  logout: 'Signed out',
};

const DEPLOYMENT_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: 'Draft', variant: 'default' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  active: { label: 'Ongoing', variant: 'success' },
  closed: { label: 'Closed', variant: 'danger' },
  archived: { label: 'Archived', variant: 'outline' },
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <Card className={className}>
      <CardHeader className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-[var(--color-foreground)]">{title}</h2>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PanelNote({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="py-12 text-center text-sm text-[var(--color-muted)]">{children}</p>
  );
}

function ViewAllLink({ href }: { href: string }): JSX.Element {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-[var(--color-primary)] transition-colors hover:text-[var(--color-primary-hover)]"
    >
      View All
    </Link>
  );
}

export default async function AdminDashboardPage(): Promise<JSX.Element> {
  const data = await getAdminDashboardData();

  const today = new Date();
  const fmtDate = (date: Date): string =>
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const rangeLabel = `${fmtDate(new Date(today.getFullYear(), today.getMonth(), 1))} – ${fmtDate(
    new Date(today.getFullYear(), today.getMonth() + 1, 0)
  )}`;

  const activityTitle = (action: string, entityType: string): string => {
    if (action === 'login') return 'User signed in';
    if (action === 'logout') return 'User signed out';
    const meta = ENTITY_META[entityType] ?? DEFAULT_META;
    const verb = ACTION_LABELS[action] ?? action;
    return `${verb} ${meta.label.toLowerCase()}`;
  };

  const healthOk = data.health.database === 'operational' && data.health.authentication === 'operational';
  const allSystemsOk = healthOk && data.health.aiConfigured;

  const healthRows: Array<{ label: string; state: string; ok: boolean }> = [
    {
      label: 'Authentication Service',
      state: data.health.authentication === 'operational' ? 'Operational' : 'Unavailable',
      ok: data.health.authentication === 'operational',
    },
    {
      label: 'Database Service',
      state: data.health.database === 'operational' ? 'Operational' : 'Unavailable',
      ok: data.health.database === 'operational',
    },
    { label: 'AI Generation Service', state: data.health.aiConfigured ? 'Configured' : 'Not Configured', ok: data.health.aiConfigured },
    { label: 'Application', state: 'Operational', ok: true },
  ];

  const usageItems = [
    { label: 'Questions in Bank', value: data.platformUsage.questionsInBank, icon: Question, tile: TILE.blue },
    { label: 'Active Sections', value: data.platformUsage.activeSections, icon: Buildings, tile: TILE.green },
    { label: 'Active Offerings', value: data.platformUsage.activeOfferings, icon: Stack, tile: TILE.violet },
    { label: 'AI API Calls', value: data.platformUsage.aiCalls, icon: Robot, tile: TILE.amber },
  ];

  const quickActions = [
    { label: 'Create User', href: '/admin/users', icon: UserPlus, tile: TILE.blue },
    { label: 'Manage Subjects', href: '/admin/subjects', icon: Books, tile: TILE.violet },
    { label: 'Academic Setup', href: '/admin/academic', icon: GraduationCap, tile: TILE.green },
    { label: 'View Audit Logs', href: '/admin/audit-logs', icon: ShieldCheck, tile: TILE.amber },
  ];

  const topSubjectsMax = Math.max(
    ...(data.topSubjects ?? []).map((subject) => subject.assessmentCount),
    1
  );
  const trendsActivityTotal = data.trends
    ? data.trends.assessmentsCreated.reduce((sum, value) => sum + value, 0) +
      data.trends.examsConducted.reduce((sum, value) => sum + value, 0)
    : 0;

  return (
    <div className="admin-ambient -mx-4 -mt-6 min-h-[70vh] px-4 pb-4 pt-6 lg:-mx-8 lg:-mt-8 lg:px-8 lg:pt-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--color-foreground)]">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Overview of system activity, assessments, and platform usage
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2 text-sm font-medium text-[var(--color-foreground)] shadow-[var(--shadow-sm)]">
          <CalendarCheck className="h-4 w-4 text-[var(--color-primary)]" weight="regular" />
          {rangeLabel}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.statCards.map((card) => (
          <StatCard key={card.key} card={card} />
        ))}
      </div>

      {/* System activity + trends */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Panel title="System Activity" action={<ViewAllLink href="/admin/audit-logs" />} className="lg:col-span-2">
          {!data.recentActivity ? (
            <PanelNote>Activity data is unavailable right now.</PanelNote>
          ) : data.recentActivity.length === 0 ? (
            <PanelNote>No administrative activity recorded yet.</PanelNote>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {data.recentActivity.map((activity) => {
                const meta = ENTITY_META[activity.entityType] ?? DEFAULT_META;
                const EntityIcon = meta.icon;
                return (
                  <li key={activity.id} className="flex items-center gap-3 py-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${meta.tile}`}
                      aria-hidden="true"
                    >
                      <EntityIcon className="h-5 w-5" weight="regular" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                        {activityTitle(activity.action, activity.entityType)}
                      </p>
                      <p className="truncate text-xs text-[var(--color-muted)]">
                        by {activity.actorName ?? 'System'}
                      </p>
                    </div>
                    <Badge variant={meta.badge} className="hidden shrink-0 sm:inline-flex">
                      {meta.label}
                    </Badge>
                    <span className="w-24 shrink-0 text-right text-xs text-[var(--color-muted)]">
                      {relativeTime(activity.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Assessment Trends"
          action={
            <span className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)]">
              Last 6 Months
            </span>
          }
          className="lg:col-span-3"
        >
          {!data.trends ? (
            <PanelNote>Trend data is unavailable right now.</PanelNote>
          ) : trendsActivityTotal === 0 ? (
            <PanelNote>No assessments or exams recorded in the last 6 months.</PanelNote>
          ) : (
            <AssessmentTrendsChart trends={data.trends} />
          )}
        </Panel>
      </div>

      {/* Top subjects + distribution + recent exams */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Top Subjects by Assessments" action={<ViewAllLink href="/admin/subjects" />}>
          {!data.topSubjects ? (
            <PanelNote>Subject data is unavailable right now.</PanelNote>
          ) : data.topSubjects.length === 0 ? (
            <PanelNote>No assessments created yet.</PanelNote>
          ) : (
            <ul>
              {data.topSubjects.map((subject, index) => (
                <li key={`${subject.code}-${subject.title}`} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${
                      [TILE.blue, TILE.violet, TILE.green, TILE.amber, TILE.slate][index % 5]
                    }`}
                    aria-hidden="true"
                  >
                    <BookOpen className="h-5 w-5" weight="regular" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--color-foreground)]">
                      {subject.title}
                    </p>
                    <div
                      className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--color-surface-active)]"
                      role="progressbar"
                      aria-label={`${subject.title}: ${subject.assessmentCount} assessments`}
                      aria-valuenow={subject.assessmentCount}
                      aria-valuemin={0}
                      aria-valuemax={topSubjectsMax}
                    >
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[var(--color-primary)] to-blue-400"
                        style={{
                          width: `${Math.max((subject.assessmentCount / topSubjectsMax) * 100, 4)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-foreground)]">
                    {subject.assessmentCount}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="User Distribution">
          <RoleDistributionChart segments={data.userDistribution} totalUsers={data.totalUsers} />
        </Panel>

        <Panel title="Recent Exams">
          {!data.recentExams ? (
            <PanelNote>Exam data is unavailable right now.</PanelNote>
          ) : data.recentExams.length === 0 ? (
            <PanelNote>No exams deployed yet.</PanelNote>
          ) : (
            <ul className="divide-y divide-[var(--color-border)]">
              {data.recentExams.map((exam) => {
                const status = DEPLOYMENT_STATUS[exam.status] ?? {
                  label: exam.status,
                  variant: 'default' as BadgeVariant,
                };
                const opened = new Date(exam.opensAt);
                return (
                  <li key={exam.id} className="flex items-center gap-3 py-3">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] ${TILE.blue}`}
                      aria-hidden="true"
                    >
                      <FileText className="h-5 w-5" weight="regular" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[var(--color-foreground)]">
                        {exam.title}
                      </p>
                      <p className="truncate text-xs text-[var(--color-muted)]">{exam.subject}</p>
                    </div>
                    <Badge variant={status.variant} className="shrink-0">
                      {status.label}
                    </Badge>
                    <div className="hidden shrink-0 text-right sm:block">
                      <p className="text-xs font-medium text-[var(--color-foreground)]">
                        {opened.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {opened.toLocaleTimeString('en-US', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* Platform usage + quick actions + system health */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Platform Usage">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            {usageItems.map((item) => {
              const ItemIcon = item.icon;
              return (
                <div key={item.label} className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${item.tile}`}
                    aria-hidden="true"
                  >
                    <ItemIcon className="h-5 w-5" weight="regular" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-lg font-bold text-[var(--color-foreground)]">
                      {item.value === null ? '—' : item.value.toLocaleString()}
                    </p>
                    <p className="truncate text-xs text-[var(--color-muted)]">{item.label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel title="Quick Actions">
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action) => {
              const ActionIcon = action.icon;
              return (
                <Link
                  key={action.href}
                  href={action.href}
                  className={`flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-5 text-center text-sm font-medium text-[var(--color-foreground)] transition-colors hover:border-[var(--color-primary)] hover:bg-[var(--color-primary-light)] hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]`}
                >
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full ${action.tile}`} aria-hidden="true">
                    <ActionIcon className="h-5 w-5" weight="regular" />
                  </span>
                  {action.label}
                </Link>
              );
            })}
          </div>
        </Panel>

        <Panel title="System Health">
          <p
            className={`text-sm font-semibold ${
              allSystemsOk
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {allSystemsOk ? 'All Systems Operational' : 'Some Systems Need Attention'}
          </p>
          <ul className="mt-4 space-y-3">
            {healthRows.map((row) => (
              <li key={row.label} className="flex items-center gap-2.5 text-sm">
                {row.ok ? (
                  <CheckCircle
                    className="h-4 w-4 shrink-0 text-emerald-500"
                    weight="fill"
                    aria-hidden="true"
                  />
                ) : (
                  <WarningCircle
                    className="h-4 w-4 shrink-0 text-amber-500"
                    weight="fill"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate text-[var(--color-foreground)]">{row.label}</span>
                <span
                  className={`ml-auto shrink-0 text-xs font-semibold ${
                    row.ok
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {row.state}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
