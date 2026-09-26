-- ============================================================================
-- Exception-aware attempt limit + revoke student INSERT on exam_attempts
-- ============================================================================
--
-- 1) enforce_attempt_limit() read only the raw assessment_deployments.attempt_limit,
--    so a faculty-granted `additional_attempt` exception was rejected by the
--    trigger even though src/lib/exam.ts had already approved it — the exception
--    workflow could never be used. The trigger now adds the caller's own
--    unexpired `additional_attempt` rows, mirroring applyAssessmentExceptions()
--    in src/lib/assessment-exceptions.ts.
--
--    Fail-closed: if the exception rows cannot be read, the extra allowance is 0
--    and the stricter raw limit applies.
--
--    Exceptions remain Student-specific — only rows matching NEW.student_id are
--    counted, so granting one student an extra attempt never reopens the
--    deployment for anyone else.
--
-- 2) Exam attempts are only ever created by the service-role client
--    (src/lib/exam.ts). Students previously kept a blanket INSERT grant, which
--    let them insert their own attempt rows (arbitrary status / expires_at)
--    through PostgREST. The grant is revoked; RLS policies are untouched.
--
-- Idempotent: safe to run multiple times.

CREATE OR REPLACE FUNCTION enforce_attempt_limit()
RETURNS TRIGGER AS $$
DECLARE
  v_limit INTEGER;
  v_extra INTEGER := 0;
  v_existing INTEGER;
  v_max INTEGER;
BEGIN
  SELECT attempt_limit INTO v_limit
  FROM assessment_deployments
  WHERE id = NEW.deployment_id;

  IF v_limit IS NULL THEN
    RAISE EXCEPTION 'Deployment % not found', NEW.deployment_id;
  END IF;

  -- Faculty-granted additional attempts for this student only.
  BEGIN
    SELECT COALESCE(SUM(additional_attempts), 0) INTO v_extra
    FROM assessment_exceptions
    WHERE deployment_id = NEW.deployment_id
      AND student_id = NEW.student_id
      AND exception_type = 'additional_attempt'
      AND (expires_at IS NULL OR expires_at > now());
  EXCEPTION WHEN OTHERS THEN
    v_extra := 0;
  END;

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
     AND v_existing >= (v_limit + v_extra) THEN
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

-- Attempts are written only through the service-role client. Keep SELECT for
-- the student's own rows (RLS), drop their ability to fabricate attempts.
REVOKE INSERT ON exam_attempts FROM authenticated;
