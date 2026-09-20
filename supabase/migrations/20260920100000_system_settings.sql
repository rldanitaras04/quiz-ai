-- ============================================================================
-- System settings
--
-- The super administrator's brief includes configuring "system-wide settings,
-- AI providers, limits" (features/scope §2.1), and the database architecture
-- lists a `system_settings` table for exactly that (`id`, `key`, `value jsonb`,
-- `is_sensitive`, timestamps). Neither existed, so /admin/settings could only
-- display values that were hard-coded in the application.
--
-- Shape and rules:
--   - key/value rows the application reads through `src/lib/settings.ts`, which
--     falls back to the constants in `src/lib/constants.ts` when a row is absent
--     or the read fails — a missing row can never break uploads or generation;
--   - `is_sensitive` marks values that must NOT be shown or edited in the admin
--     UI. Secrets belong in environment/secret management, not here, so nothing
--     the operator edits is flagged; an operator-inserted sensitive row is
--     simply never surfaced by the UI;
--   - reads are open to authenticated users because the values are operational
--     (upload ceiling, list size) and faculty-facing pages render them as hints;
--     writes are super_admin only, matching every other admin table.
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  is_sensitive BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read system settings" ON system_settings;
CREATE POLICY "Authenticated users can read system settings"
  ON system_settings FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage system settings" ON system_settings;
CREATE POLICY "Admin can manage system settings"
  ON system_settings FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- Seed the defaults the application itself falls back to, so a fresh database
-- and a freshly migrated one behave identically. ON CONFLICT leaves any value
-- an operator has already saved untouched.
-- ----------------------------------------------------------------------------

INSERT INTO system_settings (key, value) VALUES
  ('max_upload_size_mb', '50'::jsonb),
  ('similarity_threshold', '0.9'::jsonb),
  ('default_page_size', '20'::jsonb)
ON CONFLICT (key) DO NOTHING;
