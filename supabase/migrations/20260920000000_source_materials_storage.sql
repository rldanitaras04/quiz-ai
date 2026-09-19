-- ============================================================================
-- Storage: private `source-materials` bucket
--
-- The application uploads faculty source material to a bucket named
-- `source-materials` (/api/sources/upload), but no migration ever created it —
-- every upload failed unless an operator had created the bucket by hand in the
-- dashboard. This migration creates it (private, 50 MB, text-extractable
-- MIME types only) and adds policies for direct authenticated access.
--
-- Object paths are `${subject_offering_id}/${timestamp}.${ext}`, so
-- storage.foldername(name)[1] is the subject offering id and access can be tied
-- to faculty assignment — the database architecture's requirement that source
-- material access follow authorization, not just the application layer.
--
-- The application itself writes and reads with the service-role client (which
-- bypasses these policies); the policies close the anon-key path.
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'source-materials',
  'source-materials',
  false,
  52428800, -- 50 MB, matching MAX_FILE_SIZE_MB
  ARRAY[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- Access policies: only faculty assigned to the offering may touch its objects
-- ----------------------------------------------------------------------------
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
