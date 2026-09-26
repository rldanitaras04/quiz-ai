import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssessmentException } from '@/lib/types';

/**
 * Faculty-controlled per-student assessment exceptions.
 *
 * The same resolution is applied everywhere a deployment's window is
 * considered — the server-side exam start (`lib/exam.ts`) and the student
 * assessment detail page — so a granted `schedule_override` or
 * `additional_attempt` both actually works instead of only authorizing at the
 * API while the UI still blocks the student.
 *
 * Exceptions are always Student-specific: only the caller's own rows are read,
 * and nothing re-opens a deployment for anyone else.
 */

export interface DeploymentWindowInput {
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempt_limit: number;
}

export interface EffectiveDeploymentWindow {
  opensAt: Date;
  closesAt: Date;
  durationMinutes: number;
  attemptLimit: number;
  /** True when at least one unexpired exception widened the window or limits. */
  hasException: boolean;
  /** The unexpired exceptions that were applied, for surfacing in the UI. */
  applied: AssessmentException[];
}

/**
 * Fetch the caller's own unexpired exceptions for a deployment.
 * Uses the session client when possible so RLS keeps the read scoped; the
 * service-role client is accepted for paths that already run elevated.
 */
export async function loadAssessmentExceptions(
  client: SupabaseClient,
  deploymentId: string,
  studentId: string
): Promise<AssessmentException[]> {
  const { data, error } = await client
    .from('assessment_exceptions')
    .select('*')
    .eq('deployment_id', deploymentId)
    .eq('student_id', studentId);

  if (error || !data) return [];
  return data as AssessmentException[];
}

/**
 * Merge a deployment's raw window with the student's exceptions.
 *
 * `override_opens_at` may pull the window earlier, `override_closes_at` may
 * push it later, `additional_minutes` extends the duration and
 * `additional_attempts` raises the limit. Expired exceptions are ignored.
 */
export function applyAssessmentExceptions(
  deployment: DeploymentWindowInput,
  exceptions: AssessmentException[],
  now: Date = new Date()
): EffectiveDeploymentWindow {
  let opensAt = new Date(deployment.opens_at);
  let closesAt = new Date(deployment.closes_at);
  let durationMinutes = deployment.duration_minutes;
  let attemptLimit = deployment.attempt_limit;
  const applied: AssessmentException[] = [];

  for (const ex of exceptions) {
    if (ex.expires_at && new Date(ex.expires_at) < now) continue;

    switch (ex.exception_type) {
      case 'extended_time':
        if (ex.additional_minutes) durationMinutes += ex.additional_minutes;
        break;
      case 'additional_attempt':
        if (ex.additional_attempts) attemptLimit += ex.additional_attempts;
        break;
      case 'schedule_override':
        if (ex.override_opens_at) {
          const overrideOpens = new Date(ex.override_opens_at);
          if (overrideOpens < opensAt) opensAt = overrideOpens;
        }
        if (ex.override_closes_at) {
          const overrideCloses = new Date(ex.override_closes_at);
          if (overrideCloses > closesAt) closesAt = overrideCloses;
        }
        break;
    }

    applied.push(ex);
  }

  return { opensAt, closesAt, durationMinutes, attemptLimit, hasException: applied.length > 0, applied };
}
