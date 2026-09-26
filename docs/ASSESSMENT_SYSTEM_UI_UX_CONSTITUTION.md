# AI-Assisted Secure Examination and Assessment System

## UI/UX Constitution

**Status:** Permanent frontend authority
**Framework:** Next.js + TypeScript + Tailwind CSS
**Visualization:** Chart.js
**Target:** Mobile-first PWA
**Priority:** Clarity, security, accessibility, responsiveness,
examination reliability

------------------------------------------------------------------------

# 1. Constitutional Rule

All frontend work MUST conform to this document unless a later
explicitly approved UI constitution supersedes it.

MiMo SHALL NOT redesign pages independently in ways that create
inconsistent layouts, navigation, spacing, controls, terminology, or
interaction patterns.

The application is one coherent product, not a collection of unrelated
CRUD screens.

------------------------------------------------------------------------

# 2. Product UX Principles

1.  **Mobile first.** Design at 320-375px first, then enhance for
    tablet/desktop.
2.  **Task first.** Prioritize the user's current academic task over
    decorative UI.
3.  **Low cognitive load.** Examination interfaces must be especially
    distraction-free.
4.  **Consistent navigation.** Users should not relearn navigation
    between modules.
5.  **Visible system state.** Loading, saving, syncing, offline,
    processing, validation, and error states must be explicit.
6.  **Safe destructive actions.** Delete, reset, invalidate, release,
    and publish actions require appropriate confirmation.
7.  **Progressive disclosure.** Advanced configuration should not
    overwhelm basic workflows.
8.  **Accessibility by default.** Keyboard, labels, contrast, focus,
    error descriptions, and semantic markup are required.
9.  **Never rely on color alone.** Status must use text/icon/shape in
    addition to color.
10. **Security is part of UX.** Do not expose privileged data merely to
    hide it later with CSS.

------------------------------------------------------------------------

# 3. Responsive Breakpoints

Use Tailwind's responsive model, but design behavior explicitly for:

``` text
Mobile: 320px+
Tablet: 768px+
Desktop: 1024px+
Wide: 1280px+
```

Rules: - no horizontal page scrolling at 320px except deliberate
data-table containers; - touch targets should be comfortably tappable; -
dialogs must fit mobile screens; - tables transform to cards/stacked
rows when that improves comprehension; - examination controls remain
reachable with one-handed mobile use where practical.

------------------------------------------------------------------------

# 4. Global Application Shell

Authenticated pages use one shared application shell.

### Desktop

``` text
+----------------+---------------------------------------+
| Sidebar        | Top Bar                               |
|                +---------------------------------------+
| Navigation     |                                       |
|                | Main Content                          |
|                |                                       |
+----------------+---------------------------------------+
```

### Mobile

``` text
+--------------------------------+
| Top App Bar                    |
+--------------------------------+
|                                |
| Main Content                   |
|                                |
+--------------------------------+
| Contextual Bottom/Nav or       |
| Drawer Trigger as appropriate  |
+--------------------------------+
```

Do not render a desktop sidebar squeezed into mobile width.

------------------------------------------------------------------------

# 5. Role-Based Navigation

Navigation must be generated from the authenticated role and authorized
data.

## Super Administrator

Recommended: - Dashboard - Users - Academic Structure - Subjects /
Offerings - System Settings - AI Configuration / Usage - Audit Logs -
System Monitoring

## Faculty

Recommended: - Dashboard - My Subjects - Assessments - Question Bank -
Results & Analytics - Notifications

Subject-specific features should also be reachable contextually through
**My Subjects**.

## Student

Recommended: - Dashboard - My Subjects - Assessments - My Results -
Notifications - Profile

Never show unauthorized navigation and rely on the destination page to
reject it. Hide unauthorized actions **and** enforce authorization
server-side/RLS.

------------------------------------------------------------------------

# 6. Page Header Pattern

Each major page should have: - breadcrumb when hierarchy is useful; -
page title; - concise supporting description when necessary; - primary
action; - optional contextual secondary actions.

Example:

``` text
My Assessments
Create, review, schedule, and analyze your assessments.

                              [Create Assessment]
```

On mobile, actions may stack or become a compact action menu.

------------------------------------------------------------------------

# 7. Layout and Spacing

Use a consistent spacing system based on Tailwind tokens.

Preferred content behavior: - full available width with sensible
max-width for reading/forms; - analytics may use wider containers; -
forms should not stretch text fields unnecessarily on desktop; - cards
should have consistent padding and radius; - avoid nested cards unless
hierarchy genuinely requires them.

Do not waste large portions of mobile screens on oversized headers.

------------------------------------------------------------------------

# 8. Typography

Use a clean system/sans-serif typography stack supported by the project.

Hierarchy: - Page Title - Section Heading - Card/Panel Heading - Body -
Supporting/Metadata - Caption

Requirements: - readable at mobile sizes; - consistent weights; - no
excessive uppercase; - avoid tiny text for important examination
information.

------------------------------------------------------------------------

# 9. Color and Status Semantics

Use a restrained professional academic interface.

Define semantic design tokens rather than hardcoding colors
repeatedly: - `primary` - `surface` - `background` - `foreground` -
`muted` - `border` - `success` - `warning` - `danger` - `info`

Status must include text, e.g.: - Draft - Approved - Published -
Active - Closed - Released - Needs Review - Offline - Syncing - Synced

Do not use color as the only status indicator.

------------------------------------------------------------------------

# 10. Component Catalog

MiMo should create/reuse shared components instead of duplicating UI.

Core: - `AppShell` - `Sidebar` - `MobileNavigation` - `TopBar` -
`PageHeader` - `Breadcrumbs` - `Card` - `StatCard` - `Button` -
`IconButton` - `Input` - `Textarea` - `Select` - `Checkbox` -
`RadioGroup` - `Switch` - `DateTimePicker` - `SearchInput` -
`DataTable` - `ResponsiveList` - `Tabs` - `Badge` - `StatusBadge` -
`Alert` - `EmptyState` - `Skeleton` - `Spinner` - `Modal/Dialog` -
`Drawer/Sheet` - `ConfirmDialog` - `Toast` - `Pagination` -
`FileUploader` - `Progress` - `OfflineIndicator` - `SyncIndicator`

Assessment-specific: - `AssessmentCard` - `AssessmentStatus` -
`QuestionEditor` - `QuestionNavigator` - `ChoiceEditor` - `TOSBuilder` -
`DifficultyDistribution` - `BloomDistribution` - `SourceViewer` -
`ValidationPanel` - `AIModificationPanel` - `VersionHistory` -
`ScheduleEditor` - `ExceptionDialog` - `ExamTimer` - `ExamProgress` -
`ExamQuestion` - `FlagForReview` - `SubmissionReview` -
`IdentityVerificationPanel` - `IntegrityReviewPanel` - `ScoreCard` -
`ItemAnalysisTable` - `DistractorChart` - `AssessmentQualityPanel`

------------------------------------------------------------------------

# 11. Form Constitution

Every form: - uses explicit labels; - indicates required fields; -
displays field-level errors near the field; - preserves user input after
validation failure; - disables duplicate submissions; - shows processing
state; - validates client-side for UX and server-side for authority; -
uses sensible mobile keyboards/input modes; - does not rely on
placeholders as labels.

Long forms should use logical sections or steps.

------------------------------------------------------------------------

# 12. Data Table Constitution

Desktop: - sortable/filterable where useful; - sticky header only if it
improves usability; - clear empty state; - pagination for large
datasets; - row actions grouped consistently.

Mobile: - do not force a 10-column table into 320px; - transform
important rows into stacked cards or a horizontally scrollable table
only when comparison requires columns; - preserve key actions.

------------------------------------------------------------------------

# 13. Faculty Dashboard Constitution

Priority order: 1. actions requiring attention; 2. upcoming assessments;
3. assigned subjects; 4. performance overview; 5. recent activity.

Suggested structure:

``` text
Faculty Dashboard

[My Subjects] [Students] [Upcoming] [Pending Review]

Action Required
- Responses requiring review
- Drafts awaiting completion

Upcoming Assessments
- Subject / Section / Date / Time / Status

Performance Overview
- Chart.js visualization

Recent Activity
```

Do not fill the dashboard with vanity metrics.

------------------------------------------------------------------------

# 14. Student Dashboard Constitution

Keep simpler than faculty.

Priority: 1. upcoming/current assessments; 2. required actions; 3.
enrolled subjects; 4. released results; 5. notifications.

Never expose: - class answer keys; - other students' scores; - class
analytics; - item-analysis data.

------------------------------------------------------------------------

# 15. Subject Workspace

Faculty subject page should function as a coherent workspace.

Recommended tabs/sections: - Overview - Students - Source Materials -
Assessments - Results & Analytics - Question Bank

Context header:

``` text
Database Systems
BSIT 2A | First Semester | AY 2026-2027
```

Actions must preserve the subject-offering context.

------------------------------------------------------------------------

# 16. Assessment Creation Wizard

Recommended sequence:

``` text
1. Basic Information
2. Source Materials
3. Topics / Outcomes
4. Generate or Configure TOS
5. Question Types and Counts
6. Difficulty / Bloom's Distribution
7. AI Instructions
8. Generate Draft
9. Review and Validate
10. Approve
11. Schedule / Deploy
```

Allow Save Draft and resume.

Do not force faculty to regenerate an entire assessment when only one
stage changes.

------------------------------------------------------------------------

# 17. Source Material UI

Show: - upload/drop area; - accepted file types; - processing state; -
extracted/ready/error state; - topic association; - remove/replace
action; - source preview where safe.

States:

``` text
Uploading -> Processing -> Ready
                      \-> Failed
```

OCR-related UI should remain hidden/disabled until OCR is implemented.

------------------------------------------------------------------------

# 18. TOS Builder UI

The TOS builder is a first-class assessment component.

Provide: - topic rows; - weights; - Bloom's columns; - item totals; -
validation; - AI Generate TOS; - manual editing; - Recalculate; -
Approve TOS.

Always display: - total percentage; - total item count; - validation
mismatch.

Prevent approval when configured totals are invalid.

------------------------------------------------------------------------

# 19. AI Generation UI

During generation: - show meaningful progress states; - do not fake
exact percentages if backend cannot know them; - allow safe cancellation
only if supported; - show failure with retry.

After generation: - show number generated; - duplicates
rejected/regenerated; - validation warnings; - source-grounding
status; - AI provider/model metadata only where useful to faculty/admin.

------------------------------------------------------------------------

# 20. Assessment Draft Workspace

Desktop:

``` text
+----------------------+----------------------------+
| Question Navigator   | Question Editor            |
| / Filters            |                            |
|                      | Choices / Answer           |
|                      | Metadata                   |
|                      | Validation                 |
+----------------------+----------------------------+
| AI Modification / Source panel as drawer/panel   |
+---------------------------------------------------+
```

Mobile: - one question editor at a time; - navigator in drawer/sheet; -
validation and source in collapsible panels; - sticky Save/Next actions
where useful.

Faculty must clearly see: - item number; - type; - difficulty; - Bloom's
level; - source status; - validation warnings; - draft/approved state.

------------------------------------------------------------------------

# 21. AI Modification UX

AI assistant is contextual to the current assessment or selected
questions.

Flow:

``` text
Prompt -> AI Proposal -> Diff/Preview -> Accept / Reject
```

Never apply bulk AI modifications without faculty confirmation.

For destructive/large changes, show how many questions will be affected.

------------------------------------------------------------------------

# 22. Version History UI

Show: - version number; - creator/change source; - timestamp; -
status; - short change summary.

Allow comparison where practical.

Published historical versions should be read-only.

------------------------------------------------------------------------

# 23. Scheduling UI

Faculty can deploy the same assessment version to multiple sections.

Each deployment clearly displays: - subject/section; - open date/time; -
close date/time; - duration; - attempts; - identity requirement; -
randomization; - release policy; - status.

Validate schedule conflicts and invalid date ranges before save.

------------------------------------------------------------------------

# 24. Student Exception UI

Faculty opens a student-specific exception dialog from a
deployment/student list.

Fields: - student; - exception type; - new/extended time; - additional
attempt/duration; - reason; - effective/expiry information.

Show the original rule and resulting effective rule before confirmation.

------------------------------------------------------------------------

# 25. Exam Entry Screen

Before entering: - assessment title; - subject; - schedule; -
duration; - attempt information; - device/connectivity readiness; -
identity-verification requirement; - concise instructions.

Primary CTA: **Verify Identity and Start** or **Start Assessment**
depending on policy.

Do not expose questions before the authorized start flow succeeds.

------------------------------------------------------------------------

# 26. Identity Verification UI

Requirements: - explain why camera access is requested; - explicit
consent/notice as required; - camera permission state; - verification
progress; - liveness instructions from provider; - clear
success/failure; - retry policy; - manual/faculty fallback pathway.

Avoid storing/displaying unnecessary biometric imagery.

------------------------------------------------------------------------

# 27. Examination UI Constitution

This is a special distraction-free mode.

Must show: - assessment/subject; - server-synchronized remaining time; -
progress; - current question; - response controls; - Previous/Next; -
Flag for Review; - sync/connectivity state.

Must not show: - normal sidebar; - unrelated notifications; - dashboard
links; - answer correctness during the attempt unless explicitly
designed for practice mode.

Mobile: - question text first; - large tap targets; - choices vertically
stacked; - sticky navigation only if it does not obscure content.

------------------------------------------------------------------------

# 28. Exam Navigator

States: - current; - answered; - unanswered; - flagged.

Never use color alone.

Example accessible labels: - `Question 12, answered` -
`Question 13, unanswered, flagged for review`

------------------------------------------------------------------------

# 29. Timer UX

The visible timer is synchronized with server-authoritative expiry.

Warnings may appear at configurable thresholds, e.g.: - 10 minutes
remaining; - 5 minutes; - 1 minute.

Warnings must not repeatedly obstruct answering.

If client time differs from server, silently resynchronize display and
use server result.

------------------------------------------------------------------------

# 30. Auto-Save and Offline UX

Persistent but unobtrusive status:

``` text
Saved
Saving...
Offline - saved on this device
Syncing...
Sync failed - retrying
```

When connection returns: - automatically begin re-sync; - do not require
the student to manually resubmit every answer; - surface unrecoverable
sync failures clearly.

Do not claim "Saved" until the appropriate local/server state is
actually persisted.

------------------------------------------------------------------------

# 31. Submission UX

Before final submission show: - answered count; - unanswered count; -
flagged count; - remaining time.

Require confirmation.

After confirmed server submission: - show immutable submission
receipt/status; - submitted timestamp; - result availability policy.

Prevent accidental double submission.

------------------------------------------------------------------------

# 32. Integrity Review UX

Faculty-only.

Display signals as neutral review events: - event type; - timestamp; -
count; - context.

Use terminology such as: - `Review Flag` - `Integrity Event` -
`Requires Review`

Do not label a student "Cheater" or automatically state misconduct.

------------------------------------------------------------------------

# 33. Results UX

Student: - only released own results; - show only fields enabled by
release policy.

Faculty: - class summary; - student result table; - filters; - review
status; - export capability when later implemented.

Clearly distinguish: - provisional/pending review; - final; - released.

------------------------------------------------------------------------

# 34. Analytics UI

Use Chart.js only when a chart improves comprehension.

Recommended: - score distribution; - completion rate; - item difficulty
distribution; - distractor selection.

Requirements: - chart has text title; - labels are readable on mobile; -
provide tabular/text equivalent for accessibility where needed; - avoid
3D charts; - avoid decorative charts with no decision value.

------------------------------------------------------------------------

# 35. Assessment Quality Dashboard UI

Pre-exam cards: - Source Grounding - TOS Alignment - Bloom's Alignment -
Difficulty Alignment - Duplicate Count - Similarity Flags - Validation
Issues

Post-exam: - Mean/Median/SD - Pass Rate - Item Review Flags - Distractor
Review Flags

Every flag should link to the affected question(s).

------------------------------------------------------------------------

# 36. Notifications UX

Global notification center: - unread indicator; - timestamp; -
actionable deep link; - mark read; - mark all read if appropriate.

Notifications should not interrupt an active exam except for critical
examination-specific information.

------------------------------------------------------------------------

# 37. Loading, Empty, Error, and Success States

Every data-driven screen must define:

### Loading

Use skeletons for content structures; spinner for short isolated
actions.

### Empty

Explain what is missing and provide a relevant action.

Example:
`No assessments yet. Create your first assessment from your subject materials.`

### Error

Explain what failed in user terms and provide Retry when safe.

### Success

Use concise confirmation; do not require unnecessary modal dismissal.

------------------------------------------------------------------------

# 38. Destructive and High-Impact Actions

Require explicit confirmation for: - delete source; - delete draft; -
publish assessment; - release results; - reset attempt; - invalidate
attempt; - change answer key after approval; - archive assessment.

For high-impact actions, state consequences before confirmation.

------------------------------------------------------------------------

# 39. Accessibility Requirements

Minimum: - semantic HTML; - keyboard navigability; - visible focus; -
form labels; - error associations; - sufficient contrast; - alt text for
meaningful images; - accessible dialogs; - logical heading order; -
screen-reader labels for icon-only controls; - status not conveyed by
color alone; - reduced-motion respect where applicable.

Exam accessibility must not be sacrificed for security theater.

------------------------------------------------------------------------

# 40. PWA UX

Provide: - installable manifest; - icons; - offline shell; - app update
handling; - connectivity state; - synchronization state; - safe-area
handling.

Do not aggressively prompt installation on first visit. Use a contextual
install experience when appropriate.

------------------------------------------------------------------------

# 41. Performance Constitution

Target low/mid-range mobile devices and variable connectivity.

Rules: - Server Components by default where appropriate. - Client
Components only where interactivity requires them. - Lazy-load heavy
analytics/editor modules. - Optimize images. - Paginate large lists. -
Avoid loading entire class histories when not needed. - Debounce
search. - Avoid unnecessary realtime subscriptions. - Avoid giant
client-side state stores for server-owned data.

------------------------------------------------------------------------

# 42. Security UX Rules

1.  Never render answer keys into student DOM and hide them with CSS.
2.  Never expose privileged IDs/secrets in client logs.
3.  Never show raw server errors containing SQL, tokens, or secrets.
4.  Disable/hide unauthorized controls, but always enforce server/RLS
    authorization too.
5.  Expired sessions redirect through a safe authentication recovery
    flow.
6.  Do not leak whether unrelated student records exist through error
    differences.
7.  File links should be authorized/signed, not public permanent URLs.

------------------------------------------------------------------------

# 43. Terminology Constitution

Use consistent product terms:

-   **Subject Offering** - a subject taught to a specific section in a
    semester.
-   **Assessment** - logical assessment.
-   **Assessment Version** - immutable/reviewable version.
-   **Deployment** - assignment of an assessment version to a subject
    offering with schedule/policy.
-   **Attempt** - one student's examination session.
-   **Question Bank** - reusable approved questions.
-   **Source Material** - faculty-provided assessment grounding content.
-   **TOS** - Table of Specifications.
-   **Review Flag** - event requiring faculty attention; not a
    misconduct conclusion.

Do not alternate randomly between "test", "exam", "quiz", and
"assessment" in system labels when the generic concept is `Assessment`.

------------------------------------------------------------------------

# 44. Frontend Folder Guidance

MiMo may adapt to the existing repository, but a clean target could be:

``` text
app/
  (auth)/
  (dashboard)/
    admin/
    faculty/
    student/
  exam/
components/
  layout/
  ui/
  assessment/
  exam/
  analytics/
  notifications/
features/
  academic/
  assessments/
  ai/
  exam/
  results/
  question-bank/
  identity/
  notifications/
lib/
  supabase/
  auth/
  permissions/
  ai/
  sync/
  validation/
  analytics/
```

Do not refactor blindly if an existing working architecture differs.
Audit first.

------------------------------------------------------------------------

# 45. MiMo Frontend Implementation Protocol

For every page/feature:

1.  Identify role and permission.
2.  Identify source table/query/server action.
3.  Define loading/empty/error/success states.
4.  Implement mobile layout first.
5.  Implement tablet/desktop enhancement.
6.  Reuse shared components.
7.  Wire form validation.
8.  Wire server action/API.
9.  Verify RLS behavior.
10. Test navigation and deep links.
11. Test 320px, 375px, 768px, 1024px, and desktop.
12. Test keyboard accessibility.
13. Test offline/reconnection behavior when relevant.
14. Test authorization failure.
15. Run typecheck/lint/build/tests.

------------------------------------------------------------------------

# 46. UI Definition of Done

A page is NOT complete merely because it renders.

It is complete only when: - it follows the global shell; - role
navigation is correct; - responsive behavior is verified; - all states
exist; - actions are wired to real server/database operations; -
authorization is enforced; - errors are handled; - accessibility basics
pass; - no console-breaking errors exist; - routes do not 404; -
direct/deep navigation works; - mobile PWA behavior is verified where
relevant; - related workflows continue correctly after the action.

------------------------------------------------------------------------

# 47. Final Instruction to MiMo

Before making broad frontend changes, audit the existing application and
produce a dependency-aware implementation plan. Preserve working routes
and components unless replacement is justified.

Do not perform a sweeping layout rewrite in a single uncontrolled pass.

Implement the constitution incrementally, verify each role and route
after each batch, and ensure that:

``` text
User -> Role -> Navigation -> Subject Offering -> Assessment
-> Deployment -> Exam Attempt -> Result -> Analytics
```

remains fully wired end to end.
