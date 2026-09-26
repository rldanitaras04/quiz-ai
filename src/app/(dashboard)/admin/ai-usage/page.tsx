import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { getAiUsageTelemetry, type AiUsageBreakdownRow } from '../actions';

const statusVariant: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
  success: 'success',
  error: 'danger',
  timeout: 'warning',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function BreakdownTable({ rows, header }: { rows: AiUsageBreakdownRow[]; header: string }): JSX.Element {
  return (
    <Table cards>
      <THead>
        <TR>
          <TH>{header}</TH>
          <TH align="right">Calls</TH>
          <TH align="right">Success</TH>
          <TH align="right">Tokens</TH>
          <TH align="right">Avg Duration</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => (
          <TR key={row.key}>
            <TD primary label={header} className="font-medium text-[var(--color-foreground)]">
              {row.key}
            </TD>
            <TD numeric label="Calls" className="text-[var(--color-foreground)]">
              {row.calls.toLocaleString()}
            </TD>
            <TD numeric label="Success" className="text-[var(--color-foreground)]">
              {row.calls > 0 ? `${Math.round((row.success / row.calls) * 100)}%` : '—'}
            </TD>
            <TD numeric label="Tokens" className="text-[var(--color-muted)]">
              {row.tokens.toLocaleString()}
            </TD>
            <TD numeric label="Avg Duration" className="text-[var(--color-muted)]">
              {formatDuration(row.avgDurationMs)}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}

export default async function AiUsagePage(): Promise<JSX.Element> {
  const telemetry = await getAiUsageTelemetry();
  const { summary } = telemetry;

  const successRate =
    summary.totalCalls && summary.totalCalls > 0 && summary.success !== null
      ? `${Math.round((summary.success / summary.totalCalls) * 100)}%`
      : '—';

  const stats = [
    { label: 'Total AI Calls', value: summary.totalCalls === null ? '—' : summary.totalCalls.toLocaleString() },
    { label: 'Success Rate', value: successRate },
    { label: 'Tokens Used', value: summary.totalTokens === null ? '—' : summary.totalTokens.toLocaleString() },
    { label: 'Avg Duration', value: formatDuration(summary.avgDurationMs) },
  ];

  return (
    <div>
      <PageHeader
        title="AI Usage"
        description="Token usage, latency, and reliability across AI providers"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'AI Usage' },
        ]}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent>
              <p className="text-sm font-medium text-[var(--color-muted)]">{stat.label}</p>
              <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {summary.windowLimited && (
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Token and duration aggregates are computed over the most recent 20,000 calls.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">By Provider</h2>
          </CardHeader>
          <CardContent>
            {telemetry.byProvider.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--color-muted)]">
                No AI calls recorded yet.
              </p>
            ) : (
              <BreakdownTable rows={telemetry.byProvider} header="Provider" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-[var(--color-foreground)]">By Operation</h2>
          </CardHeader>
          <CardContent>
            {telemetry.byOperation.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--color-muted)]">
                No AI calls recorded yet.
              </p>
            ) : (
              <BreakdownTable rows={telemetry.byOperation} header="Operation" />
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <h2 className="text-base font-semibold text-[var(--color-foreground)]">Recent Calls</h2>
        </CardHeader>
        <CardContent>
          {!telemetry.recent ? (
            <p className="py-10 text-center text-sm text-[var(--color-muted)]">
              Recent-call data is unavailable right now.
            </p>
          ) : telemetry.recent.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-muted)]">
              No AI calls recorded yet.
            </p>
          ) : (
            <Table cards caption="Recent AI calls">
              <THead>
                <TR>
                  <TH>Time</TH>
                  <TH>Requested By</TH>
                  <TH>Provider / Model</TH>
                  <TH>Operation</TH>
                  <TH>Status</TH>
                  <TH align="right">Tokens</TH>
                  <TH align="right">Duration</TH>
                </TR>
              </THead>
              <TBody>
                {telemetry.recent.map((row) => (
                  <TR key={row.id}>
                    <TD primary label="Time" className="whitespace-nowrap text-[var(--color-muted)]">
                      {new Date(row.createdAt).toLocaleString()}
                    </TD>
                    <TD label="Requested By" className="max-w-[180px] truncate">
                      {row.email ?? '—'}
                    </TD>
                    <TD label="Provider / Model">
                      {row.provider}
                      <span className="ml-1 text-[var(--color-muted)]">{row.model}</span>
                    </TD>
                    <TD label="Operation" className="text-[var(--color-muted)]">
                      {row.operation}
                    </TD>
                    <TD label="Status">
                      <Badge variant={statusVariant[row.status] ?? 'default'}>{row.status}</Badge>
                      {row.errorCode && (
                        <span className="ml-2 text-xs text-[var(--color-danger)]">{row.errorCode}</span>
                      )}
                    </TD>
                    <TD numeric label="Tokens" className="text-[var(--color-muted)]">
                      {row.tokens.toLocaleString()}
                    </TD>
                    <TD numeric label="Duration" className="text-[var(--color-muted)]">
                      {formatDuration(row.durationMs)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
