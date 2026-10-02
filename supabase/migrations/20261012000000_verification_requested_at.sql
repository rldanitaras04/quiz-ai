-- Student-initiated manual verification request (scope §5 "faculty-authorized
-- fallback"): the roster's Verify button existed, but a student who could not
-- or preferred not to use the camera check had no in-app way to ASK — the
-- manual path only worked if they found their instructor in person.
--
-- `verification_requested_at` records when the student last asked, so:
--   * the /student/verify page can show a "waiting for your instructor"
--     state instead of a dead-end button;
--   * repeat requests inside the cooldown (15 min) send no new faculty
--     notifications (idempotency checked server-side in
--     requestManualVerification).
--
-- Privileges: 20261011000000 revoked table-level INSERT/UPDATE from
-- `authenticated` and granted back only (section_id, updated_at), so this
-- column is WRITABLE BY THE SERVICE ROLE ONLY by default — exactly like the
-- five verification_* columns — and readable through the existing own-row
-- SELECT policy (the student page shows the pending state). Nothing else is
-- granted here.
--
-- A request never changes verification_status: only a faculty grant
-- (faculty_verify_student), a super-admin grant
-- (admin_set_student_verification) or a successful provider settle
-- (/student/verify) may do that.
--
-- Idempotent: safe to run multiple times.

ALTER TABLE student_profiles
  ADD COLUMN IF NOT EXISTS verification_requested_at TIMESTAMPTZ;
