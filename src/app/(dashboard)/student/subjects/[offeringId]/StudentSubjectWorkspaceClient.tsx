'use client';

import { useEffect } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Link from 'next/link';
import { useNavigationContext } from '@/components/layout/NavigationContext';
import { getStudentSubjectNav, type NavigationItem } from '@/config/navigation';

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
  now: Date;
  getDeploymentStatus: (d: Record<string, unknown>) => { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'default'; attemptId: string | null };
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
  now,
  getDeploymentStatus,
}: StudentSubjectWorkspaceClientProps) {
  const { setContextualNav, clearContextualNav } = useNavigationContext();

  // Set contextual navigation on mount, clear on unmount
  useEffect(() => {
    const nav = getStudentSubjectNav(offeringId);
    setContextualNav(nav, `/student/subjects/${offeringId}`);
    return () => clearContextualNav();
  }, [offeringId]);

  const tabs = getStudentSubjectNav(offeringId);

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

      {/* Contextual tabs - shown on mobile and as fallback */}
      <nav className="lg:hidden flex gap-1 mb-6 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map((tab: NavigationItem) => (
          <Link
            key={tab.id}
            href={tab.href ?? '#'}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab.href === `/student/subjects/${offeringId}`
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border)]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {deployments && deployments.length > 0 ? (
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
                  {(deployments as unknown as Array<Record<string, unknown>>).map((d) => {
                    const version = d.assessment_version as Record<string, unknown> | undefined;
                    const assessment = version?.assessment as Record<string, unknown> | undefined;
                    const opensAt = new Date(d.opens_at as string);
                    const closesAt = new Date(d.closes_at as string);
                    const status = getDeploymentStatus(d);
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
    </div>
  );
}