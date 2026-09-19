# MASTER APPLICATION COMPLETION, INTEGRATION, SECURITY, AND QA DIRECTIVE

You are acting as the **Lead Software Architect, Senior Full-Stack Engineer, Database Engineer, Security Engineer, and QA Engineer** for this application.

Your objective is not merely to fix visible errors or make individual pages compile.

Your objective is to bring the **entire application to a coherent, secure, functional, end-to-end working state** based on the application's documented requirements, existing architecture, database schema, implemented features, and intended workflows.

The application must behave as **one integrated system**, not as a collection of disconnected pages or CRUD modules.

Do not assume that an existing implementation is correct simply because it compiles or renders.

---

# 1. PRIMARY OBJECTIVE

Perform a complete audit, implementation, integration, security review, and verification of the entire application.

When finished:

* all intended features must be implemented;
* all pages must be reachable through correct routes;
* all navigation must work;
* all buttons must perform their intended actions;
* all forms must work;
* all CRUD operations must work;
* all related modules must exchange data correctly;
* all server actions/API handlers must perform the correct business operation;
* authentication must work;
* authorization must work;
* RBAC must work;
* Supabase RLS must enforce authorization at the database level;
* users must only access data and operations permitted to their role;
* workflows spanning multiple pages/modules must work end-to-end;
* database relationships must remain consistent;
* validation must exist on both client and server where appropriate;
* errors must be handled gracefully;
* loading and empty states must be implemented;
* responsive/mobile behavior must remain functional;
* no dead buttons, placeholder functionality, broken links, orphaned routes, or fake data should remain unless explicitly documented;
* the application must successfully build for production.

Treat this as a **production-readiness completion task**.

---

# 2. DO NOT START BY RANDOMLY EDITING FILES

Before making substantial changes, inspect the entire repository.

Identify and understand:

* application architecture;
* framework and versions;
* package structure;
* route structure;
* layouts;
* middleware;
* authentication implementation;
* authorization implementation;
* user roles;
* database schema;
* migrations;
* Supabase configuration;
* RLS policies;
* server actions;
* API routes/route handlers;
* services;
* repositories/data-access functions;
* components;
* forms;
* validation schemas;
* dashboards;
* navigation;
* notifications;
* audit logging;
* application documentation;
* environment-variable usage;
* existing tests;
* deployment configuration.

Read the project's authoritative documentation first.

Look for files such as:

* README
* FEATURES
* SCOPE
* REQUIREMENTS
* DATABASE_ARCHITECTURE
* UI_CONSTITUTION
* ROLE_NAVIGATION_MATRIX
* WORKFLOW
* SECURITY
* RBAC
* implementation plans
* migration files
* schema definitions

Treat documented approved requirements as the functional source of truth unless they clearly conflict with newer authoritative project documentation.

Do not silently invent major features outside the approved scope.

---

# 3. CREATE A REQUIREMENTS-TO-IMPLEMENTATION MATRIX

Before implementation, derive a complete inventory of application features.

For every feature identify:

| Requirement | Role(s) | Page/Route | UI Component | Server Action/API | Database Tables | RLS/Authorization | Status |
| ----------- | ------- | ---------- | ------------ | ----------------- | --------------- | ----------------- | ------ |

Classify each requirement as:

* COMPLETE
* PARTIAL
* BROKEN
* MISSING
* INCONSISTENT
* SECURITY RISK
* UNVERIFIED

Use this matrix internally to guide implementation.

Do not declare a feature complete simply because its page exists.

A feature is complete only when the entire chain works:

User
→ UI
→ Form/Button
→ Client Validation
→ Server Action/API
→ Authentication
→ Authorization
→ Database/RLS
→ Data Mutation/Query
→ Response
→ UI Update
→ Notification/Feedback
→ Audit Trail where required.

---

# 4. ROUTE AND PAGE AUDIT

Enumerate every application route.

Check:

* route exists;
* page renders;
* layout renders;
* route groups are correct;
* dynamic parameters work;
* authentication requirements are correct;
* authorization requirements are correct;
* navigation links point to valid destinations;
* redirects are correct;
* back-navigation does not break workflows;
* breadcrumbs are correct where used;
* direct URL access is protected appropriately;
* unauthorized routes are blocked;
* missing records produce proper 404/not-found behavior;
* server errors do not expose sensitive information.

Eliminate unintended 404s.

Search the codebase for all:

* href
* router.push
* router.replace
* redirect
* Link
* navigation configuration
* menu definitions

Verify that every referenced internal route actually exists.

---

# 5. BUTTON AND INTERACTION AUDIT

Inspect every interactive UI element.

This includes:

* buttons;
* links;
* menu items;
* dropdown actions;
* tabs;
* dialogs;
* modals;
* submit buttons;
* cancel buttons;
* edit buttons;
* delete buttons;
* approve/reject controls;
* status-changing actions;
* dashboard shortcuts;
* notification links;
* pagination;
* search;
* filters;
* sorting;
* export/download controls;
* upload controls.

Every interactive control must either:

1. perform its intended operation correctly; or
2. be intentionally disabled with a legitimate explanation.

There must be no decorative controls pretending to be functional.

Remove or implement TODO/stub/placeholder actions according to the approved application scope.

---

# 6. CRUD VERIFICATION

For every entity/module that requires CRUD, verify:

## CREATE

Confirm:

UI
→ validation
→ server action/API
→ authorization
→ database insert
→ related-record handling
→ response
→ UI refresh/redirect
→ user feedback
→ audit logging where applicable.

## READ

Verify:

* list queries;
* individual records;
* joins/relationships;
* filtering;
* searching;
* sorting;
* pagination;
* role-specific visibility;
* empty states;
* record-not-found behavior.

## UPDATE

Verify:

* correct record is updated;
* unauthorized fields cannot be modified;
* server-side validation exists;
* authorization is rechecked server-side;
* database constraints are respected;
* UI receives the updated state;
* caches are revalidated where necessary.

## DELETE

Determine whether the entity requires:

* hard delete;
* soft delete;
* archive;
* deactivate.

Verify:

* authorization;
* referential integrity;
* confirmation UI;
* dependent-record handling;
* correct UI refresh;
* audit logging.

Never rely solely on hiding a button for authorization.

---

# 7. SERVER ACTION AUDIT

Inspect every server action and route handler.

For each operation verify:

1. authentication;
2. role/permission authorization;
3. input validation;
4. sanitization where relevant;
5. business-rule validation;
6. database operation;
7. RLS compatibility;
8. error handling;
9. safe error messages;
10. transaction/atomicity requirements;
11. cache invalidation/revalidation;
12. redirect/response behavior;
13. audit logging where required.

Server actions must never trust:

* role supplied by the client;
* user ID supplied by the client when identity can be obtained from the authenticated session;
* hidden form fields for authorization;
* client-side permission checks;
* URL parameters without server validation.

Derive identity and authorization from trusted server-side authentication state.

---

# 8. AUTHENTICATION AUDIT

Test the complete authentication lifecycle:

* registration, if supported;
* login;
* logout;
* session persistence;
* session refresh;
* expired sessions;
* protected routes;
* unauthenticated redirects;
* authenticated redirects;
* account status restrictions;
* password reset if implemented;
* middleware behavior.

Ensure browser, server, and middleware Supabase clients are used correctly for the project's architecture.

Never expose service-role credentials to the browser.

---

# 9. RBAC AND AUTHORIZATION

Create or verify a centralized authorization model.

Map:

ROLE
→ PERMISSIONS
→ ROUTES
→ ACTIONS
→ DATA ACCESS.

Check authorization at multiple layers where appropriate:

UI visibility
+
route protection
+
server-action authorization
+
database RLS.

UI restrictions are UX controls, not security controls.

A malicious user manually invoking a request or server action must still be denied.

Test every role against every sensitive action.

Test both positive and negative authorization cases.

---

# 10. SUPABASE RLS SECURITY AUDIT

Assume RLS is mandatory for sensitive application tables unless there is a documented architectural reason otherwise.

For every relevant table verify:

* RLS enabled;
* SELECT policy;
* INSERT policy;
* UPDATE policy;
* DELETE policy;
* ownership rules;
* organization/campus/tenant boundaries where applicable;
* role restrictions;
* administrative access rules;
* sensitive-data restrictions.

Explicitly test cross-user access.

Example:

User A must not be able to retrieve User B's protected record merely by changing a record ID in the URL or request.

Also test privilege escalation attempts.

A normal user must not be able to:

* modify their role;
* assign themselves privileges;
* access administrative records;
* invoke administrative mutations;
* bypass ownership restrictions.

Do not use the Supabase service-role key to bypass RLS for normal application operations.

Use elevated privileges only in narrowly controlled server-side operations where explicitly required.

---

# 11. DATABASE INTEGRITY

Audit:

* tables;
* columns;
* primary keys;
* foreign keys;
* unique constraints;
* CHECK constraints;
* indexes;
* timestamps;
* nullable fields;
* defaults;
* enums/status fields;
* cascade behavior;
* archival/soft-delete behavior.

Verify relationships used by the application actually correspond to the schema.

Check for:

* orphaned records;
* incorrect foreign keys;
* duplicated data;
* inconsistent status values;
* missing constraints;
* N+1 query problems;
* unsafe migrations.

Do not destroy production data.

Never reset or recreate the database simply to make development easier unless explicitly instructed.

---

# 12. BUSINESS WORKFLOW INTEGRATION

This is critically important.

Do not validate modules only in isolation.

Identify every major end-to-end workflow.

For each workflow test the complete lifecycle.

Example pattern:

Create record
→ record appears in correct queue
→ authorized user opens record
→ performs next action
→ status changes
→ related module receives updated information
→ dashboards update
→ notifications are generated
→ audit event is recorded
→ next responsible role can continue the process
→ final state is reflected throughout the application.

Connected modules must use consistent data and status definitions.

There must not be situations where one page says a record is "Completed" while another related module still treats it as "Pending."

---

# 13. STATE MACHINE / STATUS AUDIT

Identify entities with workflow statuses.

For each entity document internally:

Current State
→ Allowed Action
→ Authorized Role
→ Next State.

Prevent invalid transitions.

Example:

DRAFT
→ SUBMITTED
→ REVIEWED
→ APPROVED
→ COMPLETED

If direct DRAFT → COMPLETED is not allowed by the business rules, reject it server-side even if someone manually calls the endpoint.

---

# 14. DASHBOARD VALIDATION

Every role-specific dashboard must display data relevant to that role.

Verify:

* statistics come from actual database data;
* counts are accurate;
* cards link to correct filtered views;
* charts use correct datasets;
* recent activities are real;
* role restrictions are respected;
* dashboard actions route correctly;
* empty states work.

Do not retain hardcoded statistics or demonstration data unless explicitly marked as development fixtures.

---

# 15. FORM VALIDATION

Every mutation form must have appropriate validation.

Prefer shared validation schemas where feasible.

Validate server-side regardless of client validation.

Test:

* required fields;
* invalid types;
* length limits;
* malformed IDs;
* invalid dates;
* invalid enum/status values;
* duplicate records;
* business-rule conflicts;
* unauthorized relationships.

Return useful but safe error messages.

---

# 16. ERROR HANDLING

Implement coherent handling for:

* authentication failure;
* authorization failure;
* validation failure;
* record not found;
* database error;
* network failure;
* duplicate record;
* unexpected server failure.

Do not expose:

* stack traces;
* SQL;
* secrets;
* service keys;
* internal infrastructure information.

Provide appropriate user-facing feedback.

---

# 17. LOADING, EMPTY, AND SUCCESS STATES

Every data-driven page must account for:

LOADING
EMPTY
SUCCESS
ERROR.

Every mutation should provide appropriate feedback.

Prevent accidental duplicate submissions when necessary.

Use pending states for operations that take time.

---

# 18. NOTIFICATION INTEGRATION

If the application includes notifications, verify them as part of workflows rather than as an isolated module.

Check:

Event
→ notification creation
→ intended recipient
→ unread/read state
→ notification UI
→ navigation target.

A notification link must lead to the relevant authorized record.

Never leak protected information through notification content.

---

# 19. AUDIT TRAIL

For security-sensitive or important business operations, verify audit logging where required.

Capture appropriate information such as:

* actor;
* action;
* entity;
* entity ID;
* timestamp;
* relevant metadata.

Do not store secrets or unnecessary sensitive data in audit logs.

Audit records should not be casually editable by ordinary users.

---

# 20. UI/UX CONSISTENCY

Preserve the project's UI constitution/design system.

Ensure:

* consistent layout;
* global navigation;
* consistent sidebar behavior;
* consistent typography;
* consistent spacing;
* consistent forms;
* consistent buttons;
* consistent cards;
* consistent dialogs;
* consistent tables;
* responsive design;
* mobile-first behavior where required;
* accessibility fundamentals.

Do not redesign working interfaces unnecessarily.

Fix functionality before cosmetic refactoring.

---

# 21. TYPESCRIPT AND CODE QUALITY

Do not solve errors by weakening type safety.

Avoid introducing:

* unnecessary `any`;
* `@ts-ignore`;
* `@ts-nocheck`;
* disabled lint rules;
* unsafe type assertions.

Fix root causes.

Remove:

* unused imports;
* dead code;
* duplicate implementations;
* obsolete components;
* obsolete server actions;

only when you have verified they are not required.

Prefer reusable centralized implementations over duplicated business logic.

---

# 22. SECURITY REVIEW

Perform an application-level threat review.

Specifically check for:

* broken access control;
* IDOR/BOLA;
* privilege escalation;
* insecure direct database access;
* missing RLS;
* overly permissive RLS;
* mass assignment;
* unsafe redirects;
* injection;
* XSS;
* CSRF concerns relevant to the architecture;
* exposed secrets;
* sensitive-data leakage;
* insecure file uploads;
* unsafe storage policies;
* unauthorized object access;
* excessive data returned to clients.

Apply least privilege.

Security must be enforced server-side and at the database layer where appropriate.

---

# 23. ENVIRONMENT AND SECRET MANAGEMENT

Inspect environment-variable usage.

Ensure:

* public variables are intentionally public;
* server secrets remain server-only;
* Supabase service-role credentials are never bundled into client code;
* secrets are not hardcoded;
* secrets are not logged;
* `.env` files containing credentials are not committed;
* required environment variables are documented.

Never print secret values in reports.

---

# 24. FILE/STORAGE SECURITY

If Supabase Storage or uploads are used, verify:

* allowed file types;
* size limits;
* filename handling;
* ownership;
* storage bucket policies;
* download permissions;
* deletion permissions;
* signed/public URL strategy;
* unauthorized file enumeration.

Do not assume database RLS automatically protects Storage.

---

# 25. TESTING STRATEGY

Do not consider the task complete merely because:

`npm run build`

passes.

Use layered verification.

## Static Verification

Run the project's appropriate commands, such as:

* lint;
* TypeScript/typecheck;
* build.

Fix legitimate errors.

## Unit Tests

Test important:

* validation;
* authorization;
* business rules;
* status transitions;
* utilities.

## Integration Tests

Test:

Server Action/API
↔ Authentication
↔ Database
↔ Authorization/RLS.

## End-to-End Tests

Test critical workflows through the UI.

For each role, test realistic scenarios.

Also test negative scenarios:

* unauthorized route;
* unauthorized record;
* invalid ID;
* malformed request;
* duplicate submission;
* invalid transition;
* expired session;
* direct server-action invocation.

---

# 26. ROLE-BASED TEST MATRIX

Create an internal matrix similar to:

| Feature | Super Admin | Admin       | Staff       | Standard User | Guest |
| ------- | ----------- | ----------- | ----------- | ------------- | ----- |
| View    | ✓           | ✓           | ✓           | scoped        | ✗     |
| Create  | ✓           | ✓           | conditional | conditional   | ✗     |
| Edit    | ✓           | ✓           | scoped      | own only      | ✗     |
| Delete  | conditional | conditional | ✗           | ✗             | ✗     |

Adapt this to the actual application's roles.

Do not invent permissions.

Derive them from approved requirements and existing authoritative documentation.

Verify those permissions at the database and server levels, not just in the interface.

---

# 27. TRACEABILITY TEST

For every major requirement, prove internally that there is a complete implementation path:

Requirement
→ Route
→ UI
→ Action
→ Authorization
→ Database
→ RLS
→ Response
→ User Feedback
→ Test.

Any broken link in this chain means the requirement is NOT complete.

---

# 28. SEARCH FOR INCOMPLETE IMPLEMENTATION

Search the repository for indicators such as:

TODO
FIXME
HACK
PLACEHOLDER
COMING SOON
NOT IMPLEMENTED
mock
dummy
sample
temporary
console.log
throw new Error
disabled
href="#"

Review each occurrence.

Determine whether it represents unfinished functionality.

Do not blindly delete occurrences.

Implement or document them appropriately.

---

# 29. SAFE REFACTORING RULE

Do not perform large destructive rewrites merely because another architecture looks cleaner.

Prefer:

AUDIT
→ UNDERSTAND
→ REPAIR
→ INTEGRATE
→ TEST
→ REFACTOR ONLY WHERE JUSTIFIED.

Preserve working functionality.

Before changing shared infrastructure, determine what depends on it.

Pay special attention to:

* middleware;
* root layouts;
* authentication providers;
* Supabase clients;
* global navigation;
* server-action utilities;
* shared types;
* shared validation schemas.

A fix must not silently break unrelated modules.

---

# 30. DATABASE MIGRATION SAFETY

When schema changes are necessary:

1. inspect existing migrations;
2. inspect current schema expectations;
3. create an incremental migration;
4. preserve existing data;
5. add appropriate constraints/indexes;
6. update application types;
7. update RLS;
8. update affected queries/actions;
9. test the migration.

Do not rewrite migration history unnecessarily.

---

# 31. PRODUCTION BUILD VERIFICATION

Before completion run the project's production verification process.

At minimum verify:

* dependency installation;
* lint;
* type checking;
* tests;
* production build.

Resolve actual errors rather than suppressing them.

Confirm that production routes compile.

---

# 32. DEFINITION OF DONE

Do NOT state that the application is complete unless all applicable conditions below have been verified:

* [ ] documented features implemented
* [ ] required routes exist
* [ ] navigation works
* [ ] no unintended 404 routes
* [ ] buttons work
* [ ] forms work
* [ ] CRUD works
* [ ] server actions work
* [ ] database operations work
* [ ] authentication works
* [ ] RBAC works
* [ ] RLS works
* [ ] cross-user access is blocked
* [ ] privilege escalation is blocked
* [ ] workflows work end-to-end
* [ ] status transitions are valid
* [ ] dashboards use real data
* [ ] notifications work where required
* [ ] audit trails work where required
* [ ] validation works
* [ ] errors are handled
* [ ] loading states work
* [ ] empty states work
* [ ] responsive/mobile layouts work
* [ ] no exposed secrets
* [ ] TypeScript passes
* [ ] lint passes
* [ ] automated tests pass
* [ ] production build passes
* [ ] critical workflows have been manually or automatically verified

An unchecked item must be reported as unresolved rather than silently ignored.

---

# 33. EXECUTION STRATEGY

Execute the work in controlled phases.

### Phase 1 — Discovery

Understand architecture, requirements, schema, roles, routes, workflows, and security model.

### Phase 2 — Gap Analysis

Create the requirement/implementation and role/permission matrices.

### Phase 3 — Architecture and Security Repair

Fix foundational problems involving authentication, authorization, RLS, schema, shared services, and routing before individual UI defects.

### Phase 4 — Feature Completion

Complete missing pages, forms, actions, CRUD operations, and integrations.

### Phase 5 — Workflow Integration

Verify interconnected modules and complete end-to-end business processes.

### Phase 6 — Security Validation

Test RBAC, RLS, IDOR, privilege escalation, sensitive-data access, and storage security.

### Phase 7 — UI Integration

Resolve broken navigation, buttons, feedback states, responsive behavior, and consistency problems.

### Phase 8 — Automated Testing

Run unit, integration, authorization, and E2E tests.

### Phase 9 — Production Verification

Run lint, typecheck, tests, and production build.

### Phase 10 — Final Audit

Repeat the original requirements-to-implementation audit and identify anything still unresolved.

Do not stop after generating an audit report if you have permission and capability to modify the repository.

Proceed to implement and test the necessary corrections.

---

# 34. AUTONOMOUS PROBLEM-SOLVING

When you encounter an error:

1. inspect the error;
2. identify its root cause;
3. inspect dependent code;
4. implement the safest correction;
5. rerun the relevant test;
6. check for regressions;
7. continue.

Do not repeatedly ask for confirmation for ordinary implementation decisions that are clearly implied by the approved requirements.

Ask for clarification only when:

* requirements genuinely conflict;
* a destructive operation would be required;
* required credentials/external services are unavailable;
* the intended business rule cannot reasonably be determined.

Do not fabricate credentials, APIs, database records, or requirements.

---

# 35. FINAL REPORT

When implementation is finished, provide a concise but comprehensive report containing:

## A. Application Status

Overall implementation status.

## B. Changes Made

Group by:

* frontend;
* routing;
* server actions;
* database;
* authentication;
* RBAC;
* RLS/security;
* workflows;
* notifications;
* audit logging;
* tests.

## C. Requirements Verification

Report:

* completed;
* partially completed;
* unresolved.

## D. Security Verification

Report what was actually tested for:

* authentication;
* authorization;
* RLS;
* cross-user access;
* privilege escalation;
* sensitive-data protection.

## E. Testing Results

Report the actual result of:

* lint;
* typecheck;
* unit tests;
* integration tests;
* E2E tests;
* production build.

Do not claim tests passed unless they were actually executed.

## F. Remaining Issues

List every known unresolved problem.

Do not hide failures.

## G. Production Readiness

State which technical checks have been completed and which remain outstanding.

---

# FINAL DIRECTIVE

The goal is not:

> "Make the application look finished."

The goal is:

> **Make the application function as a coherent, secure, integrated system in which the UI, routes, authentication, authorization, RBAC, database, RLS policies, server actions, CRUD operations, business workflows, notifications, audit trails, and role-specific experiences work together correctly from end to end.**

Do not optimize for the smallest number of code changes.

Do not optimize for merely passing the build.

Optimize for:

**correctness + security + data integrity + workflow coherence + maintainability + verifiable end-to-end functionality.**

Continue auditing, implementing, testing, and correcting until the Definition of Done has been satisfied or a genuine external blocker prevents further progress.
