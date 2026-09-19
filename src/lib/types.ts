// ============================================================================
// Union Types
// ============================================================================

export type UserRole = 'super_admin' | 'faculty' | 'student';

export type QuestionType = 'multiple_choice' | 'identification';

export type Difficulty = 'easy' | 'moderate' | 'difficult';

export type BloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export type AssessmentStatus = 'draft' | 'approved' | 'published' | 'closed';

export type AttemptStatus =
  | 'created'
  | 'in_progress'
  | 'submitted'
  | 'auto_submitted'
  | 'expired'
  | 'invalidated';

export type ProfileStatus = 'pending' | 'active' | 'suspended' | 'inactive';

export type VerificationStatus =
  | 'pending'
  | 'verified'
  | 'failed'
  | 'expired'
  | 'not_required';

export type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type SourceType = 'file' | 'text' | 'url';

export type ScoringStatus = 'pending' | 'auto_scored' | 'manual_review' | 'scored';

export type ResultStatus = 'pending' | 'final' | 'released';

export type ExceptionType =
  | 'extended_time'
  | 'additional_attempt'
  | 'schedule_override'
  | 'accessibility';

export type QuestionOrderMode = 'fixed' | 'shuffled' | 'pooled';

export type ChoiceOrderMode = 'fixed' | 'shuffled';

export type ScoreReleaseMode =
  | 'immediate'
  | 'after_all_submitted'
  | 'manual_release'
  | 'scheduled';

export type DeploymentStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'closed'
  | 'archived';

export type EnrollmentStatus = 'enrolled' | 'dropped' | 'withdrawn' | 'completed';

export type OfferingStatus = 'active' | 'inactive' | 'archived';

export type NotificationType =
  | 'assessment_published'
  | 'assessment_opened'
  | 'assessment_closed'
  | 'result_released'
  | 'exception_granted'
  | 'submission_confirmed'
  | 'reminder'
  | 'system';

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'publish'
  | 'approve'
  | 'submit'
  | 'score'
  | 'release'
  | 'invalidate'
  | 'login'
  | 'logout';

export type GenerationOperation =
  | 'generate_questions'
  | 'regenerate_questions'
  | 'generate_tos'
  | 'validate_assessment'
  | 'check_duplicates';

export type GenerationJobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ============================================================================
// Database Row Types
// ============================================================================

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  avatar_path: string | null;
  status: ProfileStatus;
  created_at: string;
  updated_at: string;
}

export interface UserRoleRow {
  id: string;
  user_id: string;
  role: UserRole;
  created_at: string;
}

export interface StudentProfile {
  user_id: string;
  student_number: string;
  program_id: string;
  year_level_id: string;
  section_id: string;
  verification_status: VerificationStatus;
  created_at: string;
  updated_at: string;
}

export interface FacultyProfile {
  user_id: string;
  employee_number: string | null;
  created_at: string;
  updated_at: string;
}

export interface AcademicYear {
  id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Semester {
  id: string;
  academic_year_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Program {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface YearLevel {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
}

export interface Section {
  id: string;
  program_id: string;
  year_level_id: string;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Subject {
  id: string;
  code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SubjectOffering {
  id: string;
  subject_id: string;
  semester_id: string;
  program_id: string;
  year_level_id: string;
  section_id: string;
  status: OfferingStatus;
  created_at: string;
  updated_at: string;
}

export interface FacultyAssignment {
  id: string;
  subject_offering_id: string;
  faculty_id: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  id: string;
  subject_offering_id: string;
  student_id: string;
  status: EnrollmentStatus;
  enrolled_at: string;
  created_at: string;
  updated_at: string;
}

export interface SourceMaterial {
  id: string;
  subject_offering_id: string;
  topic_id: string | null;
  title: string;
  source_type: SourceType;
  storage_path: string | null;
  original_filename: string | null;
  mime_type: string | null;
  file_size: number | null;
  raw_text: string | null;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SourceChunk {
  id: string;
  source_material_id: string;
  chunk_index: number;
  content: string;
  token_count: number | null;
  embedding: number[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Assessment {
  id: string;
  subject_id: string;
  created_by: string;
  title: string;
  assessment_type: QuestionType;
  status: AssessmentStatus;
  current_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Question {
  id: string;
  assessment_version_id: string;
  question_type: QuestionType;
  question_text: string;
  difficulty: Difficulty;
  bloom_level: BloomLevel;
  points: number;
  position: number;
  status: string;
  created_by: string;
  is_ai_generated: boolean;
  generation_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionChoice {
  id: string;
  question_id: string;
  choice_key: string;
  choice_text: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface AnswerKey {
  id: string;
  question_id: string;
  correct_choice_id: string | null;
  canonical_answer: string | null;
  accepted_answers: string[] | null;
  scoring_config: Record<string, unknown> | null;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface QuestionSource {
  id: string;
  question_id: string;
  source_chunk_id: string;
  relevance_score: number | null;
  is_primary: boolean;
  created_at: string;
}

export interface AssessmentGenerationJob {
  id: string;
  assessment_id: string;
  requested_by: string;
  operation: GenerationOperation;
  status: GenerationJobStatus;
  input_config: Record<string, unknown>;
  result_metadata: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface AssessmentDeployment {
  id: string;
  assessment_version_id: string;
  subject_offering_id: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempt_limit: number;
  question_order_mode: QuestionOrderMode;
  choice_order_mode: ChoiceOrderMode;
  question_pool_config: Record<string, unknown> | null;
  score_release_mode: ScoreReleaseMode;
  score_release_at: string | null;
  show_raw_score: boolean;
  show_percentage: boolean;
  show_item_correctness: boolean;
  show_correct_answers: boolean;
  show_explanations: boolean;
  requires_identity_verification: boolean;
  status: DeploymentStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface AssessmentException {
  id: string;
  deployment_id: string;
  student_id: string;
  exception_type: ExceptionType;
  override_opens_at: string | null;
  override_closes_at: string | null;
  additional_minutes: number | null;
  additional_attempts: number | null;
  reason: string;
  authorized_by: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExamAttempt {
  id: string;
  deployment_id: string;
  student_id: string;
  assessment_version_id: string;
  attempt_number: number;
  status: AttemptStatus;
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  identity_verified: boolean;
  last_sync_at: string | null;
  session_metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface ExamManifest {
  id: string;
  attempt_id: string;
  question_order: string[];
  choice_order: Record<string, string[]>;
  manifest_hash: string;
  created_at: string;
}

export interface StudentResponse {
  id: string;
  attempt_id: string;
  question_id: string;
  selected_choice_id: string | null;
  text_answer: string | null;
  normalized_answer: string | null;
  earned_points: number | null;
  scoring_status: ScoringStatus;
  scored_at: string | null;
  scored_by: string | null;
  client_revision: number;
  server_revision: number;
  created_at: string;
  updated_at: string;
}

export interface AssessmentResult {
  id: string;
  attempt_id: string;
  student_id: string;
  deployment_id: string;
  raw_score: number;
  possible_score: number;
  percentage: number;
  status: ResultStatus;
  released_at: string | null;
  released_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_user_id: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AiUsageLog {
  id: string;
  user_id: string;
  assessment_id: string | null;
  provider: string;
  model: string;
  operation: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  duration_ms: number | null;
  status: string;
  error_code: string | null;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

// ============================================================================
// Joined / Enriched Types (for UI consumption)
// ============================================================================

export interface ProfileWithRoles extends Profile {
  user_roles: UserRoleRow[];
}

export interface StudentProfileWithDetails extends StudentProfile {
  profile: Profile;
  program: Program;
  year_level: YearLevel;
  section: Section;
}

export interface FacultyProfileWithDetails extends FacultyProfile {
  profile: Profile;
}

export interface SubjectOfferingWithDetails extends SubjectOffering {
  subject: Subject;
  semester: Semester & { academic_year: AcademicYear };
  program: Program;
  year_level: YearLevel;
  section: Section;
  faculty_assignments: (FacultyAssignment & { faculty: Profile })[];
}

export interface AssessmentWithVersion extends Assessment {
  current_version: AssessmentVersion | null;
}

export interface AssessmentVersion {
  id: string;
  assessment_id: string;
  version_number: number;
  status: AssessmentStatus;
  instructions: string | null;
  total_items: number;
  total_points: number;
  tos_snapshot: Record<string, unknown> | null;
  generation_config: Record<string, unknown> | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuestionWithChoices extends Question {
  question_choices: QuestionChoice[];
}

export interface QuestionWithAnswer extends QuestionWithChoices {
  answer_key: AnswerKey | null;
}

/**
 * Authoring-wizard question. While an assessment is being drafted the wizard
 * carries answer information that the persisted `questions` row does not own:
 * correctness lives in `answer_keys` and per-choice flags in `question_choices`.
 */
export interface DraftQuestionChoice extends QuestionChoice {
  is_correct?: boolean;
}

export interface DraftQuestion extends QuestionWithChoices {
  question_choices: DraftQuestionChoice[];
  canonical_answer?: string;
}

export interface DeploymentWithDetails extends AssessmentDeployment {
  assessment_version: AssessmentVersion & { assessment: Assessment };
  subject_offering: SubjectOfferingWithDetails;
}

export interface AttemptWithDetails extends ExamAttempt {
  deployment: AssessmentDeployment;
  assessment_version: AssessmentVersion & { assessment: Assessment };
  exam_manifest: ExamManifest | null;
}

export interface ResultWithDetails extends AssessmentResult {
  attempt: ExamAttempt;
  deployment: AssessmentDeployment;
}

// ============================================================================
// API / Form Types
// ============================================================================

export interface CreateAssessmentInput {
  subject_id: string;
  title: string;
  assessment_type: QuestionType;
}

export interface CreateDeploymentInput {
  assessment_version_id: string;
  subject_offering_id: string;
  opens_at: string;
  closes_at: string;
  duration_minutes: number;
  attempt_limit: number;
  question_order_mode: QuestionOrderMode;
  choice_order_mode: ChoiceOrderMode;
  score_release_mode: ScoreReleaseMode;
  show_raw_score: boolean;
  show_percentage: boolean;
  show_item_correctness: boolean;
  show_correct_answers: boolean;
  show_explanations: boolean;
  requires_identity_verification: boolean;
}

export interface ExamStartResult {
  attempt: ExamAttempt;
  manifest: ExamManifest;
  questions: QuestionWithChoices[];
}

export interface SubmitResponseInput {
  attempt_id: string;
  question_id: string;
  selected_choice_id: string | null;
  text_answer: string | null;
  client_revision: number;
}

export interface ExamSubmissionResult {
  attempt: ExamAttempt;
  result: AssessmentResult | null;
}
