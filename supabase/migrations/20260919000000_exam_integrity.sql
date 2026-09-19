-- ============================================================================
-- Follow-up: identity verification + DB-enforced attempt limits
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. student_profiles.verification_status
--    /api/exam/start gates deployments that require identity verification on
--    this column; it never existed, so the read errored and every student was
--    denied with 403. Add it with a safe default. Values: pending/verified/failed.
-- ----------------------------------------------------------------------------
ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';

ALTER TABLE student_profiles DROP CONSTRAINT IF EXISTS student_profiles_verification_status_check;
ALTER TABLE student_profiles ADD CONSTRAINT student_profiles_verification_status_check
  CHECK (verification_status IN ('pending', 'verified', 'failed'));

-- ----------------------------------------------------------------------------
-- 2. Attempt-limit enforcement in the database.
--    The app checks the attempt count before inserting (TOCTOU race), and
--    retries on UNIQUE(deployment_id, student_id, attempt_number) collisions.
--    This trigger makes the limit authoritative: it recomputes the next
--    attempt_number server-side and rejects inserts beyond attempt_limit.
--    Because exam/start inserts via the service role, RLS cannot enforce
--    this — a BEFORE INSERT trigger can.
-- ----------------------------------------------------------------------------
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
  SELECT COUNT(*) INTO v_existing
  FROM exam_attempts
  WHERE deployment_id = NEW.deployment_id
    AND student_id = NEW.student_id
    AND status IN ('created', 'in_progress', 'submitted', 'auto_submitted');

  IF NEW.status IN ('created', 'in_progress', 'submitted', 'auto_submitted')
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

DROP TRIGGER IF EXISTS trg_enforce_attempt_limit ON exam_attempts;
CREATE TRIGGER trg_enforce_attempt_limit
  BEFORE INSERT ON exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_attempt_limit();

-- ----------------------------------------------------------------------------
-- 3. Auto-activate / auto-close deployments by time window.
--    Nothing transitions deployments between 'scheduled' and 'active'; students
--    were gated on status = 'active' and could never start. A view lets reads
--    treat the time window as authoritative without a scheduler.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW deployment_effective_status AS
SELECT
  id,
  subject_offering_id,
  assessment_id,
  assessment_version_id,
  status,
  CASE
    WHEN status IN ('closed', 'archived', 'draft') THEN status
    WHEN now() < opens_at THEN 'scheduled'
    WHEN now() > closes_at THEN 'closed'
    ELSE 'active'
  END AS effective_status,
  opens_at,
  closes_at
FROM assessment_deployments;
