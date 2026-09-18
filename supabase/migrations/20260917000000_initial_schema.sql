-- ============================================================================
-- Quiz-AI Database Migration
-- Initial Schema for Supabase PostgreSQL
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================================
-- IDENTITY TABLES
-- ============================================================================

-- Profiles table (linked to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_path TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- User roles table
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'faculty', 'student')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, role)
);

-- Student profiles table
CREATE TABLE IF NOT EXISTS student_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  student_number TEXT UNIQUE NOT NULL,
  program_id UUID,
  year_level_id UUID,
  section_id UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Faculty profiles table
CREATE TABLE IF NOT EXISTS faculty_profiles (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  employee_number TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- ACADEMIC TABLES
-- ============================================================================

-- Academic years table
CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (ends_on > starts_on)
);

-- Semesters table
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

-- Programs table
CREATE TABLE IF NOT EXISTS programs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Year levels table
CREATE TABLE IF NOT EXISTS year_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Sections table
CREATE TABLE IF NOT EXISTS sections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  year_level_id UUID NOT NULL REFERENCES year_levels(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(program_id, year_level_id, name)
);

-- Subjects table
CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Subject offerings table
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

-- Faculty assignments table
CREATE TABLE IF NOT EXISTS faculty_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  faculty_id UUID NOT NULL REFERENCES faculty_profiles(user_id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_offering_id, faculty_id)
);

-- Enrollments table
CREATE TABLE IF NOT EXISTS enrollments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  status TEXT DEFAULT 'enrolled' CHECK (status IN ('enrolled', 'dropped', 'completed')),
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(subject_offering_id, student_id)
);

-- ============================================================================
-- CONTENT/RAG TABLES
-- ============================================================================

-- Source materials table
CREATE TABLE IF NOT EXISTS source_materials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('pdf', 'docx', 'txt', 'manual')),
  storage_path TEXT,
  original_filename TEXT,
  mime_type TEXT,
  file_size INTEGER,
  raw_text TEXT,
  processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
  processing_error TEXT,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Source chunks table
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
-- ASSESSMENT TABLES
-- ============================================================================

-- Assessments table
CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  assessment_type TEXT DEFAULT 'custom' CHECK (assessment_type IN ('quiz', 'exam', 'assignment', 'custom')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple_choice', 'identification')),
  question_text TEXT NOT NULL,
  difficulty TEXT DEFAULT 'moderate' CHECK (difficulty IN ('easy', 'moderate', 'difficult')),
  bloom_level TEXT DEFAULT 'understand' CHECK (bloom_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')),
  points INTEGER DEFAULT 1 CHECK (points > 0),
  position INTEGER,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  is_ai_generated BOOLEAN DEFAULT false,
  embedding VECTOR(1536),
  generation_metadata JSONB DEFAULT '{}'::jsonb,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Question choices table
CREATE TABLE IF NOT EXISTS question_choices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  choice_key TEXT NOT NULL,
  choice_text TEXT NOT NULL,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(question_id, choice_key)
);

-- Answer keys table
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

-- Question sources table
CREATE TABLE IF NOT EXISTS question_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  source_chunk_id UUID NOT NULL REFERENCES source_chunks(id) ON DELETE CASCADE,
  relevance_score NUMERIC,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(question_id, source_chunk_id)
);

-- Assessment generation jobs table
CREATE TABLE IF NOT EXISTS assessment_generation_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  input_config JSONB DEFAULT '{}'::jsonb,
  result_metadata JSONB DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================================
-- DEPLOYMENT TABLES
-- ============================================================================

-- Assessment deployments table
CREATE TABLE IF NOT EXISTS assessment_deployments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  subject_offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  attempt_limit INTEGER DEFAULT 1 CHECK (attempt_limit >= 1),
  question_order_mode TEXT DEFAULT 'fixed' CHECK (question_order_mode IN ('fixed', 'random')),
  choice_order_mode TEXT DEFAULT 'fixed' CHECK (choice_order_mode IN ('fixed', 'random')),
  question_pool_config JSONB DEFAULT '{}'::jsonb,
  score_release_mode TEXT DEFAULT 'after_close' CHECK (score_release_mode IN ('immediate', 'after_close', 'manual')),
  show_raw_score BOOLEAN DEFAULT true,
  show_percentage BOOLEAN DEFAULT true,
  show_item_correctness BOOLEAN DEFAULT false,
  show_correct_answers BOOLEAN DEFAULT false,
  requires_identity_verification BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed', 'archived')),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (closes_at > opens_at)
);

-- Assessment exceptions table
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

-- Exam attempts table
CREATE TABLE IF NOT EXISTS exam_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id UUID NOT NULL REFERENCES assessment_deployments(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES student_profiles(user_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT DEFAULT 'created' CHECK (status IN ('created', 'in_progress', 'submitted', 'timed_out', 'cancelled')),
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

-- Exam manifests table
CREATE TABLE IF NOT EXISTS exam_manifests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID UNIQUE NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_order JSONB NOT NULL DEFAULT '[]'::jsonb,
  choice_order JSONB NOT NULL DEFAULT '{}'::jsonb,
  manifest_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Student responses table
CREATE TABLE IF NOT EXISTS student_responses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id UUID NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  selected_choice_id UUID REFERENCES question_choices(id) ON DELETE SET NULL,
  text_answer TEXT,
  normalized_answer TEXT,
  earned_points INTEGER CHECK (earned_points >= 0),
  scoring_status TEXT DEFAULT 'pending' CHECK (scoring_status IN ('pending', 'correct', 'incorrect', 'partial')),
  scored_at TIMESTAMPTZ,
  scored_by UUID,
  client_revision BIGINT DEFAULT 1,
  server_revision BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(attempt_id, question_id)
);

-- Assessment results table
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

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- AI usage logs table
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

-- Notifications table
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

-- Function to get user role
CREATE OR REPLACE FUNCTION get_user_role(uid UUID)
RETURNS TEXT AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function to check if user is super admin
CREATE OR REPLACE FUNCTION is_super_admin(uid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM user_roles
    WHERE user_id = uid AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function to check if user is faculty of a subject offering
CREATE OR REPLACE FUNCTION is_faculty_of_offering(uid UUID, offering_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM faculty_assignments fa
    WHERE fa.faculty_id = uid
    AND fa.subject_offering_id = offering_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Function to check if student is enrolled in a subject offering
CREATE OR REPLACE FUNCTION is_enrolled_in_offering(uid UUID, offering_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM enrollments e
    WHERE e.student_id = uid
    AND e.subject_offering_id = offering_id
    AND e.status = 'enrolled'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- TRIGGER FUNCTIONS
-- ============================================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at on profiles
CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on student_profiles
CREATE TRIGGER set_student_profiles_updated_at
  BEFORE UPDATE ON student_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on faculty_profiles
CREATE TRIGGER set_faculty_profiles_updated_at
  BEFORE UPDATE ON faculty_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on subject_offerings
CREATE TRIGGER set_subject_offerings_updated_at
  BEFORE UPDATE ON subject_offerings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on source_materials
CREATE TRIGGER set_source_materials_updated_at
  BEFORE UPDATE ON source_materials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on assessments
CREATE TRIGGER set_assessments_updated_at
  BEFORE UPDATE ON assessments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on questions
CREATE TRIGGER set_questions_updated_at
  BEFORE UPDATE ON questions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on answer_keys
CREATE TRIGGER set_answer_keys_updated_at
  BEFORE UPDATE ON answer_keys
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on assessment_generation_jobs
CREATE TRIGGER set_assessment_generation_jobs_updated_at
  BEFORE UPDATE ON assessment_generation_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on assessment_deployments
CREATE TRIGGER set_assessment_deployments_updated_at
  BEFORE UPDATE ON assessment_deployments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on assessment_exceptions
CREATE TRIGGER set_assessment_exceptions_updated_at
  BEFORE UPDATE ON assessment_exceptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on exam_attempts
CREATE TRIGGER set_exam_attempts_updated_at
  BEFORE UPDATE ON exam_attempts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on student_responses
CREATE TRIGGER set_student_responses_updated_at
  BEFORE UPDATE ON student_responses
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-update updated_at on assessment_results
CREATE TRIGGER set_assessment_results_updated_at
  BEFORE UPDATE ON assessment_results
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Auto-create profile on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Enable RLS on all tables
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

-- ============================================================================
-- PROFILES POLICIES
-- ============================================================================

-- Users can read own profile
CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Users can update own profile
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Admin can manage all profiles
CREATE POLICY "Admin can manage all profiles"
  ON profiles FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- ============================================================================
-- USER_ROLES POLICIES
-- ============================================================================

-- Users can read own roles
CREATE POLICY "Users can read own roles"
  ON user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Admin can manage all user roles
CREATE POLICY "Admin can manage all user roles"
  ON user_roles FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- ============================================================================
-- STUDENT_PROFILES POLICIES
-- ============================================================================

-- Students can read own profile
CREATE POLICY "Students can read own profile"
  ON student_profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Students can update own profile
CREATE POLICY "Students can update own profile"
  ON student_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Faculty can read enrolled students
CREATE POLICY "Faculty can read enrolled students"
  ON student_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM enrollments e
      JOIN faculty_assignments fa ON fa.subject_offering_id = e.subject_offering_id
      WHERE e.student_id = student_profiles.user_id
      AND fa.faculty_id = auth.uid()
    )
  );

-- Admin can manage all student profiles
CREATE POLICY "Admin can manage all student profiles"
  ON student_profiles FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- ============================================================================
-- FACULTY_PROFILES POLICIES
-- ============================================================================

-- Faculty can read own profile
CREATE POLICY "Faculty can read own profile"
  ON faculty_profiles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Faculty can update own profile
CREATE POLICY "Faculty can update own profile"
  ON faculty_profiles FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Admin can manage all faculty profiles
CREATE POLICY "Admin can manage all faculty profiles"
  ON faculty_profiles FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- ============================================================================
-- ACADEMIC TABLES POLICIES
-- ============================================================================

-- Academic years: admin manage, authenticated read
CREATE POLICY "Admin can manage academic years"
  ON academic_years FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Authenticated users can read academic years"
  ON academic_years FOR SELECT
  TO authenticated
  USING (true);

-- Semesters: admin manage, authenticated read
CREATE POLICY "Admin can manage semesters"
  ON semesters FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Authenticated users can read semesters"
  ON semesters FOR SELECT
  TO authenticated
  USING (true);

-- Programs: admin manage, authenticated read
CREATE POLICY "Admin can manage programs"
  ON programs FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Authenticated users can read programs"
  ON programs FOR SELECT
  TO authenticated
  USING (true);

-- Year levels: admin manage, authenticated read
CREATE POLICY "Admin can manage year_levels"
  ON year_levels FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Authenticated users can read year_levels"
  ON year_levels FOR SELECT
  TO authenticated
  USING (true);

-- Sections: admin manage, authenticated read
CREATE POLICY "Admin can manage sections"
  ON sections FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Authenticated users can read sections"
  ON sections FOR SELECT
  TO authenticated
  USING (true);

-- Subjects: admin manage, authenticated read
CREATE POLICY "Admin can manage subjects"
  ON subjects FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

CREATE POLICY "Authenticated users can read subjects"
  ON subjects FOR SELECT
  TO authenticated
  USING (true);

-- ============================================================================
-- SUBJECT_OFFERINGS POLICIES
-- ============================================================================

-- Admin can manage all subject offerings
CREATE POLICY "Admin can manage subject_offerings"
  ON subject_offerings FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- Faculty assigned to offering can read it
CREATE POLICY "Faculty can read assigned subject_offerings"
  ON subject_offerings FOR SELECT
  TO authenticated
  USING (is_faculty_of_offering(auth.uid(), id));

-- Enrolled students can read subject offerings
CREATE POLICY "Enrolled students can read subject_offerings"
  ON subject_offerings FOR SELECT
  TO authenticated
  USING (is_enrolled_in_offering(auth.uid(), id));

-- ============================================================================
-- FACULTY_ASSIGNMENTS POLICIES
-- ============================================================================

-- Admin can manage all faculty assignments
CREATE POLICY "Admin can manage faculty_assignments"
  ON faculty_assignments FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- Faculty can read own assignments
CREATE POLICY "Faculty can read own assignments"
  ON faculty_assignments FOR SELECT
  TO authenticated
  USING (faculty_id = auth.uid());

-- ============================================================================
-- ENROLLMENTS POLICIES
-- ============================================================================

-- Admin can manage all enrollments
CREATE POLICY "Admin can manage enrollments"
  ON enrollments FOR ALL
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- Students can read own enrollments
CREATE POLICY "Students can read own enrollments"
  ON enrollments FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

-- Faculty can read enrollments for their offerings
CREATE POLICY "Faculty can read enrollments for their offerings"
  ON enrollments FOR SELECT
  TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

-- ============================================================================
-- SOURCE_MATERIALS POLICIES
-- ============================================================================

-- Faculty assigned can manage source materials
CREATE POLICY "Faculty can manage source_materials"
  ON source_materials FOR ALL
  TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

-- No direct access for students/anonymous
-- (Default deny - no SELECT policy for non-faculty)

-- ============================================================================
-- SOURCE_CHUNKS POLICIES
-- ============================================================================

-- Faculty can read chunks for materials in their offerings
CREATE POLICY "Faculty can read source_chunks"
  ON source_chunks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM source_materials sm
      WHERE sm.id = source_chunks.source_material_id
      AND is_faculty_of_offering(auth.uid(), sm.subject_offering_id)
    )
  );

-- No direct access for students/anonymous

-- ============================================================================
-- ASSESSMENTS POLICIES
-- ============================================================================

-- Faculty can manage assessments for their offerings
CREATE POLICY "Faculty can manage assessments"
  ON assessments FOR ALL
  TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

-- Students can read published assessments for enrolled offerings
CREATE POLICY "Students can read published assessments"
  ON assessments FOR SELECT
  TO authenticated
  USING (
    status = 'published'
    AND is_enrolled_in_offering(auth.uid(), subject_offering_id)
  );

-- ============================================================================
-- QUESTIONS POLICIES
-- ============================================================================

-- Faculty can manage questions for their assessments
CREATE POLICY "Faculty can manage questions"
  ON questions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessments a
      WHERE a.id = questions.assessment_id
      AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
    )
  );

-- Students have no direct access to questions table
-- (Questions are served through exam manifests)

-- ============================================================================
-- QUESTION_CHOICES POLICIES
-- ============================================================================

-- Faculty can manage choices for their questions
CREATE POLICY "Faculty can manage question_choices"
  ON question_choices FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM questions q
      JOIN assessments a ON a.id = q.assessment_id
      WHERE q.id = question_choices.question_id
      AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
    )
  );

-- Students have no direct access to question_choices table

-- ============================================================================
-- ANSWER_KEYS POLICIES
-- ============================================================================

-- Faculty can manage answer keys for their questions
CREATE POLICY "Faculty can manage answer_keys"
  ON answer_keys FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM questions q
      JOIN assessments a ON a.id = q.assessment_id
      WHERE q.id = answer_keys.question_id
      AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
    )
  );

-- Students cannot read answer keys (server-side only)

-- ============================================================================
-- QUESTION_SOURCES POLICIES
-- ============================================================================

-- Faculty can manage question sources for their questions
CREATE POLICY "Faculty can manage question_sources"
  ON question_sources FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM questions q
      JOIN assessments a ON a.id = q.assessment_id
      WHERE q.id = question_sources.question_id
      AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
    )
  );

-- ============================================================================
-- ASSESSMENT_GENERATION_JOBS POLICIES
-- ============================================================================

-- Faculty can manage generation jobs for their assessments
CREATE POLICY "Faculty can manage assessment_generation_jobs"
  ON assessment_generation_jobs FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessments a
      WHERE a.id = assessment_generation_jobs.assessment_id
      AND is_faculty_of_offering(auth.uid(), a.subject_offering_id)
    )
  );

-- ============================================================================
-- ASSESSMENT_DEPLOYMENTS POLICIES
-- ============================================================================

-- Faculty can manage deployments for their offerings
CREATE POLICY "Faculty can manage assessment_deployments"
  ON assessment_deployments FOR ALL
  TO authenticated
  USING (is_faculty_of_offering(auth.uid(), subject_offering_id));

-- Students can read active deployments for enrolled offerings
CREATE POLICY "Students can read eligible assessment_deployments"
  ON assessment_deployments FOR SELECT
  TO authenticated
  USING (
    status = 'active'
    AND is_enrolled_in_offering(auth.uid(), subject_offering_id)
  );

-- ============================================================================
-- ASSESSMENT_EXCEPTIONS POLICIES
-- ============================================================================

-- Faculty can manage exceptions for their offerings
CREATE POLICY "Faculty can manage assessment_exceptions"
  ON assessment_exceptions FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessment_deployments ad
      WHERE ad.id = assessment_exceptions.deployment_id
      AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

-- Students can read own exceptions
CREATE POLICY "Students can read own assessment_exceptions"
  ON assessment_exceptions FOR SELECT
  TO authenticated
  USING (student_id = auth.uid());

-- ============================================================================
-- EXAM_ATTEMPTS POLICIES
-- ============================================================================

-- Students can manage own attempts
CREATE POLICY "Students can manage own exam_attempts"
  ON exam_attempts FOR ALL
  TO authenticated
  USING (student_id = auth.uid());

-- Faculty can read attempts for their offerings
CREATE POLICY "Faculty can read exam_attempts for their offerings"
  ON exam_attempts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM assessment_deployments ad
      WHERE ad.id = exam_attempts.deployment_id
      AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

-- ============================================================================
-- EXAM_MANIFESTS POLICIES
-- ============================================================================

-- Students can read own manifests
CREATE POLICY "Students can read own exam_manifests"
  ON exam_manifests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      WHERE ea.id = exam_manifests.attempt_id
      AND ea.student_id = auth.uid()
    )
  );

-- Faculty can read manifests for their offerings
CREATE POLICY "Faculty can read exam_manifests for their offerings"
  ON exam_manifests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      WHERE ea.id = exam_manifests.attempt_id
      AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

-- ============================================================================
-- STUDENT_RESPONSES POLICIES
-- ============================================================================

-- Students can manage own responses
CREATE POLICY "Students can manage own student_responses"
  ON student_responses FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      WHERE ea.id = student_responses.attempt_id
      AND ea.student_id = auth.uid()
    )
  );

-- Faculty can read responses for their offerings
CREATE POLICY "Faculty can read student_responses for their offerings"
  ON student_responses FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM exam_attempts ea
      JOIN assessment_deployments ad ON ad.id = ea.deployment_id
      WHERE ea.id = student_responses.attempt_id
      AND is_faculty_of_offering(auth.uid(), ad.subject_offering_id)
    )
  );

-- ============================================================================
-- ASSESSMENT_RESULTS POLICIES
-- ============================================================================

-- Students can read own released results
CREATE POLICY "Students can read own released assessment_results"
  ON assessment_results FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid()
    AND status = 'released'
  );

-- Faculty can read results for their offerings
CREATE POLICY "Faculty can read assessment_results for their offerings"
  ON assessment_results FOR SELECT
  TO authenticated
  USING (is_faculty_of_offering(auth.uid(), deployment_id));

-- Faculty can update results for their offerings (to release scores)
CREATE POLICY "Faculty can update assessment_results for their offerings"
  ON assessment_results FOR UPDATE
  TO authenticated
  USING (is_faculty_of_offering(auth.uid(), deployment_id))
  WITH CHECK (is_faculty_of_offering(auth.uid(), deployment_id));

-- ============================================================================
-- AUDIT_LOGS POLICIES
-- ============================================================================

-- Admin can read all audit logs
CREATE POLICY "Admin can read audit_logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- System can insert audit logs (via service role)
CREATE POLICY "System can insert audit_logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- AI_USAGE_LOGS POLICIES
-- ============================================================================

-- Admin can read all AI usage logs
CREATE POLICY "Admin can read ai_usage_logs"
  ON ai_usage_logs FOR SELECT
  TO authenticated
  USING (is_super_admin(auth.uid()));

-- Users can read own AI usage logs
CREATE POLICY "Users can read own ai_usage_logs"
  ON ai_usage_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- System can insert AI usage logs
CREATE POLICY "System can insert ai_usage_logs"
  ON ai_usage_logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- NOTIFICATIONS POLICIES
-- ============================================================================

-- Users can read own notifications
CREATE POLICY "Users can read own notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Users can update own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
  ON notifications FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- System can insert notifications
CREATE POLICY "System can insert notifications"
  ON notifications FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- INDEXES FOR PERFORMANCE
-- ============================================================================

-- Identity indexes
CREATE INDEX idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX idx_student_profiles_student_number ON student_profiles(student_number);
CREATE INDEX idx_student_profiles_program_id ON student_profiles(program_id);
CREATE INDEX idx_student_profiles_year_level_id ON student_profiles(year_level_id);
CREATE INDEX idx_student_profiles_section_id ON student_profiles(section_id);
CREATE INDEX idx_faculty_profiles_employee_number ON faculty_profiles(employee_number);

-- Academic indexes
CREATE INDEX idx_semesters_academic_year_id ON semesters(academic_year_id);
CREATE INDEX idx_sections_program_id ON sections(program_id);
CREATE INDEX idx_sections_year_level_id ON sections(year_level_id);
CREATE INDEX idx_subject_offerings_subject_id ON subject_offerings(subject_id);
CREATE INDEX idx_subject_offerings_semester_id ON subject_offerings(semester_id);
CREATE INDEX idx_subject_offerings_program_id ON subject_offerings(program_id);
CREATE INDEX idx_subject_offerings_year_level_id ON subject_offerings(year_level_id);
CREATE INDEX idx_subject_offerings_section_id ON subject_offerings(section_id);
CREATE INDEX idx_faculty_assignments_subject_offering_id ON faculty_assignments(subject_offering_id);
CREATE INDEX idx_faculty_assignments_faculty_id ON faculty_assignments(faculty_id);
CREATE INDEX idx_enrollments_subject_offering_id ON enrollments(subject_offering_id);
CREATE INDEX idx_enrollments_student_id ON enrollments(student_id);

-- Content indexes
CREATE INDEX idx_source_materials_subject_offering_id ON source_materials(subject_offering_id);
CREATE INDEX idx_source_chunks_source_material_id ON source_chunks(source_material_id);
CREATE INDEX idx_source_chunks_embedding ON source_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Assessment indexes
CREATE INDEX idx_assessments_subject_offering_id ON assessments(subject_offering_id);
CREATE INDEX idx_assessments_created_by ON assessments(created_by);
CREATE INDEX idx_questions_assessment_id ON questions(assessment_id);
CREATE INDEX idx_questions_embedding ON questions USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX idx_question_choices_question_id ON question_choices(question_id);
CREATE INDEX idx_answer_keys_question_id ON answer_keys(question_id);
CREATE INDEX idx_question_sources_question_id ON question_sources(question_id);
CREATE INDEX idx_question_sources_source_chunk_id ON question_sources(source_chunk_id);
CREATE INDEX idx_assessment_generation_jobs_assessment_id ON assessment_generation_jobs(assessment_id);

-- Deployment indexes
CREATE INDEX idx_assessment_deployments_assessment_id ON assessment_deployments(assessment_id);
CREATE INDEX idx_assessment_deployments_subject_offering_id ON assessment_deployments(subject_offering_id);
CREATE INDEX idx_assessment_exceptions_deployment_id ON assessment_exceptions(deployment_id);
CREATE INDEX idx_assessment_exceptions_student_id ON assessment_exceptions(student_id);

-- Examination indexes
CREATE INDEX idx_exam_attempts_deployment_id ON exam_attempts(deployment_id);
CREATE INDEX idx_exam_attempts_student_id ON exam_attempts(student_id);
CREATE INDEX idx_exam_manifests_attempt_id ON exam_manifests(attempt_id);
CREATE INDEX idx_student_responses_attempt_id ON student_responses(attempt_id);
CREATE INDEX idx_student_responses_question_id ON student_responses(question_id);
CREATE INDEX idx_assessment_results_attempt_id ON assessment_results(attempt_id);
CREATE INDEX idx_assessment_results_student_id ON assessment_results(student_id);
CREATE INDEX idx_assessment_results_deployment_id ON assessment_results(deployment_id);

-- System indexes
CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs(actor_user_id);
CREATE INDEX idx_audit_logs_entity_type ON audit_logs(entity_type);
CREATE INDEX idx_audit_logs_entity_id ON audit_logs(entity_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_ai_usage_logs_user_id ON ai_usage_logs(user_id);
CREATE INDEX idx_ai_usage_logs_assessment_id ON ai_usage_logs(assessment_id);
CREATE INDEX idx_ai_usage_logs_created_at ON ai_usage_logs(created_at);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_read_at ON notifications(read_at);

-- ============================================================================
-- END OF MIGRATION
-- ============================================================================
