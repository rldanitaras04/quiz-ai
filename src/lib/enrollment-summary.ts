/**
 * Pure enrollment summary types/helpers shared by server actions and client
 * components (bulk-enroll toasts). Deliberately dependency-free so importing
 * it from a `'use client'` module pulls in nothing server-side.
 */

export interface EnrollSummary {
  added: number;
  reenrolled: number;
  alreadyEnrolled: number;
  notFound: string[];
  failed: number;
}

export function emptySummary(notFound: string[] = []): EnrollSummary {
  return { added: 0, reenrolled: 0, alreadyEnrolled: 0, notFound, failed: 0 };
}

/** Merges two summaries (used when one action touches several offerings). */
export function mergeSummaries(a: EnrollSummary, b: EnrollSummary): EnrollSummary {
  return {
    added: a.added + b.added,
    reenrolled: a.reenrolled + b.reenrolled,
    alreadyEnrolled: a.alreadyEnrolled + b.alreadyEnrolled,
    notFound: [...a.notFound, ...b.notFound],
    failed: a.failed + b.failed,
  };
}

/** Compact human-readable line for toasts: "1 added · 1 re-enrolled · …". */
export function describeSummary(summary: EnrollSummary): string {
  const parts: string[] = [];
  if (summary.added) parts.push(`${summary.added} added`);
  if (summary.reenrolled) parts.push(`${summary.reenrolled} re-enrolled`);
  if (summary.alreadyEnrolled) parts.push(`${summary.alreadyEnrolled} already enrolled`);
  if (summary.notFound.length) parts.push(`${summary.notFound.length} not found`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  return parts.length > 0 ? parts.join(' · ') : 'No changes';
}
