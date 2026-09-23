-- ============================================================================
-- Question Images: support images attached to questions (manual/bank/AI)
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Columns on questions and question_bank
-- ----------------------------------------------------------------------------
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE question_bank ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

-- Optional: choice-level images (for MCQ options that are diagrams)
ALTER TABLE question_choices ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE question_choices ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

ALTER TABLE question_bank_choices ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE question_bank_choices ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_questions_image_storage_path ON questions(image_storage_path);
CREATE INDEX IF NOT EXISTS idx_question_bank_image_storage_path ON question_bank(image_storage_path);

-- ----------------------------------------------------------------------------
-- 2. Storage bucket: question-images (public for student exam display)
--    Allow up to 10 MB per image, common web formats.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'question-images',
  'question-images',
  true,
  10485760, -- 10 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ----------------------------------------------------------------------------
-- 3. Storage policies for question-images
--    - Faculty (or super_admin) can upload/update/delete objects they own
--    - Any authenticated user can read (exam needs to show images to students)
--    The app writes with service_role; these policies lock the anon/authenticated
--    direct path but keep the public bucket readable.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read question images" ON storage.objects;
CREATE POLICY "Anyone can read question images"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'question-images');

-- Public read for unauthenticated preview (bucket is public, but keep RLS explicit)
DROP POLICY IF EXISTS "Public can read question images" ON storage.objects;
CREATE POLICY "Public can read question images"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'question-images');

DROP POLICY IF EXISTS "Faculty can upload question images" ON storage.objects;
CREATE POLICY "Faculty can upload question images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'question-images'
    AND (
      is_faculty_of_offering(auth.uid(), ((storage.foldername(name))[1])::uuid)
      OR is_super_admin(auth.uid())
      -- fallback: allow any faculty to upload to their own user folder
      OR (storage.foldername(name))[1] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "Faculty can update question images" ON storage.objects;
CREATE POLICY "Faculty can update question images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'question-images'
    AND (is_super_admin(auth.uid()) OR auth.uid()::text = (storage.owner)::text OR is_faculty_of_offering(auth.uid(), ((storage.foldername(name))[1])::uuid))
  );

DROP POLICY IF EXISTS "Faculty can delete question images" ON storage.objects;
CREATE POLICY "Faculty can delete question images"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'question-images'
    AND (is_super_admin(auth.uid()) OR auth.uid()::text = (storage.owner)::text OR is_faculty_of_offering(auth.uid(), ((storage.foldername(name))[1])::uuid))
  );
