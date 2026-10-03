-- Re-assert the security posture of the `source-materials` bucket.
--
-- Drift discovered by the scope §39 anonymous-access probe
-- (scripts/e2e-exam.mjs → testScopeSecurity): despite
-- 20260920000000 declaring the bucket private, the live row was found with
-- public = true — which bypasses ALL storage.objects policies for object
-- reads, letting anyone holding an object URL fetch faculty source material.
-- The application never reads source objects via public URLs (uploads and
-- text extraction use the service role), so private is both safe and
-- required: scope §39 — "anonymous users cannot access protected source
-- files."
--
-- This migration re-asserts `public = false` and recreates the four
-- faculty-of-offering policies verbatim from 20260920000000 so the end
-- state is correct regardless of which piece drifted. Idempotent.
--
-- The e2e exam suite now guards this permanently: anon GET ≠ 200,
-- student GET ≠ 200, assigned-faculty GET = 200.

UPDATE storage.buckets
   SET public = false
 WHERE id = 'source-materials';

DROP POLICY IF EXISTS "Faculty can read source objects of their offerings" ON storage.objects;
CREATE POLICY "Faculty can read source objects of their offerings"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'source-materials'
    AND is_faculty_of_offering(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

DROP POLICY IF EXISTS "Faculty can upload source objects to their offerings" ON storage.objects;
CREATE POLICY "Faculty can upload source objects to their offerings"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'source-materials'
    AND is_faculty_of_offering(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

DROP POLICY IF EXISTS "Faculty can replace source objects of their offerings" ON storage.objects;
CREATE POLICY "Faculty can replace source objects of their offerings"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'source-materials'
    AND is_faculty_of_offering(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );

DROP POLICY IF EXISTS "Faculty can delete source objects of their offerings" ON storage.objects;
CREATE POLICY "Faculty can delete source objects of their offerings"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'source-materials'
    AND is_faculty_of_offering(
      auth.uid(),
      ((storage.foldername(name))[1])::uuid
    )
  );
