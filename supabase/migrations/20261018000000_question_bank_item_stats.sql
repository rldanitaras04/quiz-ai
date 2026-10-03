-- ----------------------------------------------------------------------------
-- Question bank: historical item statistics (scope §30).
--
-- "Metadata: … usage count; last used; historical item statistics; distractor
--  performance; status." The bank already carries usage_count/last_used_at and
--  provenance (source_question_id/source_metadata); this adds the item
--  statistics snapshot written when an assessment's questions are saved to the
--  bank (saveAssessmentQuestionToBank / saveAssessmentQuestionsToBank).
--
-- Shape (see ItemStatsSnapshot in src/lib/item-analysis.ts):
--   { n, correct_count, difficulty_index, discrimination_index,
--     distractors: [{ choice_key, selections, percentage, is_correct }],
--     computed_at }
-- Null until the source question has scored responses — a never-attempted
-- question simply has no history to report.
-- ----------------------------------------------------------------------------

ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS item_stats JSONB;

COMMENT ON COLUMN question_bank.item_stats IS
  'Historical item statistics snapshot at bank-save time (scope §30): n/correct_count/difficulty_index/discrimination_index plus distractor performance. Null when the source question has no scored responses.';
