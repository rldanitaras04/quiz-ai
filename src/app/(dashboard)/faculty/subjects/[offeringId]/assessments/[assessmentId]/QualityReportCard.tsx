'use client';

import { useEffect, useState, type JSX } from 'react';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import {
  BLOOM_LABELS,
  DIFFICULTY_LABELS,
  QUESTION_TYPE_SHORT_LABELS,
} from '@/lib/constants';
import { getPreExamQuality, type PreExamQualityReport } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions/ai';

const DIMENSION_LABELS: Record<string, string> = {
  total: 'Total items',
  type: 'Type',
  difficulty: 'Difficulty',
  bloom: "Bloom's level",
  topic: 'Topic',
};

/**
 * Assessment Quality Dashboard, pre-exam half (scope §31): source-grounding
 * coverage, TOS alignment, difficulty/Bloom distributions, exact duplicate
 * count, semantic similarity flags and validation issues. Read-only
 * reporting — flags are analytic guidance, nothing here blocks the faculty.
 * Post-exam statistics live on the analytics page.
 */
export default function QualityReportCard({
  assessmentId,
}: {
  assessmentId: string;
}): JSX.Element {
  const [report, setReport] = useState<PreExamQualityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const applyResult = (res: Awaited<ReturnType<typeof getPreExamQuality>>): void => {
    if (res.data) {
      setReport(res.data);
      setError(null);
    } else {
      setError(res.error ?? 'Could not run the quality checks');
    }
    setLoading(false);
  };

  // Initial run — same inline-async pattern the detail page uses for topics.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getPreExamQuality(assessmentId);
      if (cancelled) return;
      if (res.data) setReport(res.data);
      setError(res.data ? null : res.error ?? 'Could not run the quality checks');
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  const handleRefresh = (): void => {
    setLoading(true);
    (async () => {
      applyResult(await getPreExamQuality(assessmentId));
    })();
  };

  const difficultyLabel = (key: string): string =>
    DIFFICULTY_LABELS[key as keyof typeof DIFFICULTY_LABELS] ?? key;
  const bloomLabel = (key: string): string =>
    BLOOM_LABELS[key as keyof typeof BLOOM_LABELS] ?? key;
  const typeLabel = (key: string): string =>
    QUESTION_TYPE_SHORT_LABELS[key as keyof typeof QUESTION_TYPE_SHORT_LABELS] ?? key;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-[var(--color-foreground)]">
            Quality checks
          </h2>
          <span className="text-xs text-[var(--color-muted)]">pre-exam</span>
        </div>
        <Button variant="secondary" size="sm" onClick={handleRefresh} loading={loading}>
          Re-run
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !report ? (
          <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
            <Spinner />
            Running checks…
          </div>
        ) : error ? (
          <p className="text-sm text-[var(--color-danger)]">{error}</p>
        ) : report ? (
          <div className="space-y-4">
            {/* Summary chips */}
            <div className="flex flex-wrap gap-2">
              <Badge variant={report.validation_issues.length === 0 ? 'success' : 'danger'}>
                {report.validation_issues.length === 0
                  ? 'No validation issues'
                  : `${report.validation_issues.length} validation issue${report.validation_issues.length === 1 ? '' : 's'}`}
              </Badge>
              <Badge variant={report.duplicates.length === 0 ? 'success' : 'warning'}>
                {report.duplicates.length === 0
                  ? 'No exact duplicates'
                  : `${report.duplicates.length} duplicate text group${report.duplicates.length === 1 ? '' : 's'}`}
              </Badge>
              {!report.semantic_available ? (
                <Badge variant="default">
                  Semantic check needs ≥ 2 embedded questions
                </Badge>
              ) : (
                <Badge variant={report.semantic_flags.length === 0 ? 'success' : 'warning'}>
                  {report.semantic_flags.length === 0
                    ? `No similar pairs (≥ ${report.thresholds.similarity})`
                    : `${report.semantic_flags.length} similar pair${report.semantic_flags.length === 1 ? '' : 's'} (≥ ${report.thresholds.similarity})`}
                </Badge>
              )}
              <Badge variant={report.grounding.percentage >= 100 ? 'success' : 'warning'}>
                {report.grounding.percentage >= 100
                  ? `Fully grounded (${report.grounding.grounded}/${report.grounding.total})`
                  : `${report.grounding.percentage}% grounded (${report.grounding.grounded}/${report.grounding.total})`}
              </Badge>
              {!report.tos.approved ? (
                <Badge variant="default">No approved TOS yet</Badge>
              ) : (
                <Badge variant={report.tos.mismatches.length === 0 ? 'success' : 'warning'}>
                  {report.tos.mismatches.length === 0
                    ? `TOS aligned (${report.tos.actual_items} items)`
                    : `${report.tos.mismatches.length} TOS mismatch${report.tos.mismatches.length === 1 ? '' : 'es'}`}
                </Badge>
              )}
            </div>

            {report.question_count === 0 ? (
              <p className="text-sm text-[var(--color-muted)]">
                No questions yet — add or generate questions to run the checks.
              </p>
            ) : (
              <>
                {report.validation_issues.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      Validation issues
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {report.validation_issues.map(issue => (
                        <li key={issue.question_id} className="text-[var(--color-foreground)]">
                          <span className="text-[var(--color-muted)]">
                            {issue.position !== null ? `#${issue.position} — ` : ''}
                          </span>
                          {issue.issues.join('; ')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.duplicates.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      Exact duplicates
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm text-[var(--color-foreground)]">
                      {report.duplicates.map(group => (
                        <li key={group.normalized.slice(0, 60)}>
                          Questions {group.positions.map(p => `#${p}`).join(', ')} share the same
                          text:{' '}
                          <span className="text-[var(--color-muted)]">
                            {group.normalized.slice(0, 90)}
                            {group.normalized.length > 90 ? '…' : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.semantic_flags.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      Semantic similarity flags
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm text-[var(--color-foreground)]">
                      {report.semantic_flags.map(flag => (
                        <li key={`${flag.a_id}-${flag.b_id}`}>
                          #{flag.a_position ?? '?'} ↔ #{flag.b_position ?? '?'} — similarity{' '}
                          {flag.score.toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.tos.approved && report.tos.mismatches.length > 0 && (
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      TOS alignment
                    </p>
                    <ul className="mt-1 space-y-0.5 text-sm text-[var(--color-foreground)]">
                      {report.tos.mismatches.map(mismatch => (
                        <li key={`${mismatch.dimension}-${mismatch.key}`}>
                          {DIMENSION_LABELS[mismatch.dimension] ?? mismatch.dimension}:{' '}
                          {mismatch.key} — expected {mismatch.expected}, actual{' '}
                          {mismatch.actual}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      Difficulty distribution
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {report.distributions.difficulty.map(d => (
                        <Badge key={d.key} variant="outline">
                          {difficultyLabel(d.key)} · {d.count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      Bloom distribution
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {report.distributions.bloom.map(d => (
                        <Badge key={d.key} variant="outline">
                          {bloomLabel(d.key)} · {d.count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-muted)]">
                      Type distribution
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {report.distributions.types.map(d => (
                        <Badge key={d.key} variant="outline">
                          {typeLabel(d.key)} · {d.count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-[var(--color-muted)]">
                  Checks are guidance, not verdicts — thresholds live in /admin/settings
                  (similarity ≥ {report.thresholds.similarity}). Post-exam statistics are on the
                  analytics page.
                </p>
              </>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
