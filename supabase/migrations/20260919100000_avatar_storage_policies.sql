-- ============================================================================
-- Storage policies: quiz-ai-bucket/avatar
--
-- The bucket is PUBLIC (reads require no policy beyond public access), with
-- bucket-level limits (2 MB, image MIME only) already configured on the
-- bucket itself. These policies govern WRITES by logged-in users:
--   - a user may create/update/delete only their own avatar/<uid>.*
--   - no one but the owner (or service role) can touch others' objects
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- Own-object writes. storage.foldername() splits the object path, so
-- folder[1] = 'avatar' and folder[2] = the owner's user id.
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'quiz-ai-bucket'
    AND (storage.foldername(name))[1] = 'avatar'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'quiz-ai-bucket'
    AND (storage.foldername(name))[1] = 'avatar'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'quiz-ai-bucket'
    AND (storage.foldername(name))[1] = 'avatar'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Note: the uploads run through the service-role client in the app (which
-- bypasses RLS), but these policies protect the bucket from direct client
-- use of the anon key. Owners are still enforced app-side (path = own uid).
