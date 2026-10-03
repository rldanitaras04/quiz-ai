/**
 * End-to-end test for the scheduled-maintenance sweep
 * (migration 20261006000000 — run_scheduled_maintenance).
 *
 * Exercises the REAL database through the service-role client (no server
 * build): fixtures whose time windows are already due are handed to the
 * sweep, which must
 *   1. activate a scheduled deployment whose opening time has passed;
 *   2. close deployments whose window has ended (and never activate one
 *      whose window already ended — the reminder fixture doubles as that
 *      guard);
 *   3. release results for score_release_mode = 'after_close' once the
 *      window ends, and for 'scheduled' once score_release_at passes;
 *   4. send exactly one notification per transition, to enrolled students;
 *   5. send exactly one "opening soon" reminder (reminder_sent_at dedup);
 *   6. write an audit row for the pass;
 *   7. do NONE of it a second time (idempotency).
 *
 * Race tolerance: pg_cron may run the same sweep between fixture creation
 * and the explicit calls below. Because every step flips the very predicate
 * it selects on, that only moves who performs the transition — the counts
 * asserted here stay the same.
 *
 * Run:  node --env-file=.env.local scripts/e2e-sweep.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    'Missing Supabase env vars. Run: node --env-file=.env.local scripts/e2e-sweep.mjs'
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TAG = `e2e-sweep-${Date.now()}`;
const PASSWORD = 'E2e-Sweep-Pass!123';
const startedAt = new Date().toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;

const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const created = { users: [], ids: {} };

async function createUser(label) {
  const email = `${label}-${TAG}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${label}): ${error.message}`);
  created.users.push(data.user.id);
  const { error: profileError } = await admin
    .from('profiles')
    .insert({ id: data.user.id, email, full_name: `E2E ${label}` });
  if (profileError) throw new Error(`profiles insert: ${profileError.message}`);
  return { id: data.user.id, email };
}

async function insertReturning(table, values, idKey = 'id') {
  const { data, error } = await admin.from(table).insert(values).select(idKey).single();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data[idKey];
}

async function sweep() {
  const { data, error } = await admin.rpc('run_scheduled_maintenance');
  if (error) throw new Error(`sweep: ${error.message} (${error.code ?? 'no code'})`);
  return data;
}

async function getRow(table, id, columns = '*') {
  const { data, error } = await admin.from(table).select(columns).eq('id', id).single();
  if (error) throw new Error(`${table} read: ${error.message}`);
  return data;
}

async function studentNotifications() {
  const { data, error } = await admin
    .from('notifications')
    .select('id, type, data')
    .eq('user_id', created.student.id);
  if (error) throw new Error(`notifications read: ${error.message}`);
  return data ?? [];
}

const countNotes = (notes, type, deploymentId) =>
  notes.filter((n) => n.type === type && n.data?.deployment_id === deploymentId).length;

// ---------------------------------------------------------------------------
// Fixtures: shared offering + assessment, then five deployments whose windows
// are shaped so exactly one sweep step applies to each.
// ---------------------------------------------------------------------------

async function createFixtures() {
  const [student, faculty] = await Promise.all([
    createUser('student'),
    createUser('faculty'),
  ]);
  created.student = student;
  created.faculty = faculty;

  const { error: facultyProfileError } = await admin
    .from('faculty_profiles')
    .insert({ user_id: faculty.id, employee_number: `E2E-${TAG.slice(-8)}` });
  if (facultyProfileError) {
    throw new Error(`faculty_profiles insert: ${facultyProfileError.message}`);
  }

  const ids = created.ids;
  ids.academicYear = await insertReturning('academic_years', {
    name: `E2E AY ${TAG}`,
    starts_on: '2026-01-01',
    ends_on: '2026-12-31',
  });
  ids.semester = await insertReturning('semesters', {
    academic_year_id: ids.academicYear,
    name: `E2E Sem ${TAG}`,
    starts_on: '2026-01-01',
    ends_on: '2026-06-30',
  });
  ids.program = await insertReturning('programs', {
    code: `E2E${TAG.slice(-10).replace(/-/g, '')}`.slice(0, 16),
    name: `E2E Program ${TAG}`,
  });
  ids.yearLevel = await insertReturning('year_levels', {
    name: `E2E Year ${TAG}`,
    sort_order: 99,
  });
  ids.section = await insertReturning('sections', {
    program_id: ids.program,
    year_level_id: ids.yearLevel,
    name: `E2E Section ${TAG}`,
  });
  ids.subject = await insertReturning('subjects', {
    code: `E2E${TAG.slice(-9).replace(/-/g, '')}`,
    title: `E2E Subject ${TAG}`,
  });
  ids.offering = await insertReturning('subject_offerings', {
    subject_id: ids.subject,
    semester_id: ids.semester,
    program_id: ids.program,
    year_level_id: ids.yearLevel,
    section_id: ids.section,
  });
  ids.facultyAssignment = await insertReturning('faculty_assignments', {
    subject_offering_id: ids.offering,
    faculty_id: faculty.id,
  });
  const { error: studentProfileError } = await admin
    .from('student_profiles')
    .insert({
      user_id: student.id,
      student_number: `E2E-${TAG.slice(-8)}`,
      program_id: ids.program,
      year_level_id: ids.yearLevel,
      section_id: ids.section,
      verification_status: 'verified',
    });
  if (studentProfileError) {
    throw new Error(`student_profiles insert: ${studentProfileError.message}`);
  }
  ids.enrollment = await insertReturning('enrollments', {
    subject_offering_id: ids.offering,
    student_id: student.id,
    status: 'enrolled',
  });

  ids.assessment = await insertReturning('assessments', {
    subject_offering_id: ids.offering,
    title: `E2E Assessment ${TAG}`,
    status: 'published',
    created_by: faculty.id,
  });
  ids.version = await insertReturning('assessment_versions', {
    assessment_id: ids.assessment,
    version_number: 1,
    status: 'published',
    total_items: 0,
    total_points: 0,
  });

  const base = {
    assessment_id: ids.assessment,
    assessment_version_id: ids.version,
    subject_offering_id: ids.offering,
    duration_minutes: 60,
    attempt_limit: 1,
    question_order_mode: 'fixed',
    choice_order_mode: 'fixed',
    created_by: faculty.id,
    security_mode: 'enhanced',
    require_fullscreen: true,
    security_response_mode: 'record',
  };

  // (a) Due to open: opening time passed, window still running.
  ids.depActivate = await insertReturning('assessment_deployments', {
    ...base,
    opens_at: new Date(Date.now() - MIN).toISOString(),
    closes_at: new Date(Date.now() + HOUR).toISOString(),
    score_release_mode: 'manual_release',
    status: 'scheduled',
  });

  // (b) Due to close: window already over.
  ids.depClose = await insertReturning('assessment_deployments', {
    ...base,
    opens_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    closes_at: new Date(Date.now() - MIN).toISOString(),
    score_release_mode: 'manual_release',
    status: 'active',
  });

  // (c) after_close release: window over, result pending.
  ids.depAfterClose = await insertReturning('assessment_deployments', {
    ...base,
    opens_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    closes_at: new Date(Date.now() - MIN).toISOString(),
    score_release_mode: 'after_close',
    status: 'active',
  });

  // (d) scheduled release: window still open, release instant passed.
  ids.depScheduled = await insertReturning('assessment_deployments', {
    ...base,
    opens_at: new Date(Date.now() - 30 * MIN).toISOString(),
    closes_at: new Date(Date.now() + HOUR).toISOString(),
    score_release_mode: 'scheduled',
    score_release_at: new Date(Date.now() - MIN).toISOString(),
    status: 'active',
  });

  // (e) Reminder due: opens in 30 minutes, created two hours ago (a
  // deployment created inside its own reminder window is skipped). Must NOT
  // be activated or closed by the sweep.
  ids.depReminder = await insertReturning('assessment_deployments', {
    ...base,
    opens_at: new Date(Date.now() + 30 * MIN).toISOString(),
    closes_at: new Date(Date.now() + 3 * HOUR).toISOString(),
    score_release_mode: 'manual_release',
    status: 'scheduled',
    created_at: new Date(Date.now() - 2 * HOUR).toISOString(),
  });

  // Pending results for the two release modes.
  ids.attemptAfterClose = await insertReturning('exam_attempts', {
    deployment_id: ids.depAfterClose,
    student_id: student.id,
    attempt_number: 1,
    status: 'submitted',
    started_at: new Date(Date.now() - 90 * MIN).toISOString(),
    expires_at: new Date(Date.now() - 30 * MIN).toISOString(),
    assessment_version_id: ids.version,
  });
  ids.resultAfterClose = await insertReturning('assessment_results', {
    attempt_id: ids.attemptAfterClose,
    student_id: student.id,
    deployment_id: ids.depAfterClose,
    raw_score: 1,
    possible_score: 2,
    status: 'pending',
  });

  ids.attemptScheduled = await insertReturning('exam_attempts', {
    deployment_id: ids.depScheduled,
    student_id: student.id,
    attempt_number: 1,
    status: 'submitted',
    started_at: new Date(Date.now() - 20 * MIN).toISOString(),
    expires_at: new Date(Date.now() + 40 * MIN).toISOString(),
    assessment_version_id: ids.version,
  });
  ids.resultScheduled = await insertReturning('assessment_results', {
    attempt_id: ids.attemptScheduled,
    student_id: student.id,
    deployment_id: ids.depScheduled,
    raw_score: 2,
    possible_score: 2,
    status: 'pending',
  });

  check(
    'fixtures created (offering, enrollment, 5 deployments, 2 pending results)',
    Boolean(
      ids.depActivate &&
        ids.depClose &&
        ids.depAfterClose &&
        ids.depScheduled &&
        ids.depReminder &&
        ids.resultAfterClose &&
        ids.resultScheduled
    )
  );
}

// ---------------------------------------------------------------------------
// The sweep itself
// ---------------------------------------------------------------------------

async function testSweep() {
  const { ids } = created;

  await sweep();

  // 1. Activation.
  const depActivate = await getRow('assessment_deployments', ids.depActivate, 'status, updated_at');
  check(
    'scheduled deployment activates when its opening time passes',
    depActivate.status === 'active',
    `status=${depActivate.status}`
  );

  // 2. Closes.
  const depClose = await getRow('assessment_deployments', ids.depClose, 'status');
  check(
    'deployment closes when its window ends',
    depClose.status === 'closed',
    `status=${depClose.status}`
  );
  // Scope §32 faculty event: the close transition notifies every faculty
  // member assigned to the offering (trigger in 20261013000000), once.
  const { data: facultyClosedNotes } = await admin
    .from('notifications')
    .select('id, body')
    .eq('user_id', created.faculty.id)
    .eq('type', 'assessment_closed')
    .contains('data', { deployment_id: ids.depClose });
  check(
    'faculty of the offering is notified once when their exam closes',
    (facultyClosedNotes ?? []).length === 1 &&
      /submitted/i.test(facultyClosedNotes?.[0]?.body ?? ''),
    `count=${facultyClosedNotes?.length ?? 0} body=${facultyClosedNotes?.[0]?.body?.slice(0, 60)}`
  );
  const depAfterCloseRow = await getRow('assessment_deployments', ids.depAfterClose, 'status');
  check(
    'release-mode deployment also closes',
    depAfterCloseRow.status === 'closed',
    `status=${depAfterCloseRow.status}`
  );

  // 3. Releases.
  const resultAfterClose = await getRow('assessment_results', ids.resultAfterClose, 'status, released_at, released_by');
  check(
    "after_close result releases once the window ends",
    resultAfterClose.status === 'released' &&
      Boolean(resultAfterClose.released_at) &&
      resultAfterClose.released_by === null,
    `status=${resultAfterClose.status}, released_by=${resultAfterClose.released_by}`
  );
  const resultScheduled = await getRow('assessment_results', ids.resultScheduled, 'status, released_at');
  check(
    'scheduled result releases once score_release_at passes',
    resultScheduled.status === 'released' && Boolean(resultScheduled.released_at),
    `status=${resultScheduled.status}`
  );

  // 4. Reminder fires without activating or closing the deployment.
  const depReminder = await getRow('assessment_deployments', ids.depReminder, 'status, reminder_sent_at');
  check(
    'opening-soon reminder is sent exactly at the hour before',
    Boolean(depReminder.reminder_sent_at),
    `reminder_sent_at=${depReminder.reminder_sent_at}`
  );
  check(
    'a deployment opening later stays scheduled (no premature activation)',
    depReminder.status === 'scheduled',
    `status=${depReminder.status}`
  );

  // 5. Notifications: one per transition, for the enrolled student only.
  const notes = await studentNotifications();
  const expectations = [
    ['assessment_opened', ids.depActivate, 1],
    ['assessment_closed', ids.depClose, 1],
    ['assessment_closed', ids.depAfterClose, 1],
    ['result_released', ids.depAfterClose, 1],
    ['result_released', ids.depScheduled, 1],
    ['reminder', ids.depReminder, 1],
  ];
  for (const [type, deploymentId, expected] of expectations) {
    const actual = countNotes(notes, type, deploymentId);
    check(
      `one "${type}" notification for ${type.startsWith('result') ? 'the released result' : 'the fixture'}`,
      actual === expected,
      `expected ${expected}, got ${actual}`
    );
  }
  const releasedNote = notes.find(
    (n) => n.type === 'result_released' && n.data?.deployment_id === ids.depScheduled
  );
  check(
    'result_released notification names the attempt',
    releasedNote?.data?.attempt_id === ids.attemptScheduled,
    `attempt_id=${releasedNote?.data?.attempt_id ?? 'missing'}`
  );

  // 6. Audit row for the pass.
  const { data: auditRows, error: auditError } = await admin
    .from('audit_logs')
    .select('id, metadata')
    .eq('entity_type', 'scheduled_maintenance')
    .gte('created_at', startedAt);
  if (auditError) throw new Error(`audit_logs read: ${auditError.message}`);
  check(
    'the pass writes an audit row',
    (auditRows ?? []).length >= 1,
    `${(auditRows ?? []).length} row(s)`
  );

  // 7. Idempotency: a second pass changes nothing and notifies no one.
  const before = new Set((await studentNotifications()).map((n) => n.id));
  await sweep();
  const after = await studentNotifications();
  const newNotes = after.filter((n) => !before.has(n.id));
  check('second pass sends no new notifications', newNotes.length === 0, `${newNotes.length} new`);

  const reminderAfter = await getRow('assessment_deployments', ids.depReminder, 'status, reminder_sent_at');
  check(
    'second pass does not re-fire the reminder',
    reminderAfter.reminder_sent_at === depReminder.reminder_sent_at,
    'reminder_sent_at unchanged'
  );
  const releasedAgain = await getRow('assessment_results', ids.resultScheduled, 'status, released_at');
  check(
    'second pass leaves released results alone',
    releasedAgain.status === 'released',
    `status=${releasedAgain.status}`
  );
}

// ---------------------------------------------------------------------------
// Generation-job state machine (WP-4): the stall reaper
// ---------------------------------------------------------------------------

async function testJobStallReap() {
  const { ids } = created;
  const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const staleQueued = await insertReturning('assessment_generation_jobs', {
    assessment_id: ids.assessment,
    requested_by: created.faculty.id,
    operation: 'generate_questions',
    status: 'queued',
    updated_at: stale,
  });
  const staleProcessing = await insertReturning('assessment_generation_jobs', {
    assessment_id: ids.assessment,
    requested_by: created.faculty.id,
    operation: 'generate_questions',
    status: 'processing',
    updated_at: stale,
  });
  const freshProcessing = await insertReturning('assessment_generation_jobs', {
    assessment_id: ids.assessment,
    requested_by: created.faculty.id,
    operation: 'generate_questions',
    status: 'processing',
  });

  // A healthy batch re-runs the route's processing update per question, so
  // only a dead client leaves a row this old. pg_cron may also have reaped
  // the fixtures already (it runs every minute when available) — the
  // per-row assertions below hold either way.
  const { data: reaped, error } = await admin.rpc('fail_stalled_generation_jobs');
  if (error) throw new Error(`fail_stalled_generation_jobs: ${error.message}`);
  check('stall reaper runs and reports a count', typeof reaped === 'number', `failed=${reaped}`);

  const q = await getRow('assessment_generation_jobs', staleQueued, 'status, error_message');
  check(
    'stale queued job is reaped as failed with a stall reason',
    q.status === 'failed' && /15 minutes/.test(q.error_message ?? ''),
    `status=${q.status} err=${(q.error_message ?? '').slice(0, 60)}`
  );

  const p = await getRow('assessment_generation_jobs', staleProcessing, 'status, error_message');
  check(
    'stale processing job is reaped as failed',
    p.status === 'failed' && /15 minutes/.test(p.error_message ?? ''),
    `status=${p.status} err=${(p.error_message ?? '').slice(0, 60)}`
  );

  const fresh = await getRow('assessment_generation_jobs', freshProcessing, 'status');
  check(
    'a fresh in-flight job is left untouched',
    fresh.status === 'processing',
    `status=${fresh.status}`
  );

  const { data: second } = await admin.rpc('fail_stalled_generation_jobs');
  check(
    'reaping is idempotent (second run finds nothing)',
    second === 0,
    `failed=${second}`
  );

  await admin
    .from('assessment_generation_jobs')
    .delete()
    .in('id', [staleQueued, staleProcessing, freshProcessing]);
}

// ---------------------------------------------------------------------------

async function cleanup() {
  const { ids } = created;
  await admin.from('assessment_results').delete().eq('deployment_id', ids.depAfterClose ?? '');
  await admin.from('assessment_results').delete().eq('deployment_id', ids.depScheduled ?? '');
  await admin.from('exam_attempts').delete().eq('deployment_id', ids.depAfterClose ?? '');
  await admin.from('exam_attempts').delete().eq('deployment_id', ids.depScheduled ?? '');
  await admin.from('assessment_deployments').delete().eq('assessment_id', ids.assessment ?? '');
  await admin.from('assessments').delete().eq('id', ids.assessment ?? '');
  await admin.from('assessment_versions').delete().eq('id', ids.version ?? '');
  await admin.from('enrollments').delete().eq('id', ids.enrollment ?? '');
  await admin.from('faculty_assignments').delete().eq('id', ids.facultyAssignment ?? '');
  await admin.from('subject_offerings').delete().eq('id', ids.offering ?? '');
  await admin.from('subjects').delete().eq('id', ids.subject ?? '');
  await admin.from('sections').delete().eq('id', ids.section ?? '');
  await admin.from('year_levels').delete().eq('id', ids.yearLevel ?? '');
  await admin.from('programs').delete().eq('id', ids.program ?? '');
  await admin.from('semesters').delete().eq('id', ids.semester ?? '');
  await admin.from('academic_years').delete().eq('id', ids.academicYear ?? '');

  // Audit rows this run produced (sweep summaries carry no fixture ids). On a
  // dev database the window also covers any pg_cron pass that fired during
  // the test — acceptable for a log of aggregate counts.
  await admin
    .from('audit_logs')
    .delete()
    .eq('entity_type', 'scheduled_maintenance')
    .gte('created_at', startedAt);

  // Deleting the profiles cascades notifications, enrollments and profiles.
  for (const userId of created.users) {
    await admin.from('student_profiles').delete().eq('user_id', userId);
    await admin.from('faculty_profiles').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('id', userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`cleanup user ${userId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------

let exitCode = 0;
try {
  await createFixtures();
  await testSweep();
  await testJobStallReap();
} catch (err) {
  exitCode = 1;
  console.error('\nRUN ERROR:', err);
  check('run completed without exceptions', false, String(err?.message ?? err));
} finally {
  try {
    await cleanup();
    check('cleanup removed all fixtures', true);
  } catch (err) {
    console.error('Cleanup error:', err);
    check('cleanup removed all fixtures', false, String(err?.message ?? err));
  }
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
if (failures > 0) exitCode = 1;
process.exit(exitCode);
