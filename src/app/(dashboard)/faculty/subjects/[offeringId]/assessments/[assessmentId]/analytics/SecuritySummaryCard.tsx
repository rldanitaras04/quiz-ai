'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { getSecuritySummary, type SecuritySummary } from './actions';

const STATUS_BADGES: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  created: { label: 'Not started', variant: 'default' },
  in_progress: { label: 'In progress', variant: 'info' },
  submitted: { label: 'Submitted', variant: 'success' },
  auto_submitted: { label: 'Auto-submitted', variant: 'success' },
  timed_out: { label: 'Timed out', variant: 'warning' },
  expired: { label: 'Expired', variant: 'warning' },
  cancelled: { label: 'Cancelled', variant: 'default' },
  invalidated: { label: 'Terminated', variant: 'danger' },
};

/**
 * Post-exam security summary. Every number here is a factual session record
 * (an event was recorded, a session transferred, an attempt terminated) —
 * never a determination about a student's conduct.
 */
export default function SecuritySummaryCard({ deploymentId }: { deploymentId: string }) {
  const [summary, setSummary] = useState<SecuritySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getSecuritySummary(deploymentId);
      if (cancelled) return;
      if (result.error || !result.data) {
        setError(result.error ?? 'Could not load the security summary');
      } else {
        setSummary(result.data);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [deploymentId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-8">
          <Spinner size="lg" />
        </CardContent>
      </Card>
    );
  }

  if (error || !summary) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-[var(--color-danger)]">
            {error ?? 'Security summary unavailable'}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { totals } = summary;

  return (
    <Card>
      <CardHeader>
        <div>
          <h3 className="text-base font-semibold text-foreground">Security Summary</h3>
          <p className="text-sm text-muted">
            Session events recorded during and after the exam. These are factual
            operational records for your review — not findings of misconduct.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Students started" value={totals.started} />
          <Stat label="In progress" value={totals.inProgress} />
          <Stat label="Students submitted" value={totals.submitted} />
          <Stat label="Sessions" value={totals.sessions} />
          <Stat label="Session transfers" value={totals.sessionTransfers} />
          <Stat label="Recovered sessions" value={totals.recoveredSessions} />
          <Stat label="Connectivity interruptions" value={totals.connectionLosses} />
          <Stat label="Full-screen exits" value={totals.fullscreenExits} />
          <Stat label="Focus losses" value={totals.focusLosses} />
          <Stat
            label="Concurrent attempts"
            value={totals.concurrentSessionAttempts}
            highlight={totals.concurrentSessionAttempts > 0}
          />
          <Stat label="Reverifications" value={totals.reverificationRequests} />
          <Stat
            label="Reverification failures"
            value={totals.reverificationFailures}
            highlight={totals.reverificationFailures > 0}
          />
          <Stat label="Faculty interventions" value={totals.facultyInterventions} />
          <Stat
            label="Terminated"
            value={totals.terminated}
            highlight={totals.terminated > 0}
          />
          <Stat label="Sync queue events" value={totals.syncQueueEvents} />
          <Stat
            label="Attention / Critical"
            value={`${totals.events.warning} / ${totals.events.critical}`}
            highlight={totals.events.critical > 0}
          />
        </div>

        {summary.commonEvents.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Most recorded events
            </p>
            <div className="flex flex-wrap gap-2">
              {summary.commonEvents.map((e) => (
                <Badge key={e.type} variant="outline">
                  {e.label} × {e.count}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {summary.interventionHistory.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Faculty intervention history
            </p>
            <ul className="max-h-56 divide-y divide-[var(--color-border)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
              {summary.interventionHistory.map((e, i) => (
                <li key={`${e.type}-${e.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
                  <span className="text-foreground">
                    <span className="font-medium">{e.studentName}</span>
                    <span className="text-muted"> — {e.label}</span>
                  </span>
                  <span className="tabular-nums text-muted">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.syncHistory.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Connectivity &amp; synchronization history
            </p>
            <ul className="max-h-56 divide-y divide-[var(--color-border)] overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
              {summary.syncHistory.map((e, i) => (
                <li key={`${e.type}-${e.at}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-xs">
                  <span className="text-foreground">
                    <span className="font-medium">{e.studentName}</span>
                    <span className="text-muted"> — {e.label}</span>
                  </span>
                  <span className="tabular-nums text-muted">
                    {new Date(e.at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {summary.attempts.length === 0 ? (
          <EmptyState
            title="No attempts yet"
            description="Event records appear here after students open this deployment."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Student</TH>
                  <TH>Status</TH>
                  <TH align="right">Sessions</TH>
                  <TH align="right">Transfers</TH>
                  <TH align="right">Info</TH>
                  <TH align="right">Attention</TH>
                  <TH align="right">Critical</TH>
                  <TH>Recorded events</TH>
                </TR>
              </THead>
              <TBody>
                {summary.attempts.map((row) => {
                  const badge = STATUS_BADGES[row.status] ?? {
                    label: row.status,
                    variant: 'default' as const,
                  };
                  return (
                    <TR key={row.attemptId}>
                      <TD className="text-foreground">
                        <div className="font-medium">{row.studentName}</div>
                        {row.studentNumber && (
                          <div className="text-xs text-muted">{row.studentNumber}</div>
                        )}
                      </TD>
                      <TD>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TD>
                      <TD numeric className="text-foreground">
                        {row.sessionCount}
                      </TD>
                      <TD numeric className="text-foreground">
                        {row.sessionTransfers}
                      </TD>
                      <TD numeric className="text-muted">
                        {row.counts.info}
                      </TD>
                      <TD numeric>
                        {row.counts.warning > 0 ? (
                          <Badge variant="warning">{row.counts.warning}</Badge>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </TD>
                      <TD numeric>
                        {row.counts.critical > 0 ? (
                          <Badge variant="danger">{row.counts.critical}</Badge>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </TD>
                      <TD>
                        {row.notableEvents.length === 0 ? (
                          <span className="text-muted">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {row.notableEvents.map((e) => (
                              <Badge key={e.type} variant="outline" className="text-[10px]">
                                {e.label} × {e.count}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number | string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={`text-lg font-bold ${
          highlight ? 'text-[var(--color-danger)]' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}
