-- ============================================================================
-- Identification scoring tiers — scope §26 (Automated Score and Item
-- Information).
-- ============================================================================
-- src/lib/identification-match.ts grades free-text identification answers in
-- tiers instead of a bare exact match:
--
--   * exact / approved-alias match, or fuzzy similarity >= 0.9 → machine
--     scores the response (`scoring_status = 'auto_scored'`, points awarded);
--   * fuzzy similarity in [0.6, 0.9) → the verdict is held for faculty
--     (`scoring_status = 'manual_review'`, `earned_points = NULL` so the
--     provisional result counts the item as 0 until confirmed);
--   * below 0.6 → machine scores it incorrect (still reaches faculty through
--     the earned_points = 0 review filter).
--
-- `scoring_metadata` records how the machine reached its verdict
-- { method, similarity, candidate } plus any faculty override provenance, so
-- an auto-score can be audited later (scope §26: "Store rationale +
-- confidence per response (auditability...)").
--
-- Divergence fixed here: src/lib/types.ts (ScoringStatus) already declares
-- 'auto_scored' | 'manual_review' and the review queue / submission
-- notification filters (review/actions.ts, exam/actions.ts) already select on
-- 'manual_review', but the table CHECK constraint (20260918000000) only
-- allowed pending/correct/incorrect/partial/scored — a held response would be
-- rejected on write. The CHECK becomes the union of both vocabularies; the
-- legacy five values stay allowed so existing rows remain valid.
-- (See the privilege note next to the REVOKE statements below.)

ALTER TABLE student_responses
  DROP CONSTRAINT IF EXISTS student_responses_scoring_status_check;

ALTER TABLE student_responses
  ADD CONSTRAINT student_responses_scoring_status_check
  CHECK (scoring_status IN (
    'pending',
    'correct',
    'incorrect',
    'partial',
    'scored',
    'auto_scored',
    'manual_review'
  ));

ALTER TABLE student_responses
  ADD COLUMN IF NOT EXISTS scoring_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Privilege: `scoring_metadata` must be service-role only. Students hold no
-- table-level grant on student_responses (20260918000000 revoked DELETE,
-- 20260930000003 revoked UPDATE, 20261005000000 revoked SELECT/INSERT) and
-- their column-level grants enumerate specific columns, so this new column
-- inherits nothing. The explicit column-level revokes below document that
-- intent and hold even if table-wide default privileges return. PostgreSQL
-- allows a column list only on one SELECT/INSERT/UPDATE/REFERENCES privilege
-- at a time; DELETE is table-level only and is covered by 20260918000000.

REVOKE SELECT (scoring_metadata) ON student_responses FROM anon, authenticated;
REVOKE INSERT (scoring_metadata) ON student_responses FROM anon, authenticated;
REVOKE UPDATE (scoring_metadata) ON student_responses FROM anon, authenticated;

COMMENT ON COLUMN student_responses.scoring_metadata IS
  'Machine scoring verdict evidence for this response: { method: exact | alias | fuzzy | choice | none, similarity: 0..1, candidate: matched reference answer } and, once a faculty member overrides it, { faculty: { points, at } }. Service-role only — never exposed to students.';

COMMENT ON CONSTRAINT student_responses_scoring_status_check ON student_responses IS
  'Scoring vocabulary (scope §26 tiers): pending = not yet scored; auto_scored = machine verdict; manual_review = held for faculty with earned_points NULL; scored = faculty-confirmed (scored_by set); correct/incorrect/partial = legacy values kept for existing rows.';
