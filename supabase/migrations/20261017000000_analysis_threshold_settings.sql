-- ----------------------------------------------------------------------------
-- Item and distractor analysis thresholds (scope §29).
--
-- "Interpretation thresholds must be configurable and treated as analytic
--  guidance, not unquestionable conclusions."
--
-- Seeds the defaults the application falls back to (src/lib/constants.ts
-- SETTING_DEFS), so a freshly migrated database and the code agree. Admins
-- edit them at /admin/settings; ON CONFLICT leaves saved values untouched.
-- ----------------------------------------------------------------------------

INSERT INTO system_settings (key, value) VALUES
  ('analysis_group_percent', '27'::jsonb),
  ('analysis_pass_mark', '60'::jsonb),
  ('analysis_easy_p', '0.9'::jsonb),
  ('analysis_hard_p', '0.3'::jsonb),
  ('analysis_min_disc', '0.1'::jsonb),
  ('analysis_good_d', '0.3'::jsonb),
  ('analysis_fair_d', '0.2'::jsonb),
  ('analysis_low_distractor_pct', '5'::jsonb)
ON CONFLICT (key) DO NOTHING;
