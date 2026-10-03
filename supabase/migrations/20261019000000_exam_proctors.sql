-- ============================================================================
-- Exam proctors (scope §42): optional per-deployment supervision
-- ============================================================================
-- A proctor is assigned to ONE deployment (exam sitting) and gains:
--   * SELECT on that deployment's exam data (monitor visibility), and
--   * the full live-monitor intervention set through server actions that
--     authorize `faculty OR proctor` (no RLS writes granted here).
--
-- Assignment rows are written by trusted server actions only (service-role),
-- after an explicit `isFacultyOfOfferingOrSubject OR is_super_admin` check —
-- so this migration adds NO INSERT/UPDATE/DELETE policies, matching how
-- notifications/audit rows are handled. SELECT is granted to:
--   * the proctor themself (own rows),
--   * faculty of the deployment's offering/subject (their exam, their card),
--   * super administrators (assignment administration, scope §42/§2.1 —
--     assignment metadata only; exam data still requires a proctor row).
--
-- Reads are deliberately expanded ONLY through SECURITY DEFINER helper
-- functions (PostgreSQL ORs policies of the same command, so existing
-- faculty/student policies are untouched). A policy must NOT read another
-- table inline: that re-enters the referenced table's RLS, and the mutually
-- referencing policies (assessments <-> exam_proctors <->
-- assessment_deployments) made the planner build ~1900 nested subplans —
-- 18s planning, every read hit the 8s statement_timeout. Helpers keep each
-- policy a single opaque function call. Administrators get NO implicit
-- exam-data read: they see exam data only through their own proctor row
-- (scope §2.1, §42).
--
-- Idempotent: safe to run multiple times.

-- ----------------------------------------------------------------------------
-- 1) exam_proctors
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_proctors (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES assessment_deployments(id) ON DELETE CASCADE,
  proctor_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  granted_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, proctor_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_proctors_proctor ON exam_proctors(proctor_id);
CREATE INDEX IF NOT EXISTS idx_exam_proctors_deployment ON exam_proctors(deployment_id);

ALTER TABLE exam_proctors ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 2) RLS helpers (SECURITY DEFINER: bypass exam_proctors RLS so policies on
--    other tables can consult assignment state without recursion)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_proctor_of_deployment(uid UUID, deployment_id_val UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM exam_proctors ep
    WHERE ep.proctor_id = uid
      AND ep.deployment_id = deployment_id_val
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_proctor_of_offering(uid UUID, offering_id_val UUID)
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
      AND ad.subject_offering_id = offering_id_val
  );
END;
$$;

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

-- Faculty of the offering/subject a proctor row's deployment belongs to
-- (exam_proctors faculty read). SECURITY DEFINER so the deployments read
-- does not re-enter assessment_deployments RLS from inside a policy.
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

-- Proctor of any offering the student is enrolled in (roster/profile reads).
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
-- 3) exam_proctors SELECT policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Proctors can read own assignments" ON exam_proctors;
CREATE POLICY "Proctors can read own assignments"
  ON exam_proctors FOR SELECT TO authenticated
  USING (proctor_id = auth.uid());

DROP POLICY IF EXISTS "Faculty can read proctors for their offerings" ON exam_proctors;
CREATE POLICY "Faculty can read proctors for their offerings"
  ON exam_proctors FOR SELECT TO authenticated
  USING (is_faculty_of_deployment(auth.uid(), deployment_id));

DROP POLICY IF EXISTS "Admin can read exam proctors" ON exam_proctors;
CREATE POLICY "Admin can read exam proctors"
  ON exam_proctors FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()));

-- Writes: service-role server actions only (no INSERT/UPDATE/DELETE policy).

-- ----------------------------------------------------------------------------
-- 4) Proctor read access to exam data (monitor visibility)
--    New policies OR with the existing faculty/student ones.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Proctors can read exam_attempts for their deployments" ON exam_attempts;
CREATE POLICY "Proctors can read exam_attempts for their deployments"
  ON exam_attempts FOR SELECT TO authenticated
  USING (is_proctor_of_deployment(auth.uid(), deployment_id));

DROP POLICY IF EXISTS "Proctors can read exam_sessions for their deployments" ON exam_sessions;
CREATE POLICY "Proctors can read exam_sessions for their deployments"
  ON exam_sessions FOR SELECT TO authenticated
  USING (is_proctor_of_deployment(auth.uid(), deployment_id));

DROP POLICY IF EXISTS "Proctors can read exam events for their deployments" ON exam_events;
CREATE POLICY "Proctors can read exam events for their deployments"
  ON exam_events FOR SELECT TO authenticated
  USING (is_proctor_of_deployment(auth.uid(), deployment_id));

DROP POLICY IF EXISTS "Proctors can read their proctored deployments" ON assessment_deployments;
CREATE POLICY "Proctors can read their proctored deployments"
  ON assessment_deployments FOR SELECT TO authenticated
  USING (is_proctor_of_deployment(auth.uid(), id));

-- Assessment title/status on the monitor + proctoring pages: readable when
-- ANY of its deployments is proctored by the caller. (Workspace membership is
-- checked separately: the monitor page only passes a deployment that belongs
-- to the requested offering.)
DROP POLICY IF EXISTS "Proctors can read proctored assessments" ON assessments;
CREATE POLICY "Proctors can read proctored assessments"
  ON assessments FOR SELECT TO authenticated
  USING (is_proctor_of_assessment(auth.uid(), id));

DROP POLICY IF EXISTS "Proctors can read proctored offerings" ON subject_offerings;
CREATE POLICY "Proctors can read proctored offerings"
  ON subject_offerings FOR SELECT TO authenticated
  USING (is_proctor_of_offering(auth.uid(), id));

-- Roster (monitor header + table): same scope as the faculty roster reads.
DROP POLICY IF EXISTS "Proctors can read rosters for proctored offerings" ON enrollments;
CREATE POLICY "Proctors can read rosters for proctored offerings"
  ON enrollments FOR SELECT TO authenticated
  USING (is_proctor_of_offering(auth.uid(), subject_offering_id));

DROP POLICY IF EXISTS "Proctors can read student profiles for proctored offerings" ON profiles;
CREATE POLICY "Proctors can read student profiles for proctored offerings"
  ON profiles FOR SELECT TO authenticated
  USING (is_proctor_of_student(auth.uid(), id));

DROP POLICY IF EXISTS "Proctors can read student numbers for proctored offerings" ON student_profiles;
CREATE POLICY "Proctors can read student numbers for proctored offerings"
  ON student_profiles FOR SELECT TO authenticated
  USING (is_proctor_of_student(auth.uid(), user_id));
