-- ============================================================================
-- Subject-level faculty read policies (analytics / review session reads)
-- ============================================================================
-- Faculty actions authorize with isFacultyOfOfferingOrSubject (offering OR
-- any offering of the same subject — sibling sections share content), but the
-- faculty SELECT policies on these tables were offering-only. Faculty sessions
-- therefore had to run with the service-role client just to read rows that the
-- app had already authorized.
--
-- This migration extends ONLY faculty SELECT paths to subject level, matching
-- the app-level authorization. Writes are untouched:
--   * enrollments INSERT/UPDATE stay offering-gated (see 20260929000000).
--   * assessment_deployments writes stay offering-gated: the "Faculty can
--     manage assessment_deployments" FOR ALL policy is left alone; the new
--     SELECT policy only adds sibling-section reads (PostgreSQL ORs policies
--     of the same command).
--   * student_responses scoring columns remain REVOKE'd from authenticated
--     (security_hardening 726-727) — faculty scoring keeps the service-role
--     client; assessment_results/notifications INSERT+UPDATE remain REVOKE'd
--     (729-730) — release flows keep the service-role client.
--
-- Idempotent: safe to run multiple times.

-- ----------------------------------------------------------------------------
-- exam_attempts: readable when faculty of the attempt's deployment offering
-- or of that offering's subject.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can read exam_attempts for their offerings" ON exam_attempts;
CREATE POLICY "Faculty can read exam_attempts for their offerings"
  ON exam_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessment_deployments ad
      WHERE ad.id = exam_attempts.deployment_id
        AND (
          is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = ad.subject_offering_id)
          )
        )
    )
  );

-- ----------------------------------------------------------------------------
-- student_responses: same rule through attempt -> deployment.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can read student_responses for their offerings" ON student_responses;
CREATE POLICY "Faculty can read student_responses for their offerings"
  ON student_responses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      WHERE ea.id = student_responses.attempt_id
        AND (
          is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = ad.subject_offering_id)
          )
        )
    )
  );

-- ----------------------------------------------------------------------------
-- enrollments: read roster for any offering of a subject the faculty teaches.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can read enrollments for their offerings" ON enrollments;
CREATE POLICY "Faculty can read enrollments for their offerings"
  ON enrollments FOR SELECT TO authenticated
  USING (
    is_faculty_of_offering(auth.uid(), subject_offering_id)
    OR is_faculty_of_subject(
      auth.uid(),
      (SELECT so.subject_id FROM subject_offerings so WHERE so.id = enrollments.subject_offering_id)
    )
  );

-- ----------------------------------------------------------------------------
-- profiles (name/email): students enrolled in offerings of a subject the
-- faculty teaches. Same scope as the enrollment read above.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can read student profiles in their offerings" ON profiles;
CREATE POLICY "Faculty can read student profiles in their offerings"
  ON profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM enrollments e
      WHERE e.student_id = profiles.id
        AND (
          is_faculty_of_offering(auth.uid(), e.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = e.subject_offering_id)
          )
        )
    )
  );

-- ----------------------------------------------------------------------------
-- assessment_deployments: read deployments on sibling sections (analytics and
-- review resolve the deployment before their explicit authorization check,
-- and deployment pages list per offering). The FOR ALL manage policy keeps
-- writes offering-only.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can read assessment_deployments for their subjects" ON assessment_deployments;
CREATE POLICY "Faculty can read assessment_deployments for their subjects"
  ON assessment_deployments FOR SELECT TO authenticated
  USING (
    is_faculty_of_offering(auth.uid(), subject_offering_id)
    OR is_faculty_of_subject(
      auth.uid(),
      (SELECT so.subject_id FROM subject_offerings so WHERE so.id = assessment_deployments.subject_offering_id)
    )
  );
