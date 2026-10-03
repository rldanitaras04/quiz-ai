-- ============================================================================
-- Fix: proctor policies read other tables INLINE and detonated the planner
-- ============================================================================
--20261019000000 granted four SELECT policies with inline EXISTS subqueries
-- over other tables (exam_proctors -> assessment_deployments, assessments ->
-- exam_proctors + assessment_deployments, profiles/student_profiles ->
-- enrollments). Because policy subqueries evaluate the referenced table's own
-- RLS, those reads re-entered a mutually-referencing graph:
--
--   assessments (proctor policy) -> exam_proctors (faculty policy)
--     -> assessment_deployments -> ... -> assessments -> ...
--
-- For the embedded questions read the planner produced ~1900 nested SubPlans:
-- Planning Time 18.2s, Execution 8.6s (measured with EXPLAIN ANALYZE) — every
-- such statement died at the `authenticated` role's 8s statement_timeout
-- ("canceling statement due to statement timeout" in T32-T34 e2e checks).
-- A SECURITY DEFINER helper is opaque to the planner: one SubPlan, no RLS
-- re-entry, no recursion.
--
-- This migration replaces exactly those four policies with helper-based ones
-- (helpers below are identical to the corrected20261019000000). Semantics are
-- unchanged: the helper's inline predicate is the same condition the policy
-- enforced, and the tables it reads without RLS are exactly the rows the
-- predicate itself re-checks.
--
-- Idempotent: safe to run multiple times.

-- ----------------------------------------------------------------------------
-- 1) Helpers (CREATE OR REPLACE — same definitions as20261019000000)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_proctor_of_assessment(uid UUID, assessment_id_val UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM exam_proctors ep
    JOIN assessment_deployments ad ON ad.id = ep.deployment_id
    WHERE ep.proctor_id = uid
      AND ad.assessment_id = assessment_id_val
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_faculty_of_deployment(uid UUID, deployment_id_val UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  v_offering UUID;
BEGIN
  SELECT ad.subject_offering_id INTO v_offering
  FROM assessment_deployments ad
  WHERE ad.id = deployment_id_val;
  IF v_offering IS NULL THEN
    RETURN false;
  END IF;
  RETURN is_faculty_of_offering(uid, v_offering)
    OR is_faculty_of_subject(
      uid,
      (SELECT so.subject_id FROM subject_offerings so WHERE so.id = v_offering)
    );
END;
$$;

CREATE OR REPLACE FUNCTION is_proctor_of_student(uid UUID, student_id_val UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM enrollments e
    WHERE e.student_id = student_id_val
      AND is_proctor_of_offering(uid, e.subject_offering_id)
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2) The four inline policies, rebuilt as single helper calls
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can read proctors for their offerings" ON exam_proctors;
CREATE POLICY "Faculty can read proctors for their offerings"
  ON exam_proctors FOR SELECT TO authenticated
  USING (is_faculty_of_deployment(auth.uid(), deployment_id));

DROP POLICY IF EXISTS "Proctors can read proctored assessments" ON assessments;
CREATE POLICY "Proctors can read proctored assessments"
  ON assessments FOR SELECT TO authenticated
  USING (is_proctor_of_assessment(auth.uid(), id));

DROP POLICY IF EXISTS "Proctors can read student profiles for proctored offerings" ON profiles;
CREATE POLICY "Proctors can read student profiles for proctored offerings"
  ON profiles FOR SELECT TO authenticated
  USING (is_proctor_of_student(auth.uid(), id));

DROP POLICY IF EXISTS "Proctors can read student numbers for proctored offerings" ON student_profiles;
CREATE POLICY "Proctors can read student numbers for proctored offerings"
  ON student_profiles FOR SELECT TO authenticated
  USING (is_proctor_of_student(auth.uid(), user_id));
