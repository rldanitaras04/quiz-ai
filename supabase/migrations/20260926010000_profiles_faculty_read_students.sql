-- Faculty can read the profiles (name/email) of students enrolled in their
-- offerings. Mirrors "Faculty can read enrolled students" on student_profiles.
-- Without this, roster embeds of profiles(full_name, email) are RLS-filtered
-- to null for faculty sessions.

DROP POLICY IF EXISTS "Faculty can read student profiles in their offerings" ON profiles;
CREATE POLICY "Faculty can read student profiles in their offerings"
  ON profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM enrollments e
      JOIN faculty_assignments fa ON fa.subject_offering_id = e.subject_offering_id
      WHERE e.student_id = profiles.id
        AND fa.faculty_id = auth.uid()
    )
  );
