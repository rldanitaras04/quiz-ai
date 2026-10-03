import { createAdminClient } from '@/lib/supabase/admin';

export interface MaintenanceResult {
  closed: number;
  activated: number;
  reminded: number;
  released: number;
  notified: number;
}

/**
 * Run the database-side scheduled-maintenance sweep
 * (`run_scheduled_maintenance`, migration 20261006000000): close ended
 * windows, activate due deployments, send opening-soon reminders and release
 * scores per the deployment's release policy.
 *
 * Every step is time-gated and idempotent, so running it from any read path,
 * from pg_cron, or from the HTTP endpoint is safe and concurrent runs cannot
 * double-notify (each step's UPDATE ... WHERE <predicate> flips the very
 * predicate it selects on).
 *
 * Failures never propagate: a page must not break because a maintenance pass
 * failed — the next pass (another page load or the next cron tick) retries.
 * Returns null when the sweep could not run.
 */
export async function runScheduledMaintenance(): Promise<MaintenanceResult | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('run_scheduled_maintenance');
    if (error) {
      console.error('Scheduled maintenance failed:', error.message);
      return null;
    }

    // Companion reaper (migration 20261015000000): queued/processing
    // generation jobs with no progress for 15 minutes were abandoned
    // mid-batch by a dead client — mark them failed so the activity feed
    // and the dashboard's failed-jobs query stay truthful. Best-effort like
    // the sweep itself: a failure here never breaks the page or the sweep.
    const { error: stallError } = await admin.rpc('fail_stalled_generation_jobs');
    if (stallError) {
      console.error('Stalled generation-job cleanup failed:', stallError.message);
    }

    return data as MaintenanceResult;
  } catch (error) {
    console.error('Scheduled maintenance failed:', error);
    return null;
  }
}
