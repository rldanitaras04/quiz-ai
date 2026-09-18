# AI-Assisted Secure Assessment System

## Database Architecture and Supabase Security Specification

**Purpose:** Authoritative database blueprint for MiMo.\
**Database:** Supabase PostgreSQL\
**Security:** Supabase Auth + PostgreSQL Row Level Security (RLS) +
least privilege

------------------------------------------------------------------------

## 1. Database Design Principles

1.  PostgreSQL is the source of truth.
2.  Use normalized relational tables for transactional and academic
    data.
3.  Use UUID primary keys unless a strong reason exists otherwise.
4.  Use `auth.users.id` as the identity anchor; do not duplicate
    passwords.
5.  Use foreign keys, unique constraints, check constraints, and
    indexes.
6.  Use `timestamptz` for persisted timestamps.
7.  Server time is authoritative for exam eligibility.
8.  Do not store answer keys in client-readable tables/views.
9.  Enable RLS on all exposed application tables.
10. Service-role access is server-only.
11. Preserve historical assessment versions and attempt manifests.
12. Prefer immutable history for submitted attempts and published
    assessment versions.
13. Use JSONB only for metadata/configuration that does not merit a
    relational entity.
14. Never store raw secrets/API keys in ordinary application tables.
15. Minimize biometric data; prefer provider references/results over raw
    biometric artifacts.

------------------------------------------------------------------------

## 2. Domain Model

``` text
IDENTITY
profiles
user_roles
student_profiles
faculty_profiles
identity_verifications

ACADEMIC
academic_years
semesters
programs
year_levels
sections
subjects
subject_offerings
faculty_assignments
enrollments

CONTENT
topics
source_materials
source_chunks

ASSESSMENT
assessments
assessment_versions
assessment_topics
questions
question_choices
answer_keys
question_sources
assessment_generation_jobs
question_bank

DEPLOYMENT
assessment_deployments
assessment_exceptions

EXAMINATION
exam_attempts
exam_manifests
student_responses
response_history
exam_events
identity_checks

RESULTS
assessment_results
item_statistics
assessment_statistics

SYSTEM
notifications
audit_logs
ai_usage_logs
system_settings
```

------------------------------------------------------------------------

## 3. Identity Tables

### `profiles`

-   `id uuid PK` -\> `auth.users.id`
-   `email text`
-   `full_name text`
-   `avatar_path text null`
-   `status text` (`pending`, `active`, `suspended`, `inactive`)
-   `created_at timestamptz`
-   `updated_at timestamptz`

### `user_roles`

-   `id uuid PK`
-   `user_id uuid FK profiles.id`
-   `role text CHECK IN ('super_admin','faculty','student')`
-   `created_at timestamptz`
-   UNIQUE (`user_id`, `role`)

Do not trust a client-editable profile field as authorization truth.

### `student_profiles`

-   `user_id uuid PK/FK profiles.id`
-   `student_number text UNIQUE NOT NULL`
-   `program_id uuid FK`
-   `year_level_id uuid FK`
-   `section_id uuid FK`
-   `verification_status text`
-   timestamps

### `faculty_profiles`

-   `user_id uuid PK/FK profiles.id`
-   `employee_number text UNIQUE null`
-   timestamps

### `identity_verifications`

Store minimum necessary verification metadata: - `id uuid PK` -
`student_id uuid FK` - `provider text` -
`provider_reference text null` - `verification_type text` -
`status text` - `confidence numeric null` -
`verified_at timestamptz null` - `expires_at timestamptz null` -
`metadata jsonb` (sanitized/minimized) - timestamps

Do not store raw face images/templates here unless institutional policy
and the chosen provider explicitly require it.

------------------------------------------------------------------------

## 4. Academic Tables

### `academic_years`

-   `id`
-   `name`
-   `starts_on`
-   `ends_on`
-   `is_active`

### `semesters`

-   `id`
-   `academic_year_id`
-   `name`
-   `starts_on`
-   `ends_on`
-   `is_active`

### `programs`

-   `id`
-   `code`
-   `name`
-   `is_active`

### `year_levels`

-   `id`
-   `name`
-   `sort_order`

### `sections`

-   `id`
-   `program_id`
-   `year_level_id`
-   `name`
-   `is_active`

### `subjects`

-   `id`
-   `code`
-   `title`
-   `description`
-   `is_active`

### `subject_offerings`

Operational class instance: - `id` - `subject_id` - `semester_id` -
`program_id` - `year_level_id` - `section_id` - `status` - timestamps

Recommended UNIQUE constraint on the combination that prevents duplicate
offerings for the same academic context.

### `faculty_assignments`

-   `id`
-   `subject_offering_id`
-   `faculty_id`
-   `is_primary`
-   timestamps
-   UNIQUE as appropriate

### `enrollments`

-   `id`
-   `subject_offering_id`
-   `student_id`
-   `status`
-   `enrolled_at`
-   timestamps
-   UNIQUE (`subject_offering_id`, `student_id`)

------------------------------------------------------------------------

## 5. Content and RAG Tables

### `topics`

-   `id`
-   `subject_id`
-   `title`
-   `description`
-   `created_by`
-   timestamps

### `source_materials`

-   `id`
-   `subject_offering_id`
-   `topic_id null`
-   `title`
-   `source_type`
-   `storage_path null`
-   `original_filename null`
-   `mime_type null`
-   `file_size null`
-   `raw_text null` only when appropriate
-   `processing_status`
-   `processing_error null`
-   `created_by`
-   timestamps

### `source_chunks`

-   `id`
-   `source_material_id`
-   `chunk_index`
-   `content`
-   `token_count null`
-   `embedding vector(...)`
-   `metadata jsonb`
-   timestamps
-   UNIQUE (`source_material_id`, `chunk_index`)

Create an appropriate pgvector index after evaluating dataset size and
selected embedding dimension/model.

------------------------------------------------------------------------

## 6. Assessment Tables

### `assessments`

Logical assessment identity: - `id` - `subject_id` - `created_by` -
`title` - `assessment_type` - `status` - `current_version_id null` -
timestamps

### `assessment_versions`

Immutable/versioned assessment snapshot: - `id` - `assessment_id` -
`version_number integer` - `status` - `instructions` - `total_items` -
`total_points` - `tos_snapshot jsonb` - `generation_config jsonb` -
`approved_by null` - `approved_at null` - `published_at null` -
timestamps - UNIQUE (`assessment_id`, `version_number`)

### `assessment_topics`

-   `id`
-   `assessment_version_id`
-   `topic_id`
-   `weight`
-   `item_count`
-   optional cognitive distribution fields/JSONB
-   UNIQUE (`assessment_version_id`, `topic_id`)

### `questions`

-   `id`
-   `assessment_version_id`
-   `question_type` (`multiple_choice`, `identification`)
-   `question_text`
-   `difficulty`
-   `bloom_level`
-   `points`
-   `position`
-   `status`
-   `created_by`
-   `is_ai_generated`
-   `generation_metadata jsonb`
-   timestamps

### `question_choices`

-   `id`
-   `question_id`
-   `choice_key`
-   `choice_text`
-   `position`
-   timestamps

Do not put `is_correct` in a table that students can read.

### `answer_keys`

Strictly protected: - `id` - `question_id UNIQUE` -
`correct_choice_id null` - `canonical_answer text null` -
`accepted_answers jsonb null` - `scoring_config jsonb null` -
`updated_by` - timestamps

### `question_sources`

-   `id`
-   `question_id`
-   `source_chunk_id`
-   `relevance_score null`
-   `is_primary`
-   UNIQUE (`question_id`, `source_chunk_id`)

### `assessment_generation_jobs`

-   `id`
-   `assessment_id`
-   `requested_by`
-   `operation`
-   `status`
-   `input_config jsonb`
-   `result_metadata jsonb`
-   `error_message null`
-   timestamps

### `question_bank`

Prefer a reusable canonical bank entity rather than copying mutable
question rows blindly: - `id` - `subject_id` - `topic_id null` -
`question_type` - `question_text` - `difficulty` - `bloom_level` -
`points` - `source_question_id null` - `source_metadata jsonb` -
`created_by` - `status` - `usage_count` - `last_used_at` - timestamps

Use associated child tables if banked MCQ choices/answer keys require
independent versioning.

------------------------------------------------------------------------

## 7. Deployment Tables

### `assessment_deployments`

-   `id`
-   `assessment_version_id`
-   `subject_offering_id`
-   `opens_at timestamptz`
-   `closes_at timestamptz`
-   `duration_minutes`
-   `attempt_limit`
-   `question_order_mode`
-   `choice_order_mode`
-   `question_pool_config jsonb`
-   `score_release_mode`
-   `score_release_at null`
-   `show_raw_score`
-   `show_percentage`
-   `show_item_correctness`
-   `show_correct_answers`
-   `show_explanations`
-   `requires_identity_verification`
-   `status`
-   `created_by`
-   timestamps

Constraints: - `closes_at > opens_at` - `duration_minutes > 0` -
`attempt_limit >= 1`

### `assessment_exceptions`

-   `id`
-   `deployment_id`
-   `student_id`
-   `exception_type`
-   `override_opens_at null`
-   `override_closes_at null`
-   `additional_minutes null`
-   `additional_attempts null`
-   `reason`
-   `authorized_by`
-   `expires_at null`
-   timestamps

Index (`deployment_id`, `student_id`).

------------------------------------------------------------------------

## 8. Examination Tables

### `exam_attempts`

-   `id`
-   `deployment_id`
-   `student_id`
-   `assessment_version_id`
-   `attempt_number`
-   `status` (`created`, `in_progress`, `submitted`, `auto_submitted`,
    `expired`, `invalidated`)
-   `started_at`
-   `expires_at`
-   `submitted_at null`
-   `identity_verified boolean`
-   `last_sync_at null`
-   `session_metadata jsonb`
-   timestamps
-   UNIQUE (`deployment_id`, `student_id`, `attempt_number`)

### `exam_manifests`

Immutable exact exam delivered to a student: - `id` -
`attempt_id UNIQUE` - `question_order jsonb` - `choice_order jsonb` -
`manifest_hash text` - `created_at`

A normalized child manifest table may be used instead of JSONB if
query/reporting requirements justify it.

### `student_responses`

-   `id`
-   `attempt_id`
-   `question_id`
-   `selected_choice_id null`
-   `text_answer null`
-   `normalized_answer null`
-   `earned_points null`
-   `scoring_status`
-   `scored_at null`
-   `scored_by null`
-   `client_revision bigint`
-   `server_revision bigint`
-   timestamps
-   UNIQUE (`attempt_id`, `question_id`)

### `response_history`

Append-only history for critical synchronization/scoring traceability: -
`id` - `response_id` - `attempt_id` - `question_id` - `event_type` -
`response_snapshot jsonb` - `created_at`

### `exam_events`

-   `id`
-   `attempt_id`
-   `event_type`
-   `severity`
-   `metadata jsonb`
-   `occurred_at`
-   `received_at`

Use for lifecycle and integrity-review events. Never use these events
alone to automatically accuse or penalize a student.

### `identity_checks`

-   `id`
-   `attempt_id`
-   `verification_id null`
-   `status`
-   `provider`
-   `checked_at`
-   `metadata jsonb`

------------------------------------------------------------------------

## 9. Results and Analytics

### `assessment_results`

-   `id`
-   `attempt_id UNIQUE`
-   `student_id`
-   `deployment_id`
-   `raw_score`
-   `possible_score`
-   `percentage`
-   `status`
-   `released_at null`
-   `released_by null`
-   timestamps

### `item_statistics`

-   `id`
-   `deployment_id`
-   `question_id`
-   `attempt_count`
-   `correct_count`
-   `difficulty_index null`
-   `discrimination_index null`
-   `distractor_statistics jsonb`
-   `calculated_at`
-   UNIQUE (`deployment_id`, `question_id`)

### `assessment_statistics`

-   `id`
-   `deployment_id UNIQUE`
-   `attempted_count`
-   `completed_count`
-   `mean`
-   `median`
-   `minimum`
-   `maximum`
-   `standard_deviation`
-   `pass_rate`
-   `calculated_at`

Analytics should be recomputable from source responses/results; cached
statistics are not the sole source of truth.

------------------------------------------------------------------------

## 10. System Tables

### `notifications`

-   `id`
-   `user_id`
-   `type`
-   `title`
-   `body`
-   `data jsonb`
-   `read_at null`
-   `created_at`

### `audit_logs`

Append-only where feasible: - `id` - `actor_user_id null` - `action` -
`entity_type` - `entity_id null` - `metadata jsonb` -
`ip_hash/device metadata only if justified` - `created_at`

Never store secrets or raw biometric payloads in logs.

### `ai_usage_logs`

-   `id`
-   `user_id`
-   `assessment_id null`
-   `provider`
-   `model`
-   `operation`
-   `input_tokens null`
-   `output_tokens null`
-   `estimated_cost null`
-   `duration_ms null`
-   `status`
-   `error_code null`
-   `created_at`

### `system_settings`

Use sparingly: - `id` - `key UNIQUE` - `value jsonb` -
`is_sensitive boolean` - timestamps

Secrets belong in environment/secret management, not this table.

------------------------------------------------------------------------

## 11. Core Relationship Model

``` text
auth.users
   |
 profiles
   |----------------------|
student_profiles      faculty_profiles
   |                      |
 enrollments        faculty_assignments
   |                      |
   +---- subject_offerings+
              |
       assessment_deployments
              |
       assessment_versions
              |
          assessments
              |
           questions
          /    |     \
   choices  sources  answer_keys [protected]
              |
         source_chunks
              |
       source_materials

student
   |
exam_attempts -> exam_manifests
   |
student_responses
   |
assessment_results
   |
analytics/statistics
```

------------------------------------------------------------------------

## 12. RLS Helper Strategy

Create security-definer helper functions only when necessary and
carefully avoid recursive RLS.

Examples conceptually: - `is_super_admin(auth.uid())` -
`is_faculty(auth.uid())` - `is_student(auth.uid())` -
`faculty_has_offering(auth.uid(), offering_id)` -
`student_enrolled_in(auth.uid(), offering_id)` -
`student_owns_attempt(auth.uid(), attempt_id)`

Keep helpers small, stable, and testable.

------------------------------------------------------------------------

## 13. RLS Policy Matrix

  --------------------------------------------------------------------------
  Resource             Super Admin       Faculty           Student
  -------------------- ----------------- ----------------- -----------------
  Own profile          R/W scoped        R/W own           R/W own

  Academic             Manage            Read required     Read required
  configuration                                            

  Subject offerings    Manage            Read assigned     Read enrolled

  Enrollments          Manage            Read assigned     Read own
                                         offering;         
                                         permitted         
                                         management        

  Source materials     Administrative    Manage assigned   No direct access
                       metadata as       offering          unless explicitly
                       authorized                          published

  Assessments/drafts   Limited           Manage            Published
                       administrative    own/assigned      assigned only
                       access                              

  Questions            As explicitly     Manage assigned   Exam-safe
                       authorized                          projection only

  Answer keys          No blanket access Manage authorized NEVER
                                         assessment        

  Deployments          Manage metadata   Manage assigned   Read eligible
                                                           assigned

  Attempts             Operational       Read/manage       Own only
                       support as        assigned          
                       explicitly                          
                       authorized                          

  Responses            No blanket        Read assigned     Own only as
                       academic access                     allowed

  Results              Operational       Read assigned     Own released only
                       access as                           
                       authorized                          

  Analytics            System-level      Assigned only     None
                       aggregate if                        
                       authorized                          

  Audit logs           Authorized system Relevant scoped   None
                       audit             logs if needed    
  --------------------------------------------------------------------------

`R/W` must still be constrained by business rules.

------------------------------------------------------------------------

## 14. Critical Student RLS Invariants

The database must enforce:

1.  Student can never select `answer_keys`.
2.  Student can never read another student's attempt, response, or
    result.
3.  Student can read an assessment only when assigned through
    enrollment/deployment and permitted by publication rules.
4.  Student cannot create arbitrary attempts outside an authorized
    server-side start-exam workflow.
5.  Student cannot change `student_id`, deployment, version, score,
    scoring status, release status, or timestamps to gain advantage.
6.  Student result visibility requires ownership and release policy.
7.  Student cannot write analytics or audit records directly except
    through controlled RPC/server operations where appropriate.

------------------------------------------------------------------------

## 15. Faculty RLS Invariants

1.  Faculty access requires active assignment to the relevant subject
    offering or explicit ownership/authorization.
2.  Faculty cannot access unrelated subject offerings.
3.  Faculty can modify answer keys only for authorized assessments.
4.  Faculty cannot rewrite historical submitted responses.
5.  Faculty review/scoring changes must be auditable.
6.  Faculty can create student-specific exceptions only for authorized
    deployments.

------------------------------------------------------------------------

## 16. Storage Security

Recommended private buckets: - `assessment-sources` - optional future
`identity-assets` only if absolutely required

Rules: - no public source-material bucket; - path ownership should
include stable IDs, not user-supplied raw paths; - signed URLs are
short-lived; - validate MIME type and file size server-side; - sanitize
filenames; - prevent path traversal; - RLS policies tie source access to
faculty assignment/authorization.

------------------------------------------------------------------------

## 17. Server-Only Operations

The following should execute in trusted server code/RPC/database
functions: - answer-key retrieval; - exam manifest generation; -
authoritative exam-start eligibility; - score computation; - release
computation; - attempt reset; - exception application; - analytics
recalculation; - privileged AI provider calls; - signed file URL
generation; - sensitive audit operations.

Never import service-role clients into Client Components.

------------------------------------------------------------------------

## 18. Time and Exam Eligibility

Persist timestamps as `timestamptz`.

Effective student window: 1. load deployment; 2. apply active student
exception if present; 3. compare against database/server time; 4. verify
attempt limit; 5. calculate attempt expiry as the minimum of allowed
duration and effective closing time unless policy explicitly states
otherwise.

Client timer is display-only; server is authoritative.

------------------------------------------------------------------------

## 19. Offline Synchronization Rules

Each response update should carry a revision/idempotency identifier.

Server validates: - attempt ownership; - attempt state; - question
belongs to manifest; - update occurred within allowed
submission/synchronization rules; - revision is not stale.

Use deterministic conflict resolution and preserve response history for
critical cases.

------------------------------------------------------------------------

## 20. Indexing Recommendations

At minimum index foreign keys and frequent filters: -
`faculty_assignments(faculty_id, subject_offering_id)` -
`enrollments(student_id, subject_offering_id)` -
`source_materials(subject_offering_id)` -
`source_chunks(source_material_id)` - vector index on
`source_chunks.embedding` -
`assessment_versions(assessment_id, version_number)` -
`questions(assessment_version_id, position)` -
`assessment_deployments(subject_offering_id, opens_at, closes_at)` -
`assessment_exceptions(deployment_id, student_id)` -
`exam_attempts(student_id, deployment_id, status)` -
`student_responses(attempt_id, question_id)` -
`assessment_results(student_id, deployment_id)` -
`notifications(user_id, read_at, created_at)` -
`audit_logs(actor_user_id, created_at)`

Validate indexes using actual query plans after implementation.

------------------------------------------------------------------------

## 21. Migration Rules for MiMo

1.  Never modify production schema manually.
2.  Every schema change gets a timestamped Supabase migration.
3.  Migrations include tables, constraints, indexes, functions,
    triggers, grants, and RLS policies needed for the change.
4.  Prefer additive/backward-compatible changes.
5.  Seed only non-sensitive development/test data.
6.  Never seed production answer keys or credentials.
7.  Verify migration on local/dev before staging.
8.  Add rollback/recovery notes for risky migrations.
9.  Do not drop a table/column until application references are audited.
10. Keep generated Supabase TypeScript types synchronized.

------------------------------------------------------------------------

## 22. Database Test Requirements

For every protected table, test: - anonymous access denied; - correct
student access allowed; - other-student access denied; - assigned
faculty access allowed; - unrelated faculty access denied; - super-admin
behavior matches explicit policy; - answer-key access denied to
students; - published/unpublished boundaries; - released/unreleased
result boundaries; - exception behavior; - attempt limit; - server-time
enforcement.

Tests must verify both successful and denied operations.

------------------------------------------------------------------------

## 23. Database Definition of Done

A database feature is complete only when: - migration exists; -
constraints exist; - indexes are justified; - RLS is enabled; - policies
are implemented; - storage policy is implemented if relevant; -
TypeScript types are regenerated; - server actions use the intended
access path; - allowed and denied tests pass; - no service-role secret
is exposed; - no answer-key data reaches student payloads; - audit
behavior is verified where required.
