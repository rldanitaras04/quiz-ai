-- Scope §32 faculty events: "assessment closed" (+ submission progress at
-- close time) reaches every faculty member assigned to the offering.
--
-- Implemented as an AFTER UPDATE trigger rather than edits inside
-- run_scheduled_maintenance so BOTH close paths are covered with one hook:
--   * the system sweep (run_scheduled_maintenance, every minute via pg_cron
--     or lazily/HTTP) and
--   * the faculty close/cancel actions, which stamp closes_at = now and set
--     status = 'closed' themselves.
--
-- The transition fires exactly once (status must move INTO 'closed'), and
-- the system-close case reports how many of the enrolled students had
-- submitted — the "submission progress" faculty event of §32 at close time.
--
-- SECURITY DEFINER: notifications INSERT is REVOKE'd from `authenticated`
-- (migrations/20260918000000), so an invoker-rights trigger would fail when
-- a faculty session closes a deployment. Owner bypasses table privileges;
-- the body only ever inserts notification rows for faculty_assignments of
-- the transitioned deployment's own offering.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.

CREATE OR REPLACE FUNCTION notify_faculty_on_deployment_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enrolled INT := 0;
  v_submitted INT := 0;
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    SELECT count(*)
      INTO v_enrolled
      FROM enrollments
     WHERE subject_offering_id = NEW.subject_offering_id
       AND status = 'enrolled';

    SELECT count(DISTINCT student_id)
      INTO v_submitted
      FROM exam_attempts
     WHERE deployment_id = NEW.id
       AND status IN ('submitted', 'auto_submitted');

    INSERT INTO notifications (user_id, type, title, body, data)
    SELECT fa.faculty_id,
           'assessment_closed',
           'Exam closed',
           COALESCE(a.title, 'The assessment') || ' is closed. ' ||
             v_submitted || ' of ' || v_enrolled ||
             ' enrolled students have submitted.',
           jsonb_build_object(
             'deployment_id', NEW.id,
             'assessment_id', NEW.assessment_id,
             'offering_id', NEW.subject_offering_id,
             'submitted', v_submitted,
             'enrolled', v_enrolled
           )
      FROM faculty_assignments fa
      LEFT JOIN assessments a ON a.id = NEW.assessment_id
     WHERE fa.subject_offering_id = NEW.subject_offering_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_faculty_close_notification ON assessment_deployments;
CREATE TRIGGER trg_faculty_close_notification
  AFTER UPDATE OF status ON assessment_deployments
  FOR EACH ROW
  EXECUTE FUNCTION notify_faculty_on_deployment_closed();
