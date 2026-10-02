-- ============================================================================
-- Scheduled maintenance — a real clock for time-driven transitions
-- ============================================================================
-- Nothing in the system ran on a schedule, which broke four scoped features:
--   * deployments never transitioned scheduled -> active -> closed by time;
--     20260919000000 added `deployment_effective_status` so READS could cope,
--     but the status column stayed stale and the "Exam is open" notification
--     never fired for a timed opening;
--   * score_release_mode = 'after_close' — the schema DEFAULT — never
--     released anything (see the releaseResults comment in deploy/actions.ts:
--     "after close modes had no implementation");
--   * score_release_mode = 'scheduled' had no column and no consumer;
--   * "exam opening soon" reminders had no trigger (scope §32).
--
-- run_scheduled_maintenance() performs every transition in one idempotent
-- pass. Each step is guarded by the exact predicate it flips
-- (UPDATE ... WHERE status = ... RETURNING), so a step that already ran
-- matches zero rows and notifies nobody — safe to invoke repeatedly and
-- concurrently (row locks + READ COMMITTED re-evaluation make a concurrent
-- second run see zero due rows). All timing compares the database clock:
-- the server is authoritative (scope §19); client clocks never participate.
--
-- Invoked three ways:
--   1. pg_cron, once a minute, when the extension is available (guarded
--      below — if the project cannot load pg_cron, this migration still
--      succeeds and the other two paths keep the system correct);
--   2. lazily from the read paths that surface the data
--      (src/lib/scheduler.ts → admin rpc);
--   3. GET /api/cron/sweep for an external scheduler (CRON_SECRET).
--
-- Notifications mirror notifyOfferingStudents: trusted-server inserts with
-- the subject/section prefix on the body, one row per actively enrolled
-- student. Idempotent: safe to run multiple times.

-- ---------------------------------------------------------------------------
-- Columns: scheduled score release + reminder dedup marker
-- ---------------------------------------------------------------------------
ALTER TABLE assessment_deployments
  ADD COLUMN IF NOT EXISTS score_release_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- Indexes for the sweep predicates (partial: the sweep runs every minute)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_assessment_deployments_close_due
  ON assessment_deployments (closes_at)
  WHERE status IN ('scheduled', 'active');

CREATE INDEX IF NOT EXISTS idx_assessment_deployments_open_due
  ON assessment_deployments (opens_at)
  WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_assessment_deployments_release_window
  ON assessment_deployments (closes_at)
  WHERE score_release_mode IN ('after_close', 'after_all_submitted');

CREATE INDEX IF NOT EXISTS idx_assessment_deployments_release_at
  ON assessment_deployments (score_release_at)
  WHERE score_release_mode = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_assessment_results_unreleased
  ON assessment_results (deployment_id)
  WHERE status <> 'released';

-- ---------------------------------------------------------------------------
-- Notification context helper — the SQL twin of getOfferingNotificationContext
-- (subject "CODE - Title (Section) — " prefix and the data keys the
-- notification UI expects). subject_id / section_id are NOT NULL, so the
-- label always resolves for a real offering; NULL only for a missing id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION offering_notify_context(p_offering_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'subject_id', so.subject_id,
    'subject_label', s.code || ' - ' || s.title,
    'section_name', sec.name,
    'subject_offering_id', so.id,
    'prefix', s.code || ' - ' || s.title || ' (' || sec.name || ') — '
  )
  FROM subject_offerings so
  JOIN subjects s ON s.id = so.subject_id
  JOIN sections sec ON sec.id = so.section_id
  WHERE so.id = p_offering_id;
$$;

-- ---------------------------------------------------------------------------
-- The sweep
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION run_scheduled_maintenance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closed        INT := 0;
  v_activated     INT := 0;
  v_reminded      INT := 0;
  v_released      INT := 0;
  v_notified      INT := 0;
  v_step_notified INT := 0;
BEGIN
  ---------------------------------------------------------------------------
  -- 1. Close windows that have ended. Only scheduled/active: 'draft' is the
  --    manual-launch placeholder a faculty member must open explicitly.
  --    Runs first so a deployment whose opening AND closing have both passed
  --    is never broadcast as "open now".
  ---------------------------------------------------------------------------
  WITH due AS (
    UPDATE assessment_deployments d
       SET status = 'closed', updated_at = now()
     WHERE d.status IN ('scheduled', 'active')
       AND d.closes_at <= now()
    RETURNING d.id, d.subject_offering_id, d.assessment_id
  ),
  n AS (
    INSERT INTO notifications (user_id, type, title, body, data)
    SELECT e.student_id,
           'assessment_closed',
           'Exam closed',
           COALESCE(ctx.ctx ->> 'prefix', '') || a.title || ' is no longer accepting attempts.',
           jsonb_build_object(
             'deployment_id', due.id,
             'assessment_id', due.assessment_id
           ) || COALESCE(ctx.ctx - 'prefix'::text, '{}'::jsonb)
    FROM due
    JOIN assessments a ON a.id = due.assessment_id
    JOIN enrollments e
      ON e.subject_offering_id = due.subject_offering_id
     AND e.status = 'enrolled'
    CROSS JOIN LATERAL (SELECT offering_notify_context(due.subject_offering_id) AS ctx) ctx
    RETURNING id
  )
  SELECT (SELECT count(*) FROM due), (SELECT count(*) FROM n)
    INTO v_closed, v_step_notified;

  v_notified := v_notified + v_step_notified;

  ---------------------------------------------------------------------------
  -- 2. Activate scheduled deployments whose opening time has arrived.
  --    Mirrors openDeployment: title "Exam is open", body "… available now
  --    until …", one notification per enrolled student.
  ---------------------------------------------------------------------------
  WITH due AS (
    UPDATE assessment_deployments d
       SET status = 'active', updated_at = now()
     WHERE d.status = 'scheduled'
       AND d.opens_at <= now()
       AND d.closes_at > now()
    RETURNING d.id, d.subject_offering_id, d.assessment_id, d.closes_at
  ),
  n AS (
    INSERT INTO notifications (user_id, type, title, body, data)
    SELECT e.student_id,
           'assessment_opened',
           'Exam is open',
           COALESCE(ctx.ctx ->> 'prefix', '') || a.title ||
             ' is available now until ' ||
             to_char(due.closes_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC.',
           jsonb_build_object(
             'deployment_id', due.id,
             'assessment_id', due.assessment_id
           ) || COALESCE(ctx.ctx - 'prefix'::text, '{}'::jsonb)
    FROM due
    JOIN assessments a ON a.id = due.assessment_id
    JOIN enrollments e
      ON e.subject_offering_id = due.subject_offering_id
     AND e.status = 'enrolled'
    CROSS JOIN LATERAL (SELECT offering_notify_context(due.subject_offering_id) AS ctx) ctx
    RETURNING id
  )
  SELECT (SELECT count(*) FROM due), (SELECT count(*) FROM n)
    INTO v_activated, v_step_notified;

  v_notified := v_notified + v_step_notified;

  ---------------------------------------------------------------------------
  -- 3. One "opening soon" reminder per scheduled deployment, at most one hour
  --    before it opens. reminder_sent_at is the dedup marker (set in the same
  --    UPDATE that selects the due rows, so it fires exactly once). Deployments
  --    created less than an hour before their own opening are skipped: their
  --    creation notice already carried the schedule.
  ---------------------------------------------------------------------------
  WITH due AS (
    UPDATE assessment_deployments d
       SET reminder_sent_at = now(), updated_at = now()
     WHERE d.status = 'scheduled'
       AND d.reminder_sent_at IS NULL
       AND d.opens_at > now()
       AND d.opens_at <= now() + interval '60 minutes'
       AND d.created_at <= d.opens_at - interval '60 minutes'
    RETURNING d.id, d.subject_offering_id, d.assessment_id,
              d.opens_at, d.closes_at, d.duration_minutes, d.attempt_limit
  ),
  n AS (
    INSERT INTO notifications (user_id, type, title, body, data)
    SELECT e.student_id,
           'reminder',
           'Exam opening soon',
           COALESCE(ctx.ctx ->> 'prefix', '') || a.title ||
             ' opens ' || to_char(due.opens_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') ||
             ' and closes ' || to_char(due.closes_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') ||
             ' UTC (' || due.duration_minutes || ' min, ' || due.attempt_limit ||
             ' attempt' || CASE WHEN due.attempt_limit = 1 THEN '' ELSE 's' END || ').',
           jsonb_build_object(
             'deployment_id', due.id,
             'assessment_id', due.assessment_id
           ) || COALESCE(ctx.ctx - 'prefix'::text, '{}'::jsonb)
    FROM due
    JOIN assessments a ON a.id = due.assessment_id
    JOIN enrollments e
      ON e.subject_offering_id = due.subject_offering_id
     AND e.status = 'enrolled'
    CROSS JOIN LATERAL (SELECT offering_notify_context(due.subject_offering_id) AS ctx) ctx
    RETURNING id
  )
  SELECT (SELECT count(*) FROM due), (SELECT count(*) FROM n)
    INTO v_reminded, v_step_notified;

  v_notified := v_notified + v_step_notified;

  ---------------------------------------------------------------------------
  -- 4. Release scores per policy (scope §27). `released_by` stays NULL: this
  --    is a system release, not a faculty action.
  --      * after_close / after_all_submitted — once the window has ended
  --        (faculty close/cancel stamps closes_at = now, so an early close
  --        releases on the next sweep too, matching closeDeployment);
  --      * scheduled — once score_release_at has passed.
  --    immediate stays at submission time and manual_release stays on the
  --    faculty Release button; both are unaffected.
  --    One notification per student per deployment (a student with several
  --    attempts gets one message), mirroring releaseResults.
  ---------------------------------------------------------------------------
  WITH released AS (
    UPDATE assessment_results r
       SET status = 'released', released_at = now(), updated_at = now()
      FROM assessment_deployments d
     WHERE r.deployment_id = d.id
       AND r.status <> 'released'
       AND (
         (d.score_release_mode IN ('after_close', 'after_all_submitted')
          AND d.closes_at <= now())
         OR (d.score_release_mode = 'scheduled'
             AND d.score_release_at IS NOT NULL
             AND d.score_release_at <= now())
       )
    RETURNING r.student_id, r.attempt_id, d.id AS deployment_id,
              d.assessment_id, d.subject_offering_id
  ),
  per_student AS (
    -- No min(uuid) aggregate exists in PostgreSQL; the text ordering of
    -- uuids is stable (fixed-width hex), and which attempt is named in the
    -- notification is arbitrary anyway.
    SELECT student_id, deployment_id, assessment_id, subject_offering_id,
           min(attempt_id::text)::uuid AS attempt_id
    FROM released
    GROUP BY student_id, deployment_id, assessment_id, subject_offering_id
  ),
  n AS (
    INSERT INTO notifications (user_id, type, title, body, data)
    SELECT ps.student_id,
           'result_released',
           'Result released',
           COALESCE(ctx.ctx ->> 'prefix', '') || 'Your result for ' ||
             COALESCE(a.title, 'your assessment') || ' is now available.',
           jsonb_build_object(
             'deployment_id', ps.deployment_id,
             'attempt_id', ps.attempt_id,
             'assessment_id', ps.assessment_id
           ) || COALESCE(ctx.ctx - 'prefix'::text, '{}'::jsonb)
    FROM per_student ps
    LEFT JOIN assessments a ON a.id = ps.assessment_id
    CROSS JOIN LATERAL (SELECT offering_notify_context(ps.subject_offering_id) AS ctx) ctx
    RETURNING id
  )
  SELECT (SELECT count(*) FROM released), (SELECT count(*) FROM n)
    INTO v_released, v_step_notified;

  v_notified := v_notified + v_step_notified;

  ---------------------------------------------------------------------------
  -- 5. One audit row per run that changed something (scope §34: schedule
  --    changes and result releases are audited events; actor is NULL because
  --    the actor is the system).
  ---------------------------------------------------------------------------
  IF (v_closed + v_activated + v_reminded + v_released) > 0 THEN
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      NULL,
      'update',
      'scheduled_maintenance',
      NULL,
      jsonb_build_object(
        'closed', v_closed,
        'activated', v_activated,
        'reminded', v_reminded,
        'released', v_released,
        'notified', v_notified
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'closed', v_closed,
    'activated', v_activated,
    'reminded', v_reminded,
    'released', v_released,
    'notified', v_notified
  );
END;
$$;

-- Server-only: the sweep is invoked with the service-role client (rpc) or by
-- pg_cron (scheduled below, as the owner). It has no user input, but there is
-- no reason for a browser session to trigger it either.
REVOKE ALL ON FUNCTION run_scheduled_maintenance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION run_scheduled_maintenance() TO service_role;

REVOKE ALL ON FUNCTION offering_notify_context(UUID) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- pg_cron — every minute, when the extension is loadable on this project.
-- Guarded: a project without pg_cron logs a NOTICE and keeps the lazy-sweep
-- and HTTP paths, so this migration never fails over the scheduler.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_has_pg_cron BOOLEAN := false;
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    v_has_pg_cron := true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron unavailable (%); relying on lazy + HTTP sweeps', SQLERRM;
  END;

  IF v_has_pg_cron
     AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'seams-scheduled-maintenance')
  THEN
    PERFORM cron.schedule(
      'seams-scheduled-maintenance',
      '* * * * *',
      $job$SELECT public.run_scheduled_maintenance()$job$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule pg_cron job (%); relying on lazy + HTTP sweeps', SQLERRM;
END $$;
