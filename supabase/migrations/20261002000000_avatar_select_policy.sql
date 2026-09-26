-- ============================================================================
-- Storage policies: quiz-ai-bucket/avatar — SELECT visibility
--
-- The avatar folder already has INSERT / UPDATE / DELETE policies, but no
-- SELECT policy. That breaks every Storage API path that must SEE the row:
--   * `INSERT ... ON CONFLICT DO UPDATE ... RETURNING *` (the `x-upsert`
--     upload used by the app) fails with "new row violates row-level security
--     policy", because PostgreSQL applies SELECT-policy visibility to rows
--     produced by RETURNING.
--   * `SELECT ... FOR UPDATE` object lookups return 0 rows, so the API treats
--     an existing avatar as missing ("Access denied" on DELETE / 409 on
--     re-upload).
-- The bucket is PUBLIC for reads; this policy only makes a user's OWN avatar
-- row visible to that user's DB session — it grants no access to other users'
-- rows and does not widen write access.
-- Idempotent: safe to run multiple times.
-- ============================================================================

DROP POLICY IF EXISTS "Users can read own avatar" ON storage.objects;
CREATE POLICY "Users can read own avatar"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'quiz-ai-bucket'
    AND (storage.foldername(name))[1] = 'avatar'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
