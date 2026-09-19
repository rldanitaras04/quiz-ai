# AI-Assisted Secure Assessment and Examination Management System

## Features and Scope of Work

**Document status:** Authoritative functional scope for 
implementation
**Target stack:** Next.js, TypeScript, Tailwind CSS, Supabase
PostgreSQL/Auth/Storage, OpenAI API, optional Grok adapter, pgvector,
Chart.js, Vercel, GitHub
**Delivery model:** Mobile-first Progressive Web Application (PWA)

------------------------------------------------------------------------

## 1. Purpose

Build a secure, mobile-first assessment platform in which faculty can
create AI-assisted assessments from instructional source materials,
review and approve the generated assessment, schedule it per subject
offering and section, securely administer examinations, automatically
score objective items, review ambiguous identification answers, release
results, and analyze assessment quality.

The application MUST be implemented as an interconnected workflow rather
than as isolated CRUD modules.

### Master workflow

``` text
Faculty Assignment
  -> Subject Offering
  -> Student Enrollment
  -> Source Materials
  -> TOS / Assessment Blueprint
  -> AI Assessment Generation
  -> Duplicate + Quality + Grounding Validation
  -> Faculty Review / AI Modification
  -> Final Assessment Version + Answer Key
  -> Section-Specific Deployment
  -> Student Notification
  -> Student Authentication
  -> Face/Liveness Verification when required
  -> Secure Exam Attempt
  -> Randomized Exam Manifest
  -> Auto-Save / Offline Queue / Re-Sync
  -> Submission
  -> Server-Side Scoring
  -> Faculty Review
  -> Result Release
  -> Student Result
  -> Faculty Analytics / Item Analysis
  -> Question Bank Improvement
```

------------------------------------------------------------------------

## 2. Roles

The system SHALL have exactly three primary application roles.

### 2.1 Super Administrator

-   Manage users and role assignments.
-   Configure academic years, semesters, programs, year levels,
    sections, and subjects.
-   Configure system-wide settings, AI providers, limits, security,
    notifications, and operational settings.
-   View system audit and AI usage logs.
-   Monitor application health.
-   Must not receive unrestricted access to answer keys or student
    responses merely because the user is an administrator. Sensitive
    assessment access must be explicitly authorized.

### 2.2 Faculty

-   Access only assigned subject offerings.
-   Manage enrolled students within authorized offerings.
-   Upload and manage source materials.
-   Generate and modify TOS.
-   Generate, edit, validate, approve, version, and publish assessments.
-   Create and modify answer keys for assessments they own or are
    authorized to manage.
-   Configure deployments, schedules, randomization, question pools, and
    score-release policies.
-   Grant student-specific examination exceptions.
-   Review ambiguous identification answers.
-   View faculty-only reports, item analysis, distractor analysis,
    integrity flags, and assessment-quality analytics.
-   Manage reusable question-bank items.

### 2.3 Student

-   Register and authenticate.
-   View enrolled subjects.
-   View assessments assigned to their enrolled subject offerings.
-   Receive assessment notifications.
-   Complete required identity verification before protected exams.
-   Take examinations during valid availability windows.
-   Continue through temporary connectivity interruptions using
    permitted offline persistence.
-   View only their own released assessment results.

------------------------------------------------------------------------

## 3. Academic Structure

Implement:

``` text
Academic Year
  -> Semester
  -> Program
  -> Year Level
  -> Section
  -> Subject
  -> Subject Offering
  -> Faculty Assignment
  -> Student Enrollment
```

`subject_offering` is the operational academic entity connecting a
subject, section, semester, faculty assignment, enrollment, assessment
deployment, and reporting.

The same assessment may be deployed to multiple subject offerings or
sections with independent schedules.

------------------------------------------------------------------------

## 4. Student Registration and Enrollment

### Required

-   Student self-registration.
-   Student ID, full name, email, program, year level, section, and
    authentication credentials.
-   Account status and enrollment status.
-   Enrollment must be validated; registration SHALL NOT automatically
    grant access to arbitrary subjects.
-   Faculty/admin-authorized enrollment into subject offerings.
-   Support individual enrollment.

### Recommended

-   CSV/Excel bulk import for class lists.
-   Duplicate Student ID/email prevention.
-   Enrollment history by semester.
-   Account activation/deactivation without deleting academic history.

------------------------------------------------------------------------

## 5. Authentication and Identity Verification

Authentication and exam-taker verification SHALL be separate concerns.

### Standard authentication

-   Supabase Auth.
-   Secure session handling.
-   Password recovery and email verification where configured.
-   Architecture ready for passkeys/MFA.

### Exam identity verification

For assessments configured to require verification:

``` text
Login -> Exam Selection -> Camera Permission -> Face Verification
-> Liveness Verification -> Verification Result -> Exam Authorization
```

Requirements: - Use a replaceable identity-verification adapter. - Do
not implement simplistic blink-only liveness as proof of identity. -
Support a qualified external face/liveness provider when implemented. -
Provide faculty-authorized fallback/manual verification. - Store
verification result/status and minimum required metadata; minimize
biometric retention. - Require explicit privacy/consent handling
appropriate to institutional policy.

------------------------------------------------------------------------

## 6. Subject and Class Management

Faculty workspace:

``` text
My Subjects
  -> Subject Offering
     -> Students
     -> Source Materials
     -> Assessments
     -> Deployments
     -> Results
     -> Analytics
     -> Question Bank
```

Faculty access must be scoped to authorized assignments.

------------------------------------------------------------------------

## 7. Assessment Source Material Management

Faculty may create assessment source collections from: - typed or pasted
text; - PDF; - DOCX; - PPTX; - TXT; - Markdown; - other approved
text-extractable formats.

### Processing

``` text
Upload -> File Validation -> Secure Storage -> Text Extraction
-> Normalization -> Chunking -> Embeddings -> Indexed Knowledge Source
```

### Deferred feature

-   OCR/image-based source extraction is a future enhancement and SHALL
    NOT block initial delivery.

### Requirements

-   Private storage buckets.
-   File type/size validation.
-   Source ownership and subject association.
-   Source processing status.
-   Extraction error handling.
-   Ability to remove/replace sources before assessment finalization.

------------------------------------------------------------------------

## 8. AI Assessment Generator

Initial supported question types: - Multiple Choice - Identification

Faculty configures: - assessment title/category; - number of items per
question type; - topics; - source materials; - difficulty
distribution; - Bloom's cognitive distribution; - TOS; - optional custom
generation instructions.

Assessment categories may include quiz, pre-test, post-test, unit test,
midterm, final, practice, and custom.

AI output SHALL always be a draft until faculty approval.

------------------------------------------------------------------------

## 9. Difficulty and Cognitive-Level Controls

Support: - Easy - Moderate - Difficult

Support Bloom's Revised Taxonomy: - Remember - Understand - Apply -
Analyze - Evaluate - Create

Each question SHALL store intended difficulty and cognitive level
metadata. Distribution totals must be validated before generation.

------------------------------------------------------------------------

## 10. Table of Specifications (TOS)

TOS generation is REQUIRED.

Inputs may include: - topics; - source-material coverage; - learning
objectives/outcomes; - number of items; - question types; - difficulty
distribution; - Bloom's distribution.

Faculty must be able to: - generate a proposed TOS; - manually edit
it; - validate totals and percentages; - approve it before final
question generation; - preserve the approved TOS with the assessment
version.

------------------------------------------------------------------------

## 11. Retrieval-Grounded Generation

AI question generation SHALL be grounded primarily in faculty-provided
source material.

``` text
Sources -> Extraction -> Chunks -> Embeddings -> Vector Search
-> Relevant Context -> AI -> Candidate Questions -> Validation
```

Requirements: - pgvector or equivalent vector retrieval. - Retrieval
filters by authorized source collection/assessment. - Do not silently
use unrelated external knowledge unless the faculty explicitly enables
it. - Record source provenance for generated items.

------------------------------------------------------------------------

## 12. Source Traceability

Each AI-generated question SHALL be traceable to supporting source
content.

Store: - question ID; - source material ID; - source chunk ID(s); -
generation provider/model; - prompt/template version; - generation
timestamp; - validation metadata.

Faculty SHALL have a **View Source** action for generated questions.

------------------------------------------------------------------------

## 13. Duplicate and Similarity Prevention

Mandatory pipeline:

``` text
Candidate -> Normalize -> Exact Duplicate Check
-> Semantic Similarity Check -> Repeated Context/Scenario Check
-> Accept or Reject -> Regenerate Rejected Items
```

Detect: - exact duplicates; - paraphrased duplicates; - semantically
equivalent questions; - repetitive scenarios; - repeated testing of
substantially the same fact; - duplicate/near-duplicate answer choices
where inappropriate.

Similarity checking should operate within the current assessment and,
where configured, against relevant question-bank items.

Thresholds must be configurable and validation results stored.

------------------------------------------------------------------------

## 14. Question Quality Validation

Validate generated questions for: - source grounding; - clarity; -
ambiguity; - correct answer support; - one best answer for MCQ; -
plausible distractors; - grammatical consistency; - unintended clues; -
duplicate/similarity risk; - difficulty alignment; - Bloom's
alignment; - completeness.

Failed items must be flagged or regenerated. Faculty remains the final
reviewer.

------------------------------------------------------------------------

## 15. AI Draft Assessment Workspace

Provide a faculty editing workspace with: - question list/navigation; -
source traceability; - edit question; - edit choices; - modify correct
answer; - delete; - add manual question; - regenerate one item; -
regenerate selected items; - regenerate distractors; - reorder items; -
change difficulty/Bloom's metadata; - validation indicators; - save
draft; - preview student view; - submit for faculty final
approval/publish.

------------------------------------------------------------------------

## 16. AI Modification Assistant

Provide an assessment-scoped AI assistant.

Examples: - "Make items 21-30 more difficult." - "Replace semantically
similar questions." - "Generate more application-level SQL questions." -
"Improve distractors for question 18."

Rules: - AI changes SHALL be proposed, not silently committed. - Faculty
can review diffs and accept/reject proposed modifications. - Accepted
material creates or contributes to a new assessment version. - AI
actions are logged with provider/model and usage metadata.

------------------------------------------------------------------------

## 17. Assessment Version Control

Lifecycle:

``` text
DRAFT -> REVIEWED -> APPROVED -> PUBLISHED -> CLOSED -> ARCHIVED
```

Maintain versions such as Draft v1, AI Revision v2, Faculty Revision v3,
Approved v4.

Requirements: - Published/attempted historical versions must remain
reproducible. - Do not mutate historical question content after student
attempts exist. - Subsequent edits create a new version. - Preserve TOS,
questions, choices, answer-key mapping, and relevant configuration per
version.

------------------------------------------------------------------------

## 18. Answer-Key Security

-   Only authorized faculty may create or modify answer keys for their
    assessments.
-   Answer keys SHALL NOT be included in student exam payloads.
-   Scoring SHALL occur in trusted server/database code.
-   Never expose service-role credentials or answer-key queries to the
    browser.
-   Log answer-key changes.
-   Protect answer-key tables with strict grants and RLS/server-only
    access.

------------------------------------------------------------------------

## 19. Assessment Deployment and Scheduling

Separate reusable assessment content from deployment.

Each deployment associates: - assessment version; - subject
offering/section; - opening date/time; - closing date/time; -
duration; - attempt limit; - randomization policy; - question-pool
policy; - score-release policy; - identity-verification requirement.

Server time is authoritative. Device clock manipulation must not change
eligibility.

------------------------------------------------------------------------

## 20. Student-Specific Examination Exceptions

Faculty can grant: - extended closing time; - alternate schedule; -
additional duration; - additional attempt; - attempt reset.

Requirements: - Apply only to selected student(s). - Do not reopen the
examination for the entire class. - Require reason. - Record authorizer,
timestamps, original rule, override, and audit event.

------------------------------------------------------------------------

## 21. Exam-Taking Interface

Initial mobile-first interface: - subject and assessment title; -
remaining server-authoritative time; - answered/total progress; -
question content; - choices/input; - Previous/Next; - Flag for Review; -
question navigator; - answered/unanswered/flagged state; - submission
confirmation.

Prioritize clarity, touch targets, low bandwidth, and small-screen
usability.

------------------------------------------------------------------------

## 22. Auto-Save, Offline Persistence, and Re-Synchronization

Required architecture:

``` text
Answer -> Local State -> IndexedDB -> Sync Queue -> Server
```

When offline: - persist permitted answer state locally; - show
connectivity/sync status; - continue within allowed exam design.

When connection returns: - automatically synchronize queued responses; -
make operations idempotent; - handle conflicts deterministically; - show
synchronization success/failure.

Security: - never cache answer keys; - minimize sensitive cached data; -
clear protected local examination data according to lifecycle rules
after confirmed submission/expiry.

------------------------------------------------------------------------

## 23. Randomization and Question Pools

Faculty can configure: - fixed/random question order; - fixed/random
choice order; - question-pool selection.

Create an immutable `exam_manifest` per attempt containing the exact
selected questions and ordering.

Question pools may constrain selection by: - topic; - question type; -
difficulty; - Bloom's level; - TOS allocation.

Randomization must not break scoring or historical reconstruction.

------------------------------------------------------------------------

## 24. Examination Session Security

Each attempt SHALL maintain: - student; - deployment; - assessment
version; - manifest; - start/expiry/submission timestamps; - session
state; - identity verification status; - server-authoritative timing; -
synchronization status; - relevant device/session metadata.

Prevent unauthorized concurrent attempts according to policy.

------------------------------------------------------------------------

## 25. Examination Integrity Signals

Include faculty-review integrity signals to help detect potentially
unusual behavior: - tab/window visibility changes; - fullscreen exits
where fullscreen is used; - concurrent sessions; - unexpected
session/device changes; - repeated verification failures; - abnormal
reconnect patterns; - unauthorized access attempts.

Important: - Integrity events are review signals, not automatic findings
of cheating. - Do not automatically penalize students from these
signals. - Faculty sees event details and makes the academic
determination.

------------------------------------------------------------------------

## 26. Automatic Checking

### Multiple Choice

Deterministic server-side comparison with protected answer key.

### Identification

Support: 1. normalization of case; 2. whitespace normalization; 3.
punctuation normalization; 4. approved aliases/alternative answers; 5.
optional fuzzy-match candidate; 6. faculty review for uncertain
responses.

AI may recommend a judgment for ambiguous identification answers, but
faculty confirms final scoring where confidence is insufficient.

------------------------------------------------------------------------

## 27. Score Computation and Release

Default:

``` text
percentage = earned_points / possible_points * 100
```

Support weighted items.

Faculty controls release: - immediately after submission; - after
deployment closes; - specified date/time; - manual release.

Faculty independently controls visibility of: - raw score; -
percentage; - correct/incorrect indicators; - correct answers; -
explanations.

Students can view only their own released results.

------------------------------------------------------------------------

## 28. Faculty Analytics

Faculty-only analytics by assessment, subject offering, section, topic,
and item: - enrolled count; - attempted count; - completed count; -
completion rate; - mean; - median; - highest/lowest; - standard
deviation; - pass rate; - score distribution.

Use Chart.js for appropriate visualizations.

------------------------------------------------------------------------

## 29. Item and Distractor Analysis

Faculty only.

Difficulty index:

``` text
P = R / N
```

Discrimination index using configurable upper/lower group methodology:

``` text
D = (RU / NU) - (RL / NL)
```

Distractor analysis: - selection count/percentage per option; - correct
option; - low-use distractor identification; - item review flags.

Interpretation thresholds must be configurable and treated as analytic
guidance, not unquestionable conclusions.

------------------------------------------------------------------------

## 30. Question Bank

Approved questions may enter a reusable question bank.

Metadata: - subject; - topic; - source; - question type; - difficulty; -
Bloom's level; - creator; - usage count; - last used; - historical item
statistics; - distractor performance; - status.

Question-bank reuse must preserve source/provenance and avoid duplicate
generation.

------------------------------------------------------------------------

## 31. Assessment Quality Dashboard

### Pre-exam

-   source-grounding coverage;
-   TOS alignment;
-   difficulty distribution;
-   Bloom's distribution;
-   exact duplicate count;
-   semantic similarity flags;
-   validation issues.

### Post-exam

-   central tendency and spread;
-   pass/completion metrics;
-   item flags;
-   distractor flags;
-   items recommended for faculty review.

------------------------------------------------------------------------

## 32. Notifications

Global in-app notification system.

Student events: - upcoming exam; - exam opening soon; -
schedule/exception change; - result released.

Faculty events: - assessment closed; - submission progress; - responses
requiring manual review; - generation/processing completion or failure.

Architecture should allow future push/email adapters.

------------------------------------------------------------------------

## 33. Dashboards

### Faculty

Show: - assigned subjects; - student count; - upcoming assessments; -
pending reviews; - recent performance; - alerts/actions; - Chart.js
analytics.

### Student

Show: - upcoming assessments; - enrolled subjects; - current assessment
eligibility; - recent released results; - notifications.

Dashboards must be role-specific and query only authorized data.

------------------------------------------------------------------------

## 34. Audit Trail

Record critical events including: - registration/enrollment; - source
upload; - AI generation/modification; - question and answer-key
changes; - approval/publishing; - deployment/schedule changes; -
identity verification; - exam start/save/submit/auto-submit; -
exceptions and resets; - scoring changes; - result release; -
security-sensitive authorization failures where appropriate.

Audit records should contain actor, action, target, timestamp, and safe
metadata. Avoid logging secrets, raw biometric data, or full sensitive
payloads unnecessarily.

------------------------------------------------------------------------

## 35. Mobile-First PWA Requirements

Design from 320px upward.

Required: - responsive layout; - installable manifest; - service
worker; - application icons; - offline application shell; - IndexedDB; -
sync/retry queue; - connectivity indicator; - update notification; -
camera integration; - touch-friendly controls; - safe-area support; -
keyboard accessibility; - accessible labels/focus states; - graceful
low-bandwidth behavior.

------------------------------------------------------------------------

## 36. AI Architecture

Create a provider-neutral service boundary.

``` ts
interface AssessmentAIService {
  generateTOS(...)
  generateAssessment(...)
  regenerateQuestion(...)
  modifyAssessment(...)
  generateDistractors(...)
  classifyBloomLevel(...)
  estimateDifficulty(...)
  validateQuestion(...)
  detectSimilarity(...)
  evaluateIdentificationCandidate(...)
}
```

Initial provider: OpenAI API.\
Optional additional adapter: Grok API.

Provider API keys must remain server-side.

Track: - provider/model; - operation; - token/usage metadata where
available; - estimated cost where available; - user/faculty; -
assessment; - timestamp; - duration; - success/failure.

------------------------------------------------------------------------

## 37. DevOps and Environments

Environments: - Local - Development/Preview - Staging - Production

Git workflow:

``` text
feature/* -> Pull Request -> Automated Checks -> Vercel Preview
-> Review -> main -> Production
```

Do not reuse production secrets in preview/development.

------------------------------------------------------------------------

## 38. CI/CD Quality Gates

Run: - dependency install; - TypeScript type check; - lint; - unit
tests; - integration tests; - database tests; - RLS authorization
tests; - production build; - critical E2E tests.

Critical failures block production deployment.

------------------------------------------------------------------------

## 39. Critical E2E Tests

Test at minimum:

``` text
Registration -> Enrollment -> Login -> Verification -> Exam Eligibility
-> Attempt -> Auto-Save -> Disconnect -> Offline Persistence -> Reconnect
-> Re-Sync -> Submit -> Score -> Faculty Review -> Release
-> Student Result -> Faculty Analytics
```

Security tests: - student cannot retrieve another student's result; -
student cannot retrieve answer keys; - student cannot access
unpublished/early exams; - URL/ID manipulation cannot bypass
authorization; - client clock cannot extend eligibility; - unauthorized
concurrent attempt is rejected; - faculty cannot manage unrelated
offerings; - anonymous users cannot access protected source files; -
expired exceptions cannot be reused.

------------------------------------------------------------------------

## 40. Delivery Phases

### Phase 1 - Foundation

Next.js architecture, Supabase, authentication, three-role RBAC, RLS,
academic structure, enrollment, responsive PWA shell.

### Phase 2 - AI Assessment Authoring

Source upload/extraction, RAG, TOS, difficulty/Bloom's controls,
MCQ/identification generation, duplicate prevention, validation, source
traceability, AI modification assistant, versioning.

### Phase 3 - Examination Engine

Scheduling, question pools, randomization, answer-key protection,
manifests, exceptions, timer, auto-save, IndexedDB, offline
synchronization, submission.

### Phase 4 - Identity and Integrity

Face verification/liveness adapter, secure sessions, concurrent-session
rules, integrity signals, audit trail.

### Phase 5 - Scoring and Analytics

Automatic checking, faculty review, score release, student results,
Chart.js analytics, item/distractor analysis, question bank, quality
dashboard.

### Phase 6 - Production Hardening

Notifications, security review, RLS/E2E testing, accessibility,
performance/load testing, monitoring, backup/recovery, CI/CD,
staging/production.

### Future

OCR/image-source extraction and additional assessment formats.

------------------------------------------------------------------------

## 41. MiMo Implementation Rules

1.  Do not replace existing working functionality without first tracing
    dependencies.
2.  Audit the repository before modifying architecture.
3.  Implement vertical slices, not disconnected pages.
4.  Every UI action must be traced through authorization, server
    action/API, database/RLS, and resulting UI state.
5.  Never solve authorization only in the frontend.
6.  Never expose answer keys, Supabase service-role credentials, AI API
    keys, or privileged secrets to client bundles.
7.  All schema changes must use migrations.
8.  Add indexes and constraints deliberately.
9.  Add tests with each critical workflow.
10. After each phase run typecheck, lint, tests, build, RLS tests, and
    relevant E2E tests.
11. Report changed files, migrations, tests, unresolved risks, and
    manual setup required.
12. Do not declare a feature complete until its complete end-to-end
    workflow has been tested.
