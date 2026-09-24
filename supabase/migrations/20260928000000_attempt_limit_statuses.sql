-- Align enforce_attempt_limit with COUNTABLE_ATTEMPT_STATUSES in
-- src/lib/attempt-limit.ts: timed_out, expired, and invalidated attempts
-- must also use a seat, so a student who ran out of time cannot re-enter.
-- Idempotent: safe to run multiple times.

CREATE OR REPLACE FUNCTION enforce_attempt_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_limit INTEGER;
  v_existing INTEGER;
  v_max INTEGER;
BEGIN
  SELECT attempt_limit INTO v_limit
  FROM assessment_deployments
  WHERE id = NEW.deployment_id;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'Deployment % not found', NEW.deployment_id;
  END IF;

  -- Number of countable attempts this student already has.
  -- Must match COUNTABLE_ATTEMPT_STATUSES (everything except cancelled).
  SELECT COUNT(*) INTO v_existing
  FROM exam_attempts
  WHERE deployment_id = NEW.deployment_id
    AND student_id = NEW.student_id
    AND status IN (
      'created', 'in_progress', 'submitted', 'auto_submitted',
      'timed_out', 'expired', 'invalidated'
    );

  IF NEW.status IN (
       'created', 'in_progress', 'submitted', 'auto_submitted',
       'timed_out', 'expired', 'invalidated'
     )
     AND v_existing >= v_limit THEN
    RAISE EXCEPTION 'Attempt limit reached for this deployment'
      USING ERRCODE = 'P0001';
  END IF;

  -- Normalize attempt_number to the true next number regardless of what the
  -- client computed, avoiding UNIQUE collisions under concurrency.
  SELECT COALESCE(MAX(attempt_number), 0) + 1 INTO v_max
  FROM exam_attempts
  WHERE deployment_id = NEW.deployment_id
    AND student_id = NEW.student_id;

  NEW.attempt_number := v_max;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
