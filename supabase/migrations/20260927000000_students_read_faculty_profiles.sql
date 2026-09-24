-- Students join faculty_assignments → faculty_profiles → profiles to show the
-- instructor name. faculty_assignments and profiles already have student
-- SELECT policies, but faculty_profiles still only allows faculty to read
-- their own row — so the embed is RLS-filtered and the UI shows "Unassigned".

DROP POLICY IF EXISTS "Enrolled students can read instructors' faculty_profiles" ON faculty_profiles;
CREATE POLICY "Enrolled students can read instructors' faculty_profiles"
  ON faculty_profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM enrollments e
      JOIN faculty_assignments fa ON fa.subject_offering_id = e.subject_offering_id
      WHERE e.student_id = auth.uid()
        AND e.status = 'enrolled'
        AND fa.faculty_id = faculty_profiles.user_id
    )
  );
