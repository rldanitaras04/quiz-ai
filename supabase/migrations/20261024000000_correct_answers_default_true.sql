-- The correct answer now SHOWS by default on released exam results
-- (the "Correct answer" column in the Question Review table).
--
-- 1) New deployments default to showing it.
-- 2) Existing rows were all created under the old default — the deploy screens
--    started the box unchecked (`useState(false)`) or hardcoded it (`false` in
--    the multi-section screen) — so nobody could have deliberately kept it off.
--    Flip them, matching the 20261022 item-correctness change; otherwise every
--    assessment already deployed keeps hiding the answer the review now shows.
--
-- Faculty can still opt out per deployment ("Correct answers" checkbox).
-- The key is still only revealed on released results: loadAttemptBreakdown
-- gates it on result.status = 'released' and strips the answer key server-side
-- before the payload reaches the browser.

ALTER TABLE public.assessment_deployments
  ALTER COLUMN show_correct_answers SET DEFAULT true;

UPDATE public.assessment_deployments
SET show_correct_answers = true
WHERE show_correct_answers IS DISTINCT FROM true;
