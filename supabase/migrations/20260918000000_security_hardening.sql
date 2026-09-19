-- ============================================================================
-- Reconciliation + Row Level Security Hardening
--
-- PART A reconciles databases created through the /setup wizard SQL to the
-- v2 application schema: missing columns (deployment/attempt version links,
-- topic_id, show_explanations) and widened CHECK constraints so every value
-- the application writes is accepted.
--
-- PART B enables RLS on every table and installs the COMPLETE policy layer
-- deterministically: every policy is dropped (IF EXISTS) and recreated, so
-- the end state is identical whether or not the original migration's policy
-- section was ever applied. Hardened relative to the original: no student
-- DELETE on exam data, no scoring-column writes by students, no user-forged
-- notifications/audit logs/AI-usage rows, and INSERT paths required by the
-- registration flow are explicitly scoped to self + non-admin roles.
--
-- Idempotent: safe to run multiple times.
-- ============================================================================

-- ============================================================================
-- PART A — SCHEMA RECONCILIATION
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1. Missing columns
-- ----------------------------------------------------------------------------

ALTER TABLE assessment_deployments ADD COLUMN IF NOT EXISTS assessment_version_id UUID REFERENCES assessment_versions(id) ON DELETE CASCADE;
ALTER TABLE assessment_deployments ADD COLUMN IF NOT EXISTS show_explanations BOOLEAN DEFAULT false;

ALTER TABLE exam_attempts ADD COLUMN IF NOT EXISTS assessment_version_id UUID REFERENCES assessment_versions(id) ON DELETE CASCADE;

ALTER TABLE source_materials ADD COLUMN IF NOT EXISTS topic_id UUID;

-- ----------------------------------------------------------------------------
-- A2. assessments.current_version_id: the setup SQL created the column
--     without its FK. Add it (no-op if it already exists).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessments_current_version_id_fkey'
      AND conrelid = 'assessments'::regclass
  ) THEN
    ALTER TABLE assessments
      ADD CONSTRAINT assessments_current_version_id_fkey
      FOREIGN KEY (current_version_id) REFERENCES assessment_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- A3. Widen CHECK constraints to the vocabularies the application writes.
--     Constraint names are Postgres' deterministic auto-names
--     (<table>_<column>_check); each is dropped and re-added with the full
--     value set. No-op-safe: IF EXISTS guards each drop.
-- ----------------------------------------------------------------------------

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_status_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_status_check
  CHECK (status IN ('active', 'inactive', 'suspended', 'pending'));

ALTER TABLE enrollments DROP CONSTRAINT IF EXISTS enrollments_status_check;
ALTER TABLE enrollments ADD CONSTRAINT enrollments_status_check
  CHECK (status IN ('enrolled', 'dropped', 'completed', 'withdrawn'));

ALTER TABLE source_materials DROP CONSTRAINT IF EXISTS source_materials_source_type_check;
ALTER TABLE source_materials ADD CONSTRAINT source_materials_source_type_check
  CHECK (source_type IN ('pdf', 'docx', 'txt', 'manual', 'file'));

ALTER TABLE source_materials DROP CONSTRAINT IF EXISTS source_materials_processing_status_check;
ALTER TABLE source_materials ADD CONSTRAINT source_materials_processing_status_check
  CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'ready'));

ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_assessment_type_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_assessment_type_check
  CHECK (assessment_type IN ('quiz', 'exam', 'assignment', 'custom', 'multiple_choice', 'identification'));

ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_status_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_status_check
  CHECK (status IN ('draft', 'approved', 'published', 'archived'));

ALTER TABLE assessment_versions DROP CONSTRAINT IF EXISTS assessment_versions_status_check;
ALTER TABLE assessment_versions ADD CONSTRAINT assessment_versions_status_check
  CHECK (status IN ('draft', 'approved', 'published', 'archived'));

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_status_check;
ALTER TABLE questions ADD CONSTRAINT questions_status_check
  CHECK (status IN ('draft', 'published', 'archived', 'active', 'approved'));

ALTER TABLE assessment_generation_jobs DROP CONSTRAINT IF EXISTS assessment_generation_jobs_status_check;
ALTER TABLE assessment_generation_jobs ADD CONSTRAINT assessment_generation_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'queued', 'in_progress', 'cancelled'));

ALTER TABLE assessment_deployments DROP CONSTRAINT IF EXISTS assessment_deployments_question_order_mode_check;
ALTER TABLE assessment_deployments ADD CONSTRAINT assessment_deployments_question_order_mode_check
  CHECK (question_order_mode IN ('fixed', 'random', 'shuffled'));

ALTER TABLE assessment_deployments DROP CONSTRAINT IF EXISTS assessment_deployments_choice_order_mode_check;
ALTER TABLE assessment_deployments ADD CONSTRAINT assessment_deployments_choice_order_mode_check
  CHECK (choice_order_mode IN ('fixed', 'random', 'shuffled'));

ALTER TABLE assessment_deployments DROP CONSTRAINT IF EXISTS assessment_deployments_score_release_mode_check;
ALTER TABLE assessment_deployments ADD CONSTRAINT assessment_deployments_score_release_mode_check
  CHECK (score_release_mode IN ('immediate', 'after_close', 'manual', 'after_all_submitted', 'manual_release', 'scheduled'));

ALTER TABLE assessment_deployments DROP CONSTRAINT IF EXISTS assessment_deployments_status_check;
ALTER TABLE assessment_deployments ADD CONSTRAINT assessment_deployments_status_check
  CHECK (status IN ('draft', 'scheduled', 'active', 'closed', 'archived'));

ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_status_check;
ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_check
  CHECK (status IN ('created', 'in_progress', 'submitted', 'timed_out', 'cancelled', 'auto_submitted', 'expired', 'invalidated'));

ALTER TABLE student_responses DROP CONSTRAINT IF EXISTS student_responses_scoring_status_check;
ALTER TABLE student_responses ADD CONSTRAINT student_responses_scoring_status_check
  CHECK (scoring_status IN ('pending', 'correct', 'incorrect', 'partial', 'scored'));

-- ----------------------------------------------------------------------------
-- A4. Indexes for newly added columns
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_assessment_deployments_version_id ON assessment_deployments(assessment_version_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_version_id ON exam_attempts(assessment_version_id);

-- ============================================================================
-- PART B — ROW LEVEL SECURITY (enable + full deterministic policy set)
-- ============================================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE semesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE year_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_offerings ENABLE ROW LEVEL SECURITY;
ALTER TABLE faculty_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE answer_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE question_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- B1. profiles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "Admin can manage all profiles" ON profiles;
CREATE POLICY "Admin can manage all profiles"
  ON profiles FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- B2. user_roles
--     Registration may assign ONLY student/faculty to itself; super_admin is
--     granted exclusively through the service-role client (bootstrap route)
--     or direct DB administration.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can read own roles" ON user_roles;
CREATE POLICY "Users can read own roles"
  ON user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own non-admin roles" ON user_roles;
CREATE POLICY "Users can insert own non-admin roles"
  ON user_roles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND role IN ('student', 'faculty'));

DROP POLICY IF EXISTS "Admin can manage all user roles" ON user_roles;
CREATE POLICY "Admin can manage all user roles"
  ON user_roles FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- B3. student_profiles / faculty_profiles
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Students can read own profile" ON student_profiles;
CREATE POLICY "Students can read own profile"
  ON student_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Students can insert own profile" ON student_profiles;
CREATE POLICY "Students can insert own profile"
  ON student_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Students can update own profile" ON student_profiles;
CREATE POLICY "Students can update own profile"
  ON student_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Faculty can read enrolled students" ON student_profiles;
CREATE POLICY "Faculty can read enrolled students"
  ON student_profiles FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM enrollments e
      JOIN faculty_assignments fa ON fa.subject_offering_id = e.subject_offering_id
      WHERE e.student_id = student_profiles.user_id
        AND fa.faculty_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admin can manage all student profiles" ON student_profiles;
CREATE POLICY "Admin can manage all student profiles"
  ON student_profiles FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Faculty can read own profile" ON faculty_profiles;
CREATE POLICY "Faculty can read own profile"
  ON faculty_profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Faculty can insert own profile" ON faculty_profiles;
CREATE POLICY "Faculty can insert own profile"
  ON faculty_profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Faculty can update own profile" ON faculty_profiles;
CREATE POLICY "Faculty can update own profile"
  ON faculty_profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admin can manage all faculty profiles" ON faculty_profiles;
CREATE POLICY "Admin can manage all faculty profiles"
  ON faculty_profiles FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

-- ----------------------------------------------------------------------------
-- B4. Academic reference tables: admin writes, authenticated reads
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can manage academic years" ON academic_years;
CREATE POLICY "Admin can manage academic years"
  ON academic_years FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read academic years" ON academic_years;
CREATE POLICY "Authenticated users can read academic years"
  ON academic_years FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage semesters" ON semesters;
CREATE POLICY "Admin can manage semesters"
  ON semesters FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read semesters" ON semesters;
CREATE POLICY "Authenticated users can read semesters"
  ON semesters FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage programs" ON programs;
CREATE POLICY "Admin can manage programs"
  ON programs FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read programs" ON programs;
CREATE POLICY "Authenticated users can read programs"
  ON programs FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage year_levels" ON year_levels;
CREATE POLICY "Admin can manage year_levels"
  ON year_levels FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read year_levels" ON year_levels;
CREATE POLICY "Authenticated users can read year_levels"
  ON year_levels FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage sections" ON sections;
CREATE POLICY "Admin can manage sections"
  ON sections FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read sections" ON sections;
CREATE POLICY "Authenticated users can read sections"
  ON sections FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admin can manage subjects" ON subjects;
CREATE POLICY "Admin can manage subjects"
  ON subjects FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Authenticated users can read subjects" ON subjects;
CREATE POLICY "Authenticated users can read subjects"
  ON subjects FOR SELECT TO authenticated
  USING (true);

-- ----------------------------------------------------------------------------
-- B5. Offerings / assignments / enrollments
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can manage subject_offerings" ON subject_offerings;
CREATE POLICY "Admin can manage subject_offerings"
  ON subject_offerings FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Faculty can read assigned subject_offerings" ON subject_offerings;
CREATE POLICY "Faculty can read assigned subject_offerings"
  ON subject_offerings FOR SELECT TO authenticated
  USING (is_faculty_of_offering(auth.uid(), id));

DROP POLICY IF EXISTS "Enrolled students can read subject_offerings" ON subject_offerings;
CREATE POLICY "Enrolled students can read subject_offerings"
  ON subject_offerings FOR SELECT TO authenticated
  USING (is_enrolled_in_offering(auth.uid(), id));

DROP POLICY IF EXISTS "Admin can manage faculty_assignments" ON faculty_assignments;
CREATE POLICY "Admin can manage faculty_assignments"
  ON faculty_assignments FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Faculty can read own assignments" ON faculty_assignments;
CREATE POLICY "Faculty can read own assignments"
  ON faculty_assignments FOR SELECT TO authenticated
  USING (faculty_id = auth.uid());

DROP POLICY IF EXISTS "Admin can manage enrollments" ON enrollments;
CREATE POLICY "Admin can manage enrollments"
  ON enrollments FOR ALL TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Students can read own enrollments" ON enrollments;
CREATE POLICY "Students can read own enrollments"
  ON enrollments FOR SELECT TO authenticated
  USING (student_id = auth.uid());

DROP POLICY IF EXISTS "Faculty can read enrollments for their offerings" ON enrollments;
CREATE POLICY "Faculty can read enrollments for their offerings"
  ON enrollments FOR SELECT TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

-- Faculty enrollment management (add-student / withdraw flows run through
-- the user's session and were previously denied by RLS).
DROP POLICY IF EXISTS "Faculty can enroll students in their offerings" ON enrollments;
CREATE POLICY "Faculty can enroll students in their offerings"
  ON enrollments FOR INSERT TO authenticated
  WITH CHECK (is_faculty_of_offering(auth.uid(), subject_offering_id));

DROP POLICY IF EXISTS "Faculty can update enrollments for their offerings" ON enrollments;
CREATE POLICY "Faculty can update enrollments for their offerings"
  ON enrollments FOR UPDATE TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id))
  WITH CHECK (is_faculty_of_offering(auth.uid(), subject_offering_id));

-- ----------------------------------------------------------------------------
-- B6. Source materials / chunks
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can manage source_materials" ON source_materials;
CREATE POLICY "Faculty can manage source_materials"
  ON source_materials FOR ALL TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

DROP POLICY IF EXISTS "Faculty can read source_chunks" ON source_chunks;
CREATE POLICY "Faculty can read source_chunks"
  ON source_chunks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM source_materials sm
      WHERE sm.id = source_chunks.source_material_id
        AND is_faculty_of_offering(auth.uid(), sm.subject_offering_id)
    )
  );

-- ----------------------------------------------------------------------------
-- B7. Assessments + versions
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can manage assessments" ON assessments;
CREATE POLICY "Faculty can manage assessments"
  ON assessments FOR ALL TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

DROP POLICY IF EXISTS "Students can read published assessments" ON assessments;
CREATE POLICY "Students can read published assessments"
  ON assessments FOR SELECT TO authenticated
  USING (
    status = 'published'
    AND is_enrolled_in_offering(auth.uid(), subject_offering_id)
  );

DROP POLICY IF EXISTS "Faculty can manage assessment_versions" ON assessment_versions;
CREATE POLICY "Faculty can manage assessment_versions"
  ON assessment_versions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessments a
      WHERE a.id = assessment_versions.assessment_id
        AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
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
        AND is_enrolled_in_offering(auth.uid(), a.subject_offering_id)
    )
  );

-- ----------------------------------------------------------------------------
-- B8. Questions / choices / answer keys / sources / jobs
--     Students intentionally have NO direct SELECT here: exam content is
--     served through server routes using the service-role client after
--     authorization checks. (answer_keys must NEVER be student-readable.)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can manage questions" ON questions;
CREATE POLICY "Faculty can manage questions"
  ON questions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessment_versions av
      JOIN assessments a ON a.id = av.assessment_id
      WHERE av.id = questions.assessment_version_id
        AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
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
        AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
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
        AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
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
        AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
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
        AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
    )
  );

-- ----------------------------------------------------------------------------
-- B9. Deployments / exceptions
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Faculty can manage assessment_deployments" ON assessment_deployments;
CREATE POLICY "Faculty can manage assessment_deployments"
  ON assessment_deployments FOR ALL TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

DROP POLICY IF EXISTS "Students can read eligible assessment_deployments" ON assessment_deployments;
CREATE POLICY "Students can read eligible assessment_deployments"
  ON assessment_deployments FOR SELECT TO authenticated
  USING (
    status IN ('active', 'scheduled', 'closed')
    AND is_enrolled_in_offering(auth.uid(), subject_offering_id)
  );

DROP POLICY IF EXISTS "Faculty can manage assessment_exceptions" ON assessment_exceptions;
CREATE POLICY "Faculty can manage assessment_exceptions"
  ON assessment_exceptions FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessment_deployments ad
      WHERE ad.id = assessment_exceptions.deployment_id
        AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

DROP POLICY IF EXISTS "Students can read own assessment_exceptions" ON assessment_exceptions;
CREATE POLICY "Students can read own assessment_exceptions"
  ON assessment_exceptions FOR SELECT TO authenticated
  USING (student_id = auth.uid());

-- ----------------------------------------------------------------------------
-- B10. Examination: attempts / manifests / responses / results
--      Hardened: students get INSERT/SELECT/UPDATE(self, in-progress only)
--      but NO DELETE; scoring columns are excluded via column revokes below;
--      manifests/results are server-written only.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Students can manage own exam_attempts" ON exam_attempts;
DROP POLICY IF EXISTS "Students can create own attempts" ON exam_attempts;
DROP POLICY IF EXISTS "Students can update own in-progress attempts" ON exam_attempts;
DROP POLICY IF EXISTS "Students can read own attempts" ON exam_attempts;

CREATE POLICY "Students can create own attempts"
  ON exam_attempts FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Students can read own attempts"
  ON exam_attempts FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Students can update own in-progress attempts"
  ON exam_attempts FOR UPDATE TO authenticated
  USING (student_id = auth.uid() AND status = 'in_progress')
  WITH CHECK (student_id = auth.uid());

DROP POLICY IF EXISTS "Faculty can read exam_attempts for their offerings" ON exam_attempts;
CREATE POLICY "Faculty can read exam_attempts for their offerings"
  ON exam_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessment_deployments ad
      WHERE ad.id = exam_attempts.deployment_id
        AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

DROP POLICY IF EXISTS "Students can read own exam_manifests" ON exam_manifests;
CREATE POLICY "Students can read own exam_manifests"
  ON exam_manifests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      WHERE ea.id = exam_manifests.attempt_id
        AND ea.student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Faculty can read exam_manifests for their offerings" ON exam_manifests;
CREATE POLICY "Faculty can read exam_manifests for their offerings"
  ON exam_manifests FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      WHERE ea.id = exam_manifests.attempt_id
        AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

DROP POLICY IF EXISTS "Students can manage own student_responses" ON student_responses;
DROP POLICY IF EXISTS "Students can insert own responses" ON student_responses;
DROP POLICY IF EXISTS "Students can update own response answers" ON student_responses;
DROP POLICY IF EXISTS "Students can read own responses" ON student_responses;

CREATE POLICY "Students can insert own responses"
  ON student_responses FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      WHERE ea.id = student_responses.attempt_id
        AND ea.student_id = auth.uid()
    )
  );

CREATE POLICY "Students can read own responses"
  ON student_responses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      WHERE ea.id = student_responses.attempt_id
        AND ea.student_id = auth.uid()
    )
  );

CREATE POLICY "Students can update own response answers"
  ON student_responses FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      WHERE ea.id = student_responses.attempt_id
        AND ea.student_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM exam_attempts ea
      WHERE ea.id = student_responses.attempt_id
        AND ea.student_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Faculty can read student_responses for their offerings" ON student_responses;
CREATE POLICY "Faculty can read student_responses for their offerings"
  ON student_responses FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      WHERE ea.id = student_responses.attempt_id
        AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

DROP POLICY IF EXISTS "Students can read own released assessment_results" ON assessment_results;
CREATE POLICY "Students can read own released assessment_results"
  ON assessment_results FOR SELECT TO authenticated
  USING (
    student_id = auth.uid()
    AND status = 'released'
  );

DROP POLICY IF EXISTS "Faculty can read assessment_results for their offerings" ON assessment_results;
CREATE POLICY "Faculty can read assessment_results for their offerings"
  ON assessment_results FOR SELECT TO authenticated
  USING (is_faculty_of_offering(auth.uid(), deployment_id));

DROP POLICY IF EXISTS "Faculty can update assessment_results for their offerings" ON assessment_results;
CREATE POLICY "Faculty can update assessment_results for their offerings"
  ON assessment_results FOR UPDATE TO authenticated
  USING (is_faculty_of_offering(auth.uid(), deployment_id))
  WITH CHECK (is_faculty_of_offering(auth.uid(), deployment_id));

-- ----------------------------------------------------------------------------
-- B11. System tables
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admin can read audit_logs" ON audit_logs;
CREATE POLICY "Admin can read audit_logs"
  ON audit_logs FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "System can insert audit_logs" ON audit_logs;

DROP POLICY IF EXISTS "Admin can read ai_usage_logs" ON ai_usage_logs;
CREATE POLICY "Admin can read ai_usage_logs"
  ON ai_usage_logs FOR SELECT TO authenticated
  USING (is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Users can read own ai_usage_logs" ON ai_usage_logs;
CREATE POLICY "Users can read own ai_usage_logs"
  ON ai_usage_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "System can insert ai_usage_logs" ON ai_usage_logs;

DROP POLICY IF EXISTS "Users can read own notifications" ON notifications;
CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "System can insert notifications" ON notifications;

-- ----------------------------------------------------------------------------
-- B12. Column-level grants: remove student-writable scoring fields and
--      server-only write paths. server_revision stays writable (the save
--      route increments it with the user's session).
-- ----------------------------------------------------------------------------
REVOKE DELETE ON exam_attempts FROM authenticated;
REVOKE DELETE ON student_responses FROM authenticated;
REVOKE UPDATE (earned_points, scoring_status, scored_at, scored_by)
  ON student_responses FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON exam_manifests FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON assessment_results FROM authenticated;
REVOKE INSERT ON notifications FROM authenticated;
REVOKE INSERT ON audit_logs FROM authenticated;
REVOKE INSERT ON ai_usage_logs FROM authenticated;
