-- Close the leftover self-grant on student_profiles (scope §5 "Exam identity
-- verification"; caught by scripts/e2e-enrollment.mjs T22).
--
-- 20261010000000 revoked the five verification columns from `authenticated`,
-- but PostgreSQL makes a column-level REVOKE a no-op while the role still
-- holds a TABLE-level grant of the same privilege — the exact note recorded
-- in 20261005000000: "a table-level grant is unaffected by a column-level
-- REVOKE, which is why the table-level revoke comes first and the permitted
-- columns are then granted back explicitly." Supabase's default privileges
-- give `authenticated` table-level INSERT/UPDATE on student_profiles, so
-- the column revokes changed nothing and any student could still UPDATE
-- verification_status = 'verified' on their own row through the
-- unrestricted "Students can update own profile" policy (20260918000000).
--
-- Fix — same shape as 20261005000000 (table-level revoke first, grant back
-- only what a session writer legitimately needs):
--
--   * Every session-side writer on student_profiles was audited across
--     src/: only setStudentSection (admin users page — requireAdminUser
--     returns the CALLER'S session client) updates section_id + updated_at,
--     on a row its admin RLS policy authorizes. Those two columns are
--     granted back at column level.
--   * No session-side INSERT exists: registration and the admin bootstrap
--     insert through the service-role client, the faculty grant runs
--     faculty_verify_student and the admin grant runs
--     admin_set_student_verification (both SECURITY DEFINER), and the
--     provider flow writes with the service role in /student/verify — so
--     nothing is granted back for INSERT.
--
-- The student own-row INSERT/UPDATE policies from 20260918000000 become
-- unreachable (no table-level privilege left to fire them) and are dropped
-- so a future grant cannot silently re-enable them; the own-row SELECT
-- policy (profile/verify pages read verification_status) and the faculty
-- read policy stay. service_role is unaffected, so every admin, faculty
-- and provider path keeps working.
--
-- Idempotent: safe to run multiple times.

REVOKE INSERT, UPDATE ON student_profiles FROM authenticated;

GRANT UPDATE (section_id, updated_at) ON student_profiles TO authenticated;

DROP POLICY IF EXISTS "Students can insert own profile" ON student_profiles;
DROP POLICY IF EXISTS "Students can update own profile" ON student_profiles;
