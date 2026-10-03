/**
 * Pure conclusion rules (scope §42).
 *
 * Concluding an attempt is a submission: the same status decision the
 * student's own Submit makes, shared with the proctor/faculty conclude path
 * so every route into "this attempt is finished" agrees on what the database
 * should reflect:
 *
 *  - before the server-defined deadline → `submitted` (a manual turn-in),
 *    session closed with reason `submitted`;
 *  - at/after the deadline → `auto_submitted`, session closed with `expired`:
 *    the expiry is what the database reflects, not a manual submission the
 *    student (or proctor) was no longer entitled to make;
 *  - no deadline recorded at all → treated as not expired.
 *
 * Kept dependency-free so `npm test` can import it directly (scope §42 tests).
 */

export type ConcludedAttemptStatus = 'submitted' | 'auto_submitted';
export type SessionCloseReason = 'submitted' | 'expired';

export interface ConclusionPlan {
  /** Status to write on the attempt (conditional on `in_progress`). */
  status: ConcludedAttemptStatus;
  /** `closeActiveSession` reason for the attempt's active session. */
  sessionCloseReason: SessionCloseReason;
  /** True when the deadline had already passed at decision time. */
  autoSubmitted: boolean;
}

/**
 * Decide the outcome of concluding/submitting one attempt at `nowIso`.
 *
 * Comparison is the same lexicographic ISO-string `<` the original submit path
 * used: identical timestamps are NOT yet expired, and an unparseable or empty
 * deadline never expires an attempt.
 */
export function conclusionPlanFor(
  expiresAt: string | null | undefined,
  nowIso: string
): ConclusionPlan {
  const expired = Boolean(expiresAt && expiresAt < nowIso);
  return {
    status: expired ? 'auto_submitted' : 'submitted',
    sessionCloseReason: expired ? 'expired' : 'submitted',
    autoSubmitted: expired,
  };
}
