-- ============================================================================
-- Subject-level assessment visibility
-- ============================================================================
-- An assessment is stamped with one subject_offering_id (its "home" section)
-- but belongs to the subject. Faculty assigned to any offering of that subject
-- must be able to read/manage it, list it from every section of the subject,
-- and deploy it to any section they teach. Students must be able to read a
-- published assessment that has been deployed to an offering they are enrolled
-- in, even when the assessment's home offering is a sibling section.
--
-- Idempotent: safe to run multiple times.

-- ----------------------------------------------------------------------------
-- Faculty can read every offering of a subject they teach (listing / deploy
-- pickers need sibling sections). Writes to enrollments, deployments, etc.
-- remain gated per-offering by their own policies.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can read assigned subject_offerings" ON subject_offerings;
DROP POLICY IF EXISTS "Faculty can read subject_offerings for assigned subjects" ON subject_offerings;
CREATE POLICY "Faculty can read subject_offerings for assigned subjects"
  ON subject_offerings FOR SELECT TO authenticated
  USING (
    is_faculty_of_offering(auth.uid(), id)
    OR is_faculty_of_subject(auth.uid(), subject_id)
  );

-- ----------------------------------------------------------------------------
-- Assessments: faculty manage when assigned to the home offering OR any
-- offering of the same subject.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can manage assessments" ON assessments;
CREATE POLICY "Faculty can manage assessments"
  ON assessments FOR ALL TO authenticated
  USING (
    is_faculty_of_offering(auth.uid(), subject_offering_id)
    OR is_faculty_of_subject(
      auth.uid(),
      (SELECT so.subject_id FROM subject_offerings so WHERE so.id = assessments.subject_offering_id)
    )
  );

-- Students: published AND (enrolled in the home offering OR enrolled in an
-- offering that has a deployment of this assessment).
DROP POLICY IF EXISTS "Students can read published assessments" ON assessments;
CREATE POLICY "Students can read published assessments"
  ON assessments FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND (
      is_enrolled_in_offering(auth.uid(), subject_offering_id)
      OR EXISTS (
        SELECT 1
        FROM assessment_deployments d
        WHERE d.assessment_id = assessments.id
          AND is_enrolled_in_offering(auth.uid(), d.subject_offering_id)
      )
    )
  );

-- ----------------------------------------------------------------------------
-- Versions / content: same subject-level faculty rule; students get access
-- when enrolled in the home offering OR any offering with a deployment.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can manage assessment_versions" ON assessment_versions;
CREATE POLICY "Faculty can manage assessment_versions"
  ON assessment_versions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessments a
      WHERE a.id = assessment_versions.assessment_id
        AND (
          is_faculty_of_offering(auth.uid(), a.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = a.subject_offering_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "Students can read versions in enrolled offerings" ON assessment_versions;
CREATE POLICY "Students can read versions in enrolled offerings"
  ON assessment_versions FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessments a
      WHERE a.id = assessment_versions.assessment_id
        AND (
          is_enrolled_in_offering(auth.uid(), a.subject_offering_id)
          OR EXISTS (
            SELECT 1
            FROM assessment_deployments d
            WHERE d.assessment_id = a.id
              AND is_enrolled_in_offering(auth.uid(), d.subject_offering_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "Faculty can manage questions" ON questions;
CREATE POLICY "Faculty can manage questions"
  ON questions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessment_versions av
      JOIN assessments a ON a.id = av.assessment_id
      WHERE av.id = questions.assessment_version_id
        AND (
          is_faculty_of_offering(auth.uid(), a.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = a.subject_offering_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "Faculty can manage question_choices" ON question_choices;
CREATE POLICY "Faculty can manage question_choices"
  ON question_choices FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM questions q
      JOIN assessment_versions av ON av.id = q.assessment_version_id
      JOIN assessments a ON a.id = av.assessment_id
      WHERE q.id = question_choices.question_id
        AND (
          is_faculty_of_offering(auth.uid(), a.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = a.subject_offering_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "Faculty can manage answer_keys" ON answer_keys;
CREATE POLICY "Faculty can manage answer_keys"
  ON answer_keys FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM questions q
      JOIN assessment_versions av ON av.id = q.assessment_version_id
      JOIN assessments a ON a.id = av.assessment_id
      WHERE q.id = answer_keys.question_id
        AND (
          is_faculty_of_offering(auth.uid(), a.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = a.subject_offering_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "Faculty can manage question_sources" ON question_sources;
CREATE POLICY "Faculty can manage question_sources"
  ON question_sources FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM questions q
      JOIN assessment_versions av ON av.id = q.assessment_version_id
      JOIN assessments a ON a.id = av.assessment_id
      WHERE q.id = question_sources.question_id
        AND (
          is_faculty_of_offering(auth.uid(), a.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = a.subject_offering_id)
          )
        )
    )
  );

DROP POLICY IF EXISTS "Faculty can manage assessment_generation_jobs" ON assessment_generation_jobs;
CREATE POLICY "Faculty can manage assessment_generation_jobs"
  ON assessment_generation_jobs FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessments a
      WHERE a.id = assessment_generation_jobs.assessment_id
        AND (
          is_faculty_of_offering(auth.uid(), a.subject_offering_id)
          OR is_faculty_of_subject(
            auth.uid(),
            (SELECT so.subject_id FROM subject_offerings so WHERE so.id = a.subject_offering_id)
          )
        )
    )
  );

-- assessment_topics already ORs is_faculty_of_subject (20260923000000).
