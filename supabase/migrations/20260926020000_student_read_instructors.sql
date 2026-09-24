-- Students can see who teaches offerings they are enrolled in (Instructor
-- column on My Subjects / offering detail). Without these, the
-- faculty_assignments and profiles embeds are RLS-filtered for students.

DROP POLICY IF EXISTS "Enrolled students can read faculty_assignments" ON faculty_assignments;
CREATE POLICY "Enrolled students can read faculty_assignments"
  ON faculty_assignments FOR SELECT TO authenticated
  USING (is_enrolled_in_offering(auth.uid(), subject_offering_id));

DROP POLICY IF EXISTS "Students can read instructors' profiles" ON profiles;
CREATE POLICY "Students can read instructors' profiles"
  ON profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM enrollments e
      JOIN faculty_assignments fa ON fa.subject_offering_id = e.subject_offering_id
      WHERE e.student_id = auth.uid()
        AND fa.faculty_id = profiles.id
    )
  );
