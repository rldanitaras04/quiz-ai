-- Faculty-authorized manual identity verification (scope §5 "Exam identity
-- verification": "Provide faculty-authorized fallback/manual verification").
--
-- Deployments with requires_identity_verification gate exam start on
-- student_profiles.verification_status = 'verified' (src/lib/exam.ts). Until
-- now only super admins could set that flag (admin users page). This function
-- lets a faculty member grant it for students they actually teach — the
-- fallback the scope asks for while no face/liveness provider is wired in.
--
-- Authorization lives in the function, not in a table policy: SECURITY
-- DEFINER bypasses RLS, so the body re-checks that the caller is a super
-- admin, or teaches (at subject level, via is_faculty_of_subject) a subject
-- the student is ENROLLED in. That keeps the grant scoped to students the
-- actor already works with and avoids widening UPDATE rights on
-- student_profiles to authenticated (which would let faculty edit any column
-- of any profile a policy could reach).
--
-- The write itself only ever sets verification_status + updated_at — no
-- biometric data is captured or stored anywhere in this flow. Who granted it
-- and when is recorded in audit_logs by the server action that calls this.

CREATE OR REPLACE FUNCTION faculty_verify_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF NOT (
    is_super_admin(v_actor)
    OR EXISTS (
      SELECT 1
      FROM enrollments e
      JOIN subject_offerings so ON so.id = e.subject_offering_id
      WHERE e.student_id = p_student_id
        AND e.status = 'enrolled'
        AND is_faculty_of_subject(v_actor, so.subject_id)
    )
  ) THEN
    RAISE EXCEPTION 'not authorized to verify this student'
      USING ERRCODE = '42501';
  END IF;

  UPDATE student_profiles
     SET verification_status = 'verified',
         updated_at = now()
   WHERE user_id = p_student_id;

  RETURN FOUND;
END;
$$;

-- Callable by signed-in users (the faculty action path) and the service
-- role; never anonymously.
REVOKE ALL ON FUNCTION faculty_verify_student(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION faculty_verify_student(UUID) TO authenticated, service_role;
