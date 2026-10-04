-- Per-item correctness now SHOWS by default on released exam results
-- (red/green answer tint, Correct/Incorrect badge, earned/possible points).
--
-- 1) New deployments default to showing it.
-- 2) Existing rows were all created under the old default — the single-section
--    deploy screen started the checkbox unchecked and the multi-section screen
--    hardcoded `false` — so nobody could have deliberately kept it off. Flip
--    them, otherwise every assessment already deployed keeps hiding the
--    per-item review the product now expects to show.
--
-- Faculty can still opt out per deployment ("Per-question correctness"
-- checkbox), and `show_correct_answers` (revealing the answer key) keeps its
-- own separate flag — that one still defaults to false.

ALTER TABLE public.assessment_deployments
  ALTER COLUMN show_item_correctness SET DEFAULT true;

UPDATE public.assessment_deployments
SET show_item_correctness = true
WHERE show_item_correctness IS DISTINCT FROM true;
