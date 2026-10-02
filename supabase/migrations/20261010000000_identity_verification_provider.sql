-- Provider-backed identity verification (scope §5 "Exam identity
-- verification") + hardening of the manual path it sits next to.
--
-- Part 1 — provider metadata columns.
-- Minimum required metadata for a provider outcome (scope §5: "Store
-- verification result/status and minimum required metadata; minimize
-- biometric retention"). No images, templates or other biometric material
-- ever lands here — only who consented and when, which provider settled the
-- check and when, and the small decision/risk payload the adapter returns
-- (session id, decision, score, flags).
ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS verification_provider TEXT,
  ADD COLUMN IF NOT EXISTS verification_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_meta JSONB;

-- Part 2 — close the self-grant hole.
-- "Students can update own profile" (20260918000000_security_hardening.sql)
-- has no column restriction, so any signed-in student could UPDATE their own
-- row to verification_status = 'verified' and walk through every
-- requires_identity_verification exam gate. Column-level privileges are
-- checked before RLS, so revoking the verification columns from
-- `authenticated` closes the self-grant for both INSERT and UPDATE
-- regardless of policy. (Same mechanism as
-- 20261005000000_student_response_score_read_privileges.sql.)
--
-- Every legitimate writer keeps working:
--   * faculty grant    → faculty_verify_student (SECURITY DEFINER, 20261008)
--   * admin users page → admin_set_student_verification (new, below)
--   * provider flow    → service role in /student/verify server actions
-- `service_role` is not touched by these revokes; only `authenticated`
-- (every signed-in browser session) loses direct column writes.
REVOKE UPDATE (
  verification_status,
  verification_provider,
  verification_consent_at,
  verification_verified_at,
  verification_meta
) ON student_profiles FROM authenticated;

REVOKE INSERT (
  verification_status,
  verification_provider,
  verification_consent_at,
  verification_verified_at,
  verification_meta
) ON student_profiles FROM authenticated;

-- Part 3 — the admin path, re-homed behind a SECURITY DEFINER function.
-- setStudentVerification (admin users page) used to UPDATE the column
-- directly through the caller's session client, which the revoke above now
-- forbids. Same shape as faculty_verify_student: authorization re-checked
-- inside the function (super admin only), status vocabulary re-checked
-- against the table's CHECK constraint, and the write limited to
-- verification_status + updated_at.
CREATE OR REPLACE FUNCTION admin_set_student_verification(
  p_student_id UUID,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF NOT is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'not authorized to set verification status'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('pending', 'verified', 'failed') THEN
    RAISE EXCEPTION 'invalid verification status %', p_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE student_profiles
     SET verification_status = p_status,
         updated_at = now()
   WHERE user_id = p_student_id;

  RETURN FOUND;
END;
$$;

-- Callable by signed-in users (the admin action path) and the service role;
-- never anonymously.
REVOKE ALL ON FUNCTION admin_set_student_verification(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION admin_set_student_verification(UUID, TEXT) TO authenticated, service_role;
