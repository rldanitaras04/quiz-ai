-- ============================================================================
-- Fix: faculty RLS on assessment_results passed a deployment id where an
-- offering id is expected
-- ============================================================================
-- "Faculty can read/update assessment_results for their offerings" (created in
-- 20260918000000) called is_faculty_of_offering(auth.uid(), deployment_id).
-- That helper compares against faculty_assignments.subject_offering_id, so the
-- check never matched: faculty sessions silently read zero rows, and faculty
-- UPDATEs (e.g. score release) never passed RLS without the service-role
-- client.
--
-- Resolve the deployment's offering first, then apply the same subject-level
-- model as 20260929000000: faculty own their subject's results across every
-- section they teach, while students remain limited to released results.
--
-- Idempotent: safe to run multiple times.

DROP POLICY IF EXISTS "Faculty can read assessment_results for their offerings" ON assessment_results;
CREATE POLICY "Faculty can read assessment_results for their offerings"
  ON assessment_results FOR SELECT TO authenticated
  USING (
    is_faculty_of_offering(
      auth.uid(),
      (SELECT d.subject_offering_id
       FROM assessment_deployments d
       WHERE d.id = assessment_results.deployment_id)
    )
    OR is_faculty_of_subject(
      auth.uid(),
      (SELECT so.subject_id
       FROM assessment_deployments d
       JOIN subject_offerings so ON so.id = d.subject_offering_id
       WHERE d.id = assessment_results.deployment_id)
    )
  );

DROP POLICY IF EXISTS "Faculty can update assessment_results for their offerings" ON assessment_results;
CREATE POLICY "Faculty can update assessment_results for their offerings"
  ON assessment_results FOR UPDATE TO authenticated
  USING (
    is_faculty_of_offering(
      auth.uid(),
      (SELECT d.subject_offering_id
       FROM assessment_deployments d
       WHERE d.id = assessment_results.deployment_id)
    )
    OR is_faculty_of_subject(
      auth.uid(),
      (SELECT so.subject_id
       FROM assessment_deployments d
       JOIN subject_offerings so ON so.id = d.subject_offering_id
       WHERE d.id = assessment_results.deployment_id)
    )
  )
  WITH CHECK (
    is_faculty_of_offering(
      auth.uid(),
      (SELECT d.subject_offering_id
       FROM assessment_deployments d
       WHERE d.id = assessment_results.deployment_id)
    )
    OR is_faculty_of_subject(
      auth.uid(),
      (SELECT so.subject_id
       FROM assessment_deployments d
       JOIN subject_offerings so ON so.id = d.subject_offering_id
       WHERE d.id = assessment_results.deployment_id)
    )
  );
