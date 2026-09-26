-- ============================================================================
-- Effective column-level write grants for exam tables
-- ============================================================================
-- security_hardening (20260918000000:726-727) tried to carve scoring columns
-- out of the authenticated UPDATE grant with a column-list REVOKE. That is a
-- no-op when the existing grant is table-level: verified on the live database,
-- authenticated still held UPDATE on every column of student_responses, and
-- the own-row RLS policies ("Students can update own response answers",
-- "Students can update own in-progress attempts") allow any column value on
-- matching rows. A student could therefore self-set earned_points/scoring_status
-- and extend their own attempt's expires_at through the REST API.
--
-- Fix: revoke the table-level grant, then re-grant only the columns the
-- session flows actually write:
--   * api/exam/save: selected_choice_id, text_answer, client_revision,
--     server_revision, updated_at (student_responses)
--   * api/exam/save: last_sync_at (exam_attempts)
-- Scoring columns remain service-role-only: all scoreAttempt/review-scoring
-- callers pass the admin client, and submitExam's status transition already
-- runs with the admin client.
--
-- RLS policies are untouched; this migration only corrects the privilege
-- layer. Idempotent: safe to run multiple times.

REVOKE UPDATE ON student_responses FROM authenticated;
GRANT UPDATE (selected_choice_id, text_answer, client_revision, server_revision, updated_at)
  ON student_responses TO authenticated;

REVOKE UPDATE ON exam_attempts FROM authenticated;
GRANT UPDATE (last_sync_at) ON exam_attempts TO authenticated;
