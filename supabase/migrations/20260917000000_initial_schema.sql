-- ============================================================================
-- Quiz-AI Database Migration — Initial Schema (v2)
-- Supabase PostgreSQL
--
-- This is the corrected baseline matching the ACTUAL application code and
-- the schema deployed via the setup wizard: versioned assessments
-- (assessment_versions), questions tied to versions, and the widened status
-- vocabularies the app writes.
--
-- Idempotent: safe to run against databases that already have the tables.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- IDENTITY TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_path TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'pending')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'faculty', 'student')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

CREATE TABLE IF NOT EXISTS student_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  student_number TEXT UNIQUE NOT NULL,
  program_id UUID,
  year_level_id UUID,
  section_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS faculty_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  employee_number TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- ACADEMIC TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (ends_on > starts_on)
);

CREATE TABLE IF NOT EXISTS semesters (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  academic_year_id UUID NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (ends_on > starts_on)
);

CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS year_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  year_level_id UUID NOT NULL REFERENCES year_levels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(program_id, year_level_id, name)
);

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subject_offerings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  semester_id UUID NOT NULL REFERENCES semesters(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  year_level_id UUID NOT NULL REFERENCES year_levels(id) ON DELETE CASCADE,
  section_id UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_id, semester_id, program_id, year_level_id, section_id)
);

CREATE TABLE IF NOT EXISTS faculty_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  faculty_id UUID NOT NULL REFERENCES faculty_profiles(user_id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_offering_id, faculty_id)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  status TEXT DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'completed', 'withdrawn')),
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_offering_id, student_id)
);

-- ============================================================================
-- CONTENT/RAG TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS source_materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  topic_id UUID,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'docx', 'txt', 'manual', 'file')),
  storage_path TEXT,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  raw_text TEXT,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed', 'ready')),
  processing_error TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_chunks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_material_id UUID NOT NULL REFERENCES source_materials(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_count INTEGER,
  embedding VECTOR(1536),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_material_id, chunk_index)
);

-- ============================================================================
-- ASSESSMENT TABLES (versioned)
-- ============================================================================

CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assessment_type TEXT DEFAULT 'custom' CHECK (assessment_type IN ('quiz', 'exam', 'assignment', 'custom', 'multiple_choice', 'identification')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  current_version_id UUID,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  instructions TEXT,
  total_items INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  tos_snapshot JSONB,
  generation_config JSONB,
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(assessment_id, version_number)
);

-- NOTE: assessments.current_version_id FK is added after assessment_versions
-- exists (deferred below) to keep this file order-independent.
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

CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_version_id UUID NOT NULL REFERENCES assessment_versions(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'identification')),
  question_text TEXT NOT NULL,
  difficulty TEXT DEFAULT 'moderate' CHECK (difficulty IN ('easy', 'moderate', 'difficult')),
  bloom_level TEXT DEFAULT 'understand' CHECK (bloom_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')),
  points INTEGER DEFAULT 1 CHECK (points > 0),
  position INTEGER,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived', 'active', 'approved')),
  is_ai_generated BOOLEAN DEFAULT false,
  embedding VECTOR(1536),
  generation_metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_choices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  choice_key TEXT NOT NULL,
  choice_text TEXT NOT NULL,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(question_id, choice_key)
);

CREATE TABLE IF NOT EXISTS answer_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID UNIQUE NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  correct_choice_id UUID REFERENCES question_choices(id) ON DELETE SET NULL,
  canonical_answer TEXT,
  accepted_answers JSONB DEFAULT '[]'::jsonb,
  scoring_config JSONB DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS question_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  source_chunk_id UUID NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
  relevance_score NUMERIC,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(question_id, source_chunk_id)
);

CREATE TABLE IF NOT EXISTS assessment_generation_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'queued', 'in_progress', 'cancelled')),
  input_config JSONB DEFAULT '{}'::jsonb,
  result_metadata JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- DEPLOYMENT TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS assessment_deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  assessment_version_id UUID REFERENCES assessment_versions(id) ON DELETE CASCADE,
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  attempt_limit INTEGER DEFAULT 1 CHECK (attempt_limit >= 1),
  question_order_mode TEXT DEFAULT 'fixed' CHECK (question_order_mode IN ('fixed', 'random', 'shuffled')),
  choice_order_mode TEXT DEFAULT 'fixed' CHECK (choice_order_mode IN ('fixed', 'random', 'shuffled')),
  question_pool_config JSONB DEFAULT '{}'::jsonb,
  score_release_mode TEXT DEFAULT 'after_close' CHECK (score_release_mode IN ('immediate', 'after_close', 'manual', 'after_all_submitted', 'manual_release', 'scheduled')),
  show_raw_score BOOLEAN DEFAULT true,
  show_percentage BOOLEAN DEFAULT true,
  show_item_correctness BOOLEAN DEFAULT false,
  show_correct_answers BOOLEAN DEFAULT false,
  show_explanations BOOLEAN DEFAULT false,
  requires_identity_verification BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'closed', 'archived')),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (closes_at > opens_at)
);

CREATE TABLE IF NOT EXISTS assessment_exceptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id UUID NOT NULL REFERENCES assessment_deployments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  exception_type TEXT NOT NULL,
  override_opens_at TIMESTAMPTZ,
  override_closes_at TIMESTAMPTZ,
  additional_minutes INTEGER CHECK (additional_minutes >= 0),
  additional_attempts INTEGER CHECK (additional_attempts >= 0),
  reason TEXT NOT NULL,
  authorized_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(deployment_id, student_id, exception_type)
);

-- ============================================================================
-- EXAMINATION TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS exam_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id UUID NOT NULL REFERENCES assessment_deployments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  assessment_version_id UUID REFERENCES assessment_versions(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'in_progress', 'submitted', 'timed_out', 'cancelled', 'auto_submitted', 'expired', 'invalidated')),
  started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  identity_verified BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  session_metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(deployment_id, student_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS exam_manifests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID UNIQUE NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  choice_order JSONB NOT NULL DEFAULT '{}'::jsonb,
  manifest_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_choice_id UUID REFERENCES question_choices(id) ON DELETE SET NULL,
  text_answer TEXT,
  normalized_answer TEXT,
  earned_points INTEGER CHECK (earned_points >= 0),
  scoring_status TEXT DEFAULT 'pending' CHECK (scoring_status IN ('pending', 'correct', 'incorrect', 'partial', 'scored')),
  scored_at TIMESTAMPTZ,
  scored_by UUID,
  client_revision BIGINT DEFAULT 1,
  server_revision BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS assessment_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID UNIQUE NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  deployment_id UUID NOT NULL REFERENCES assessment_deployments(id) ON DELETE CASCADE,
  raw_score INTEGER NOT NULL CHECK (raw_score >= 0),
  possible_score INTEGER NOT NULL CHECK (possible_score > 0),
  percentage NUMERIC GENERATED ALWAYS AS (
    CASE WHEN possible_score > 0 THEN (raw_score::numeric / possible_score::numeric) * 100 ELSE 0 END
  ) STORED,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'released', 'finalized')),
  released_at TIMESTAMPTZ,
  released_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- SYSTEM TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assessment_id UUID REFERENCES assessments(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  operation TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost NUMERIC,
  duration_ms INTEGER,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'timeout')),
  error_code TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  data JSONB DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- RLS HELPER FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_role(uid UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
DECLARE
  user_role TEXT;
BEGIN
  SELECT role INTO user_role
  FROM user_roles
  WHERE user_id = uid
  ORDER BY
    CASE role
      WHEN 'super_admin' THEN 1
      WHEN 'faculty' THEN 2
      WHEN 'student' THEN 3
    END
  LIMIT 1;

  RETURN user_role;
END;
$$;

CREATE OR REPLACE FUNCTION is_super_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = uid AND role = 'super_admin'
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_faculty_of_offering(uid UUID, offering_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM faculty_assignments fa
    WHERE fa.faculty_id = uid
    AND fa.subject_offering_id = offering_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_enrolled_in_offering(uid UUID, offering_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM enrollments e
    WHERE e.student_id = uid
    AND e.subject_offering_id = offering_id
    AND e.status = 'enrolled'
  );
END;
$$;

-- ============================================================================
-- TRIGGER FUNCTION + updated_at TRIGGERS
-- (No handle_new_user trigger: the application creates the profile during
-- registration. Add it only when registration moves to a service-role
-- server action.)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'student_profiles', 'faculty_profiles',
    'subject_offerings', 'source_materials',
    'assessments', 'assessment_versions', 'questions',
    'answer_keys', 'assessment_generation_jobs',
    'assessment_deployments', 'assessment_exceptions',
    'exam_attempts', 'student_responses', 'assessment_results'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_%I_updated_at ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER set_%I_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_student_number ON student_profiles(student_number);
CREATE INDEX IF NOT EXISTS idx_student_profiles_program_id ON student_profiles(program_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_year_level_id ON student_profiles(year_level_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_section_id ON student_profiles(section_id);
CREATE INDEX IF NOT EXISTS idx_faculty_profiles_employee_number ON faculty_profiles(employee_number);

CREATE INDEX IF NOT EXISTS idx_semesters_academic_year_id ON semesters(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_sections_program_id ON sections(program_id);
CREATE INDEX IF NOT EXISTS idx_sections_year_level_id ON sections(year_level_id);
CREATE INDEX IF NOT EXISTS idx_subject_offerings_subject_id ON subject_offerings(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_offerings_semester_id ON subject_offerings(semester_id);
CREATE INDEX IF NOT EXISTS idx_subject_offerings_program_id ON subject_offerings(program_id);
CREATE INDEX IF NOT EXISTS idx_subject_offerings_year_level_id ON subject_offerings(year_level_id);
CREATE INDEX IF NOT EXISTS idx_subject_offerings_section_id ON subject_offerings(section_id);
CREATE INDEX IF NOT EXISTS idx_faculty_assignments_subject_offering_id ON faculty_assignments(subject_offering_id);
CREATE INDEX IF NOT EXISTS idx_faculty_assignments_faculty_id ON faculty_assignments(faculty_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_subject_offering_id ON enrollments(subject_offering_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student_id ON enrollments(student_id);

CREATE INDEX IF NOT EXISTS idx_source_materials_subject_offering_id ON source_materials(subject_offering_id);
CREATE INDEX IF NOT EXISTS idx_source_chunks_source_material_id ON source_chunks(source_material_id);

CREATE INDEX IF NOT EXISTS idx_assessments_subject_offering_id ON assessments(subject_offering_id);
CREATE INDEX IF NOT EXISTS idx_assessments_created_by ON assessments(created_by);
CREATE INDEX IF NOT EXISTS idx_assessment_versions_assessment_id ON assessment_versions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_questions_assessment_version_id ON questions(assessment_version_id);
CREATE INDEX IF NOT EXISTS idx_question_choices_question_id ON question_choices(question_id);
CREATE INDEX IF NOT EXISTS idx_answer_keys_question_id ON answer_keys(question_id);
CREATE INDEX IF NOT EXISTS idx_question_sources_question_id ON question_sources(question_id);
CREATE INDEX IF NOT EXISTS idx_question_sources_source_chunk_id ON question_sources(source_chunk_id);
CREATE INDEX IF NOT EXISTS idx_assessment_generation_jobs_assessment_id ON assessment_generation_jobs(assessment_id);

CREATE INDEX IF NOT EXISTS idx_assessment_deployments_assessment_id ON assessment_deployments(assessment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_deployments_subject_offering_id ON assessment_deployments(subject_offering_id);
CREATE INDEX IF NOT EXISTS idx_assessment_exceptions_deployment_id ON assessment_exceptions(deployment_id);
CREATE INDEX IF NOT EXISTS idx_assessment_exceptions_student_id ON assessment_exceptions(student_id);

CREATE INDEX IF NOT EXISTS idx_exam_attempts_deployment_id ON exam_attempts(deployment_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_student_id ON exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_manifests_attempt_id ON exam_manifests(attempt_id);
CREATE INDEX IF NOT EXISTS idx_student_responses_attempt_id ON student_responses(attempt_id);
CREATE INDEX IF NOT EXISTS idx_student_responses_question_id ON student_responses(question_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_attempt_id ON assessment_results(attempt_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_student_id ON assessment_results(student_id);
CREATE INDEX IF NOT EXISTS idx_assessment_results_deployment_id ON assessment_results(deployment_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user_id ON ai_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_assessment_id ON ai_usage_logs(assessment_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_created_at ON ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
