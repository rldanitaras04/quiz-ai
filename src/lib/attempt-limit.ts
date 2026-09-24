/**
 * Shared attempt-limit rules.
 *
 * An attempt "uses" a seat on the deployment when it is anything other than
 * cancelled — including timed-out and expired rows, which the old checks
 * ignored, so a student who ran out of time could start again.
 */

export const COUNTABLE_ATTEMPT_STATUSES = [
  'created',
  'in_progress',
  'submitted',
  'auto_submitted',
  'timed_out',
  'expired',
  'invalidated',
] as const;

export function isCountableAttempt(status: string): boolean {
  return (COUNTABLE_ATTEMPT_STATUSES as readonly string[]).includes(status);
}

export function countUsedAttempts(
  attempts: ReadonlyArray<{ status: string }>
): number {
  return attempts.filter((a) => isCountableAttempt(a.status)).length;
}

export function hasRemainingAttempts(
  attempts: ReadonlyArray<{ status: string }>,
  attemptLimit: number
): boolean {
  return countUsedAttempts(attempts) < attemptLimit;
}
