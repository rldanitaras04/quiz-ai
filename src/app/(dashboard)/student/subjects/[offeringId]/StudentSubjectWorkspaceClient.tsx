'use client';

import { useEffect, useState } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Link from 'next/link';
import { useNavigationContext } from '@/components/layout/NavigationContext';
import { getStudentSubjectNav, type NavigationItem } from '@/config/navigation';
import { getDeploymentStatus } from '@/lib/deployment-status';
import { handleSamePathHashClick } from '@/lib/hash-navigation';

interface StudentSubjectWorkspaceClientProps {
  offeringId: string;
  subject: Record<string, unknown> | undefined;
  section: Record<string, unknown> | undefined;
  program: Record<string, unknown> | undefined;
  yearLevel: Record<string, unknown> | undefined;
  semester: Record<string, unknown> | undefined;
  academicYear: Record<string, unknown> | undefined;
  faculty: Record<string, unknown> | undefined;
  deployments: Array<Record<string, unknown>> | undefined;
  attemptsByDeployment: Map<string, Array<Record<string, unknown>>>;
  results: Array<Record<string, unknown>>;
  now: Date;
}

type WorkspaceTab = 'overview' | 'assessments' | 'results';

function tabFromHash(hash: string): WorkspaceTab {
  if (hash === '#assessments') return 'assessments';
  if (hash === '#results') return 'results';
  return 'overview';
}

export default function StudentSubjectWorkspaceClient({
  offeringId,
  subject,
  section,
  program,
  yearLevel,
  semester,
  academicYear,
  faculty,
  deployments,
  attemptsByDeployment,
  results,
  now,
}: StudentSubjectWorkspaceClientProps) {
  const { setContextualNav, clearContextualNav } = useNavigationContext();
  const [hash, setHash] = useState('');

  // Track the hash so tab clicks (sidebar or in-page) switch content + active state.
  useEffect(() => {
    const syncHash = () => setHash(window.location.hash || '');
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, []);

  const activeTab = tabFromHash(hash);
  const basePath = `/student/subjects/${offeringId}`;
  const currentPath = activeTab === 'overview' ? basePath : `${basePath}#${activeTab}`;

  // Set contextual navigation on mount / tab change; include the hash so the
  // sidebar highlights the active tab (pathname alone never contains #…).
  useEffect(() => {
    setContextualNav(getStudentSubjectNav(offeringId), currentPath);
    return () => clearContextualNav();
  }, [offeringId, currentPath, setContextualNav, clearContextualNav]);

  const tabs = getStudentSubjectNav(offeringId);
  const list = (deployments ?? []) as Array<Record<string, unknown>>;
  const resultList = results ?? [];

  const assessmentsPanel = (
    <div id="assessments" className="space-y-6 scroll-mt-4">
      {list.length > 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">
              Available Assessments
            </h2>
          </CardHeader>
          <Table caption="Assessments deployed for this subject">
            <THead>
              <TR>
                <TH>Assessment</TH>
                <TH align="right">Items</TH>
                <TH align="right">Points</TH>
                <TH align="right">Duration</TH>
                <TH>Window</TH>
                <TH>Status</TH>
                <TH align="right">Action</TH>
              </TR>
            </THead>
            <TBody>
              {list.map((d) => {
                const version = d.assessment_version as Record<string, unknown> | undefined;
                const assessment = version?.assessment as Record<string, unknown> | undefined;
                const opensAt = new Date(d.opens_at as string);
                const closesAt = new Date(d.closes_at as string);
                const status = getDeploymentStatus(d, attemptsByDeployment, now);
                const isAvailable = now >= opensAt && now <= closesAt && !status.attemptId;
                const canResume = !!status.attemptId;
                const href = `/student/assessments/${assessment?.id as string ?? d.id as string}`;

                return (
                  <TR key={d.id as string} className="hover:bg-[var(--color-surface-hover)] align-top">
                    <TD className="font-medium">
                      <Link
                        href={href}
                        className="text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
                      >
                        {(assessment?.title as string) ?? 'Untitled Assessment'}
                      </Link>
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {(version?.total_items as number) ?? '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {(version?.total_points as number) ?? '—'}
                    </TD>
                    <TD numeric className="text-[var(--color-muted)]">
                      {d.duration_minutes as number} min
                    </TD>
                    <TD className="text-xs text-[var(--color-muted)]">
                      {opensAt.toLocaleDateString()}{' '}
                      {opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      <span className="block">
                        → {closesAt.toLocaleDateString()}{' '}
                        {closesAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </TD>
                    <TD>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TD>
                    <TD className="text-right">
                      {isAvailable || canResume ? (
                        <Link
                          href={href}
                          className="inline-flex items-center rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--color-primary-hover)]"
                        >
                          {canResume ? 'Resume' : 'Start'}
                        </Link>
                      ) : (
                        <span className="text-xs text-[var(--color-muted)]">—</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No assessments available"
          description="Assessments deployed for this subject will appear here."
        />
      )}
    </div>
  );

  const resultsPanel = (
    <div id="results" className="space-y-6 scroll-mt-4">
      {resultList.length > 0 ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">
              Released Results
            </h2>
          </CardHeader>
          <Table caption="Released exam results for this subject">
            <THead>
              <TR>
                <TH>Assessment</TH>
                <TH align="right">Score</TH>
                <TH align="right">Percentage</TH>
                <TH>Released</TH>
                <TH align="right">Detail</TH>
              </TR>
            </THead>
            <TBody>
              {resultList.map((r) => {
                const deployment = r.deployment as Record<string, unknown> | undefined;
                const version = deployment?.assessment_version as Record<string, unknown> | undefined;
                const assessment = version?.assessment as Record<string, unknown> | undefined;
                const assessmentId = assessment?.id as string | undefined;
                const attemptId = r.attempt_id as string;
                const href = assessmentId
                  ? `/student/assessments/${assessmentId}/exam/${attemptId}/results`
                  : '/student/results';
                const percentage = Math.round((r.percentage as number) ?? 0);

                return (
                  <TR key={r.id as string} className="hover:bg-[var(--color-surface-hover)]">
                    <TD className="font-medium">
                      <Link
                        href={href}
                        className="text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
                      >
                        {(assessment?.title as string) ?? 'Untitled Assessment'}
                      </Link>
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {r.raw_score as number}/{r.possible_score as number}
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        <Badge variant={percentage >= 75 ? 'success' : percentage >= 50 ? 'warning' : 'danger'}>
                          {percentage}%
                        </Badge>
                      </div>
                    </TD>
                    <TD className="text-xs text-[var(--color-muted)]">
                      {r.released_at
                        ? new Date(r.released_at as string).toLocaleDateString()
                        : new Date(r.created_at as string).toLocaleDateString()}
                    </TD>
                    <TD className="text-right">
                      <Link
                        href={href}
                        className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                      >
                        View
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No results yet"
          description="Released scores for this subject will appear here."
        />
      )}
    </div>
  );

  const overviewPanel = (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">
              At a Glance
            </h2>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--color-muted)]">Assessments</p>
                <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">{list.length}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-muted)]">Released Results</p>
                <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">{resultList.length}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--color-muted)]">In Progress</p>
                <p className="mt-1 text-2xl font-bold text-[var(--color-foreground)]">
                  {list.filter((d) => getDeploymentStatus(d, attemptsByDeployment, now).label === 'In Progress').length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        {assessmentsPanel}
      </div>
      <div className="space-y-6">
        <Card className="sticky top-6">
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">
              Subject Info
            </h2>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Instructor</span>
              <span className="font-medium">{(faculty?.full_name as string) ?? 'Unassigned'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Section</span>
              <span className="font-medium">{(section?.name as string) ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Program</span>
              <span className="font-medium">
                {(program?.code as string) ?? '—'}
                {yearLevel?.name ? ` · ${yearLevel.name as string}` : ''}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--color-muted)]">Term</span>
              <span className="font-medium">
                {(semester?.name as string) ?? '—'}
                {academicYear?.name ? ` (${academicYear.name as string})` : ''}
              </span>
            </div>
            {typeof subject?.description === 'string' && subject.description && (
              <div className="pt-3 border-t border-[var(--color-border)]">
                <p className="text-[var(--color-muted)]">{subject.description as string}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Student', href: '/student' },
          { label: 'My Subjects', href: '/student/subjects' },
          { label: `${subject?.code as string ?? ''} - ${section?.name as string ?? ''}` },
        ]}
        title={`${subject?.code as string ?? ''} - ${subject?.title as string ?? ''}`}
        description={[
          section?.name as string,
          program?.code as string,
          yearLevel?.name as string,
        ].filter(Boolean).join(' · ')}
      />

      {/* In-page tabs - mobile fallback and deep-link targets */}
      <nav className="lg:hidden flex gap-1 mb-6 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map((tab: NavigationItem) => (
          <Link
            key={tab.id}
            href={tab.href ?? '#'}
            onClick={(event) => {
              if (tab.href) handleSamePathHashClick(event, tab.href);
            }}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              (tab.href ?? '') === currentPath
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border)]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === 'overview' && overviewPanel}
      {activeTab === 'assessments' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">{assessmentsPanel}</div>
          <div />
        </div>
      )}
      {activeTab === 'results' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">{resultsPanel}</div>
          <div />
        </div>
      )}
    </div>
  );
}
