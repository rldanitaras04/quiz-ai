-- ============================================================================
-- Close the pre-release score leak on student_responses
-- ============================================================================
-- 20260918000000:625 gives students a SELECT policy on their own response
-- rows, and 20260930000003 only carved the WRITE columns out of the grant.
-- SELECT was still table-level, so any student could read their own
-- earned_points / scoring_status / scored_at / scored_by / normalized_answer
-- through PostgREST the instant scoring finished — before faculty released
-- the result, and regardless of the deployment's show_item_correctness flag.
-- loadAttemptBreakdown gates all of that server-side, but the raw rows stayed
-- fetchable with nothing more than the student's own session token.
--
-- Same reasoning as 20260930000003, on the read side:
--   * revoke the table-level SELECT, then grant back only the columns the
--     exam flow needs to restore a paper: ids, answers, revisions, timestamps;
--   * drop the session write path entirely. Every response row is created and
--     updated by the service-role client (applyResponseOperations in
--     src/lib/exam-sync.ts; scoring and faculty review writes pass the admin
--     client), so no session path needs INSERT or UPDATE here. This also
--     stops a student editing answers after the deadline directly through
--     PostgREST, bypassing the window checks in /api/exam/save.
--
-- PostgreSQL note (GRANT docs): a table-level grant is unaffected by a
-- column-level REVOKE, which is why the table-level revoke comes first and
-- the permitted columns are then granted back explicitly.
--
-- Read paths after this migration:
--   * student paper restore: session client, granted columns only
--     (getAttemptDetails in student .../exam/actions.ts);
--   * faculty identification review + analytics: authorize with the session
--     client (getFacultyAssessment / isFacultyOfOfferingOrSubject), then read
--     with the service-role client — the same gates-then-admin pattern
--     loadAttemptBreakdown already uses;
--   * scoring, sync and the released-result breakdown: service-role client.
--
-- service_role is unaffected (owner-level grants), so every admin path keeps
-- working. Idempotent: safe to run multiple times.

REVOKE SELECT ON student_responses FROM authenticated;
GRANT SELECT (id, attempt_id, question_id, selected_choice_id, text_answer,
              client_revision, server_revision, last_operation_id,
              created_at, updated_at)
  ON student_responses TO authenticated;

REVOKE INSERT, UPDATE ON student_responses FROM authenticated;

-- anon holds the default Supabase table grants but no policy on this table;
-- remove the privilege itself (same reasoning as 20261003000000).
REVOKE SELECT, INSERT, UPDATE, DELETE ON student_responses FROM anon;
