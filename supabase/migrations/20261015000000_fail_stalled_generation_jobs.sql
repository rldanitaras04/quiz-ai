-- Generation-job state machine, safety net (WP-4): reap stalled jobs.
--
-- The wizard drives assessment_generation_jobs through
--   queued (triggerGeneration) → processing (each /api/ai/generate call,
--   which also bumps updated_at via the table's trigger) → completed/failed
--   (completeGenerationJob / failGenerationJob).
--
-- The only way that chain is abandoned is a client that dies mid-batch —
-- the browser closed, the network dropped for good, the tab crashed. Those
-- rows would otherwise sit in queued/processing forever and pollute the
-- faculty activity feed (exactly like the 10-day phantom `queued` row this
-- project already had to clean by hand). This function marks any
-- queued/processing row with no progress for 15 minutes as `failed` with a
-- stall explanation. A healthy batch can never be caught: every
-- per-question call re-runs the route's processing update, so the gap
-- between two updates is at most one AI round-trip.
--
-- Invoked from the same three places as run_scheduled_maintenance:
--   * pg_cron every minute (scheduled below, when the extension loads)
--   * src/lib/scheduler.ts — lazy page-load + HTTP cron passes
--   * directly by scripts/e2e-sweep.mjs (assertions below)
--
-- Idempotent: the UPDATE's predicate flips the state it selects on.
-- Privilege shape mirrors run_scheduled_maintenance (20261006000000).

CREATE OR REPLACE FUNCTION fail_stalled_generation_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed INTEGER;
BEGIN
  UPDATE assessment_generation_jobs
     SET status = 'failed',
         error_message = COALESCE(
           error_message,
           'Generation did not complete — no progress for 15 minutes (client stopped mid-batch).'
         )
   WHERE status IN ('queued', 'processing')
     AND updated_at < now() - interval '15 minutes';

  GET DIAGNOSTICS v_failed = ROW_COUNT;
  RETURN v_failed;
END;
$$;

REVOKE ALL ON FUNCTION fail_stalled_generation_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fail_stalled_generation_jobs() TO service_role;

-- pg_cron — every minute, same guarded pattern as the sweep itself: a
-- project without pg_cron logs a NOTICE and keeps the lazy + HTTP paths.
DO $$
DECLARE
  v_has_pg_cron BOOLEAN := false;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    v_has_pg_cron := true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable (%); relying on lazy + HTTP cleanup', SQLERRM;
  END;

  IF v_has_pg_cron
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'seams-fail-stalled-jobs')
  THEN
    PERFORM cron.schedule(
      'seams-fail-stalled-jobs',
      '* * * * *',
      $job$SELECT public.fail_stalled_generation_jobs()$job$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule pg_cron job (%); relying on lazy + HTTP cleanup', SQLERRM;
END $$;
