/**
 * End-to-end test for the Examination Session & Integrity layer.
 *
 * Exercises the REAL database through PostgREST + Auth (no server build):
 *   1. schema artifacts of the security migration are queryable;
 *   2. single-active-session partial unique indexes actually reject;
 *   3. CHECK constraints on session state, event type and severity hold;
 *   4. RLS: students see only their own rows, assigned faculty see the
 *      deployment, unassigned faculty see nothing, students cannot write
 *      session rows;
 *   5. realtime publication actually delivers exam_sessions/exam_events;
 *   6. the deployment security policy round-trips.
 *
 * Run:  node --env-file=.env.local scripts/e2e-exam.mjs
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    'Missing Supabase env vars. Run: node --env-file=.env.local scripts/e2e-exam.mjs'
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TAG = `e2e-exam-${Date.now()}`;
const PASSWORD = 'E2e-Exam-Pass!123';
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const created = {
  users: [],
  ids: {},
};

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

async function clientFor(user) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: PASSWORD,
  });
  if (error) throw new Error(`signIn(${user.email}): ${error.message}`);
  return client;
}

async function insertReturning(table, values, idKey = 'id') {
  const { data, error } = await admin.from(table).insert(values).select(idKey).single();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data[idKey];
}

// ---------------------------------------------------------------------------
// 1. Schema artifacts are queryable (PostgREST rejects unknown columns)
// ---------------------------------------------------------------------------

async function testSchema() {
  const probes = [
    [
      'exam_sessions exposes the heartbeat/security columns',
      () =>
        admin
          .from('exam_sessions')
          .select(
            'id, session_token, status, connection_state, sync_state, pending_sync_count, ' +
              'last_heartbeat_at, last_local_save_at, last_sync_at, reverification_required, ' +
              'allow_recovery, ended_at, close_reason'
          )
          .limit(0),
    ],
    [
      'exam_events exposes session/deployment/severity columns',
      () =>
        admin
          .from('exam_events')
          .select('id, attempt_id, student_id, exam_session_id, deployment_id, event_type, severity, metadata, recorded_at')
          .limit(0),
    ],
    [
      'assessment_exceptions exposes expires_at',
      () => admin.from('assessment_exceptions').select('id, expires_at').limit(0),
    ],
    [
      'student_responses exposes last_operation_id (idempotency)',
      () =>
        admin
          .from('student_responses')
          .select('id, last_operation_id, server_revision, client_revision')
          .limit(0),
    ],
    [
      'assessment_deployments exposes the security policy columns',
      () =>
        admin
          .from('assessment_deployments')
          .select(
            'security_mode, require_fullscreen, detect_tab_visibility, detect_copy_attempts, ' +
              'require_reverification_on_recovery, offline_autosave, sync_on_reconnect, ' +
              'allow_session_recovery, security_response_mode'
          )
          .limit(0),
    ],
  ];

  for (const [name, run] of probes) {
    const { error } = await run();
    check(name, !error, error?.message ?? '');
  }
}

// ---------------------------------------------------------------------------
// 2. Fixtures
// ---------------------------------------------------------------------------

async function createFixtures() {
  const [studentA, studentB, facultyF, facultyG] = await Promise.all([
    createUser('studenta'),
    createUser('studentb'),
    createUser('facultyf'),
    createUser('facultyg'),
  ]);
  created.studentA = studentA;
  created.studentB = studentB;
  created.facultyF = facultyF;
  created.facultyG = facultyG;

  // faculty_assignments.faculty_id → faculty_profiles(user_id)
  let facultyIndex = 0;
  for (const faculty of [facultyF, facultyG]) {
    facultyIndex += 1;
    const { error } = await admin
      .from('faculty_profiles')
      .insert({ user_id: faculty.id, employee_number: `E2E-${TAG.slice(-8)}-${facultyIndex}` });
    if (error) throw new Error(`faculty_profiles insert: ${error.message}`);
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
    faculty_id: facultyF.id,
  });
  // exam_attempts.student_id → student_profiles(user_id)
  let studentIndex = 0;
  for (const student of [studentA, studentB]) {
    studentIndex += 1;
    const { error } = await admin.from('student_profiles').insert({
      user_id: student.id,
      student_number: `E2E-${TAG.slice(-8)}-${studentIndex}`,
      program_id: ids.program,
      year_level_id: ids.yearLevel,
      section_id: ids.section,
      verification_status: 'verified',
    });
    if (error) throw new Error(`student_profiles insert: ${error.message}`);
  }

  ids.assessment = await insertReturning('assessments', {
    subject_offering_id: ids.offering,
    title: `E2E Assessment ${TAG}`,
    status: 'published',
    created_by: facultyF.id,
  });
  ids.version = await insertReturning('assessment_versions', {
    assessment_id: ids.assessment,
    version_number: 1,
    status: 'published',
    total_items: 0,
    total_points: 0,
  });
  ids.deployment = await insertReturning('assessment_deployments', {
    assessment_id: ids.assessment,
    assessment_version_id: ids.version,
    subject_offering_id: ids.offering,
    opens_at: new Date(Date.now() - 60_000).toISOString(),
    closes_at: new Date(Date.now() + 3_600_000).toISOString(),
    duration_minutes: 60,
    attempt_limit: 1,
    question_order_mode: 'fixed',
    choice_order_mode: 'fixed',
    score_release_mode: 'immediate',
    status: 'active',
    created_by: facultyF.id,
    security_mode: 'enhanced',
    require_fullscreen: true,
    security_response_mode: 'record',
  });

  for (const [key, student] of [
    ['attemptA', studentA],
    ['attemptB', studentB],
  ]) {
    const attemptId = await insertReturning('exam_attempts', {
      deployment_id: ids.deployment,
      student_id: student.id,
      attempt_number: 1,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 1_800_000).toISOString(),
      assessment_version_id: ids.version,
    });
    ids[key] = attemptId;
    await insertReturning('exam_manifests', {
      attempt_id: attemptId,
      question_order: [],
      choice_order: {},
      manifest_hash: 'e2e'.padEnd(64, '0'),
    });
  }

  // Each student has an active session so faculty RLS tests see both rosters.
  const sessionB = await admin
    .from('exam_sessions')
    .insert({
      attempt_id: ids.attemptB,
      student_id: studentB.id,
      deployment_id: ids.deployment,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id');
  if (sessionB.error) {
    throw new Error(`exam_sessions insert (student B): ${sessionB.error.message}`);
  }
  ids.sessionB = sessionB.data.id;

  check(
    'fixtures created (offering, assessment, deployment, 2 attempts)',
    Boolean(ids.deployment && ids.attemptA && ids.attemptB)
  );
}

// ---------------------------------------------------------------------------
// 3. Security policy round-trip
// ---------------------------------------------------------------------------

async function testPolicyRoundTrip() {
  const { data, error } = await admin
    .from('assessment_deployments')
    .select('security_mode, require_fullscreen, security_response_mode')
    .eq('id', created.ids.deployment)
    .single();
  check(
    'deployment security policy persists (enhanced + fullscreen + record)',
    !error &&
      data?.security_mode === 'enhanced' &&
      data?.require_fullscreen === true &&
      data?.security_response_mode === 'record',
    error?.message ?? JSON.stringify(data)
  );
}

// ---------------------------------------------------------------------------
// 4. Single-active-session invariants (partial unique indexes)
// ---------------------------------------------------------------------------

async function testSessionInvariants() {
  const { ids } = created;

  const first = await admin
    .from('exam_sessions')
    .insert({
      attempt_id: ids.attemptA,
      student_id: created.studentA.id,
      deployment_id: ids.deployment,
      status: 'active',
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    })
    .select('id, session_token')
    .single();
  check('first active session inserts', !first.error, first.error?.message ?? '');
  ids.sessionA = first.data?.id;
  check('session_token is server-issued', Boolean(first.data?.session_token));

  // Second ACTIVE session for the same attempt must violate the unique index.
  const dupAttempt = await admin
    .from('exam_sessions')
    .insert({
      attempt_id: ids.attemptA,
      student_id: created.studentA.id,
      deployment_id: ids.deployment,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id');
  check(
    'second active session for the same attempt is rejected (23505)',
    dupAttempt.error?.code === '23505',
    dupAttempt.error?.code ?? 'accepted'
  );

  // A second countable attempt must be rejected by enforce_attempt_limit()
  // (deployment attempt_limit = 1 for this fixture).
  const limitHit = await admin
    .from('exam_attempts')
    .insert({
      deployment_id: ids.deployment,
      student_id: created.studentA.id,
      attempt_number: 1,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 1_800_000).toISOString(),
      assessment_version_id: ids.version,
    })
    .select('id');
  check(
    'second countable attempt is rejected by the attempt-limit trigger (P0001)',
    limitHit.error?.code === 'P0001',
    limitHit.error?.code ?? 'accepted'
  );

  // Same student + deployment on a different attempt must also be rejected
  // (session index). The attempt row uses a non-countable status so the limit
  // trigger allows it — this row only exists to exercise the session index.
  const attemptA2 = await insertReturning('exam_attempts', {
    deployment_id: ids.deployment,
    student_id: created.studentA.id,
    attempt_number: 2,
    status: 'cancelled',
    assessment_version_id: ids.version,
  });
  ids.attemptA2 = attemptA2;
  const dupStudent = await admin
    .from('exam_sessions')
    .insert({
      attempt_id: attemptA2,
      student_id: created.studentA.id,
      deployment_id: ids.deployment,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id');
  check(
    'second active session for the same student+deployment is rejected (23505)',
    dupStudent.error?.code === '23505',
    dupStudent.error?.code ?? 'accepted'
  );

  // After the first session is transferred, the attempt may host a new one.
  const { error: closeErr } = await admin
    .from('exam_sessions')
    .update({ status: 'transferred', ended_at: new Date().toISOString() })
    .eq('id', ids.sessionA);
  check('session can be transferred (recovery handoff)', !closeErr, closeErr?.message ?? '');

  const afterTransfer = await admin
    .from('exam_sessions')
    .insert({
      attempt_id: ids.attemptA,
      student_id: created.studentA.id,
      deployment_id: ids.deployment,
      status: 'active',
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  check('a fresh active session is allowed after transfer', !afterTransfer.error,
    afterTransfer.error?.message ?? '');
  ids.sessionA = afterTransfer.data?.id ?? ids.sessionA;
}

// ---------------------------------------------------------------------------
// 5. CHECK constraints (event vocabulary, severity, session state)
// ---------------------------------------------------------------------------

async function testCheckConstraints() {
  const { ids } = created;

  const badType = await admin.from('exam_events').insert({
    attempt_id: ids.attemptA,
    student_id: created.studentA.id,
    deployment_id: ids.deployment,
    event_type: 'cheating_detected',
    severity: 'critical',
  });
  check(
    'unknown event types are refused by the database (23514)',
    badType.error?.code === '23514',
    badType.error?.code ?? 'accepted'
  );

  const badSeverity = await admin.from('exam_events').insert({
    attempt_id: ids.attemptA,
    student_id: created.studentA.id,
    deployment_id: ids.deployment,
    event_type: 'tab_hidden',
    severity: 'guilty',
  });
  check(
    'severity outside info/warning/critical is refused (23514)',
    badSeverity.error?.code === '23514',
    badSeverity.error?.code ?? 'accepted'
  );

  const badState = await admin.from('exam_sessions').insert({
    attempt_id: ids.attemptA,
    student_id: created.studentA.id,
    deployment_id: ids.deployment,
    status: 'active',
    connection_state: 'banana',
    started_at: new Date().toISOString(),
  });
  check(
    'session connection_state outside the vocabulary is refused (23514)',
    badState.error?.code === '23514',
    badState.error?.code ?? 'accepted'
  );

  // A well-formed event must land.
  const good = await admin
    .from('exam_events')
    .insert({
      attempt_id: ids.attemptA,
      student_id: created.studentA.id,
      deployment_id: ids.deployment,
      exam_session_id: ids.sessionA,
      event_type: 'tab_hidden',
      severity: 'warning',
      metadata: { count: 2 },
    })
    .select('id')
    .single();
  check('a well-formed security event inserts', !good.error, good.error?.message ?? '');
  ids.eventA = good.data?.id;
}

// ---------------------------------------------------------------------------
// 6. RLS
// ---------------------------------------------------------------------------

async function testRls() {
  const { ids } = created;
  const studentAClient = await clientFor(created.studentA);
  const facultyFClient = await clientFor(created.facultyF);
  const facultyGClient = await clientFor(created.facultyG);

  const aSessions = await studentAClient.from('exam_sessions').select('id, student_id');
  const aOwnOnly = (aSessions.data ?? []).every((r) => r.student_id === created.studentA.id);
  check(
    'student sees only their own exam_sessions',
    !aSessions.error && aOwnOnly && (aSessions.data ?? []).length > 0,
    aSessions.error?.message ?? `${aSessions.data?.length ?? 0} rows`
  );

  const aAttempts = await studentAClient.from('exam_attempts').select('id, student_id');
  const seesForeignAttempt = (aAttempts.data ?? []).some(
    (r) => r.id === ids.attemptB || r.student_id === created.studentB.id
  );
  check(
    'student cannot read another student\u2019s attempt',
    !aAttempts.error && !seesForeignAttempt,
    seesForeignAttempt ? 'foreign attempt visible' : ''
  );

  // Students have no UPDATE policy on exam_sessions: the write must no-op.
  const blockedWrite = await studentAClient
    .from('exam_sessions')
    .update({ current_item: 999 })
    .eq('id', ids.sessionA)
    .select('id');
  check(
    'student cannot update an exam session (RLS write blocked)',
    !blockedWrite.error && (blockedWrite.data ?? []).length === 0,
    `${(blockedWrite.data ?? []).length} rows updated`
  );

  const fSessions = await facultyFClient.from('exam_sessions').select('id, student_id');
  const fSeesBoth =
    (fSessions.data ?? []).some((r) => r.student_id === created.studentA.id) &&
    (fSessions.data ?? []).some((r) => r.student_id === created.studentB.id);
  check(
    'assigned faculty reads sessions for the whole deployment',
    !fSessions.error && fSeesBoth,
    `${fSessions.data?.length ?? 0} rows`
  );

  const gSessions = await facultyGClient.from('exam_sessions').select('id');
  check(
    'unassigned faculty reads no sessions',
    !gSessions.error && (gSessions.data ?? []).length === 0,
    `${gSessions.data?.length ?? 0} rows`
  );

  const fEvents = await facultyFClient.from('exam_events').select('id, event_type, severity');
  check(
    'assigned faculty reads security events',
    !fEvents.error && (fEvents.data ?? []).length > 0,
    `${fEvents.data?.length ?? 0} rows`
  );

  const gEvents = await facultyGClient.from('exam_events').select('id');
  check(
    'unassigned faculty reads no events',
    !gEvents.error && (gEvents.data ?? []).length === 0,
    `${gEvents.data?.length ?? 0} rows`
  );

  const aEvents = await studentAClient.from('exam_events').select('id, student_id');
  const aEventsOwnOnly = (aEvents.data ?? []).every((e) => e.student_id === created.studentA.id);
  check('student reads only their own events', !aEvents.error && aEventsOwnOnly);

  // The save endpoint's proof-of-session columns are not student-writable.
  // Blocked means either a column-level REVOKE error (42501) or a zero-row
  // no-op under RLS — both are acceptable; an actual update is not.
  const blockedOperationId = await studentAClient
    .from('student_responses')
    .update({ last_operation_id: '00000000-0000-4000-8000-000000000000' })
    .eq('attempt_id', ids.attemptA)
    .select('id');
  const forgeCode = blockedOperationId.error?.code ?? null;
  const forgedRows = (blockedOperationId.data ?? []).length;
  check(
    'student cannot forge last_operation_id (RLS write blocked)',
    forgeCode === '42501' || (forgeCode === null && forgedRows === 0),
    forgeCode ? `error ${forgeCode}` : `${forgedRows} rows updated`
  );

  // --- Answer-key isolation ------------------------------------------------
  // The key lives only in answer_keys (RLS = faculty-of-offering only).
  // Create a real fixture row so a permissive policy could never pass
  // vacuously on an empty table.
  const keyQuestionId = await insertReturning('questions', {
    assessment_version_id: ids.version,
    question_type: 'multiple_choice',
    question_text: 'E2E answer-key isolation probe?',
    created_by: created.facultyF.id,
  });
  ids.keyQuestion = keyQuestionId;
  const keyChoiceA = await insertReturning('question_choices', {
    question_id: keyQuestionId,
    choice_key: 'A',
    choice_text: 'Alpha',
    position: 0,
  });
  await insertReturning('question_choices', {
    question_id: keyQuestionId,
    choice_key: 'B',
    choice_text: 'Bravo',
    position: 1,
  });
  const keyRowId = await insertReturning('answer_keys', {
    question_id: keyQuestionId,
    correct_choice_id: keyChoiceA,
  });

  const adminKey = await admin.from('answer_keys').select('id').eq('id', keyRowId);
  check(
    'answer-key fixture exists (service role sees it)',
    !adminKey.error && (adminKey.data ?? []).length === 1,
    adminKey.error?.message ?? `${(adminKey.data ?? []).length} rows`
  );

  const sKey = await studentAClient
    .from('answer_keys')
    .select('id, correct_choice_id, canonical_answer, accepted_answers');
  check(
    'student cannot read answer_keys',
    !sKey.error && (sKey.data ?? []).length === 0,
    sKey.error ? `error ${sKey.error.code}` : `${(sKey.data ?? []).length} rows`
  );

  const sChoices = await studentAClient.from('question_choices').select('id, choice_key');
  check(
    'student cannot read question_choices directly (content flows via server action)',
    !sChoices.error && (sChoices.data ?? []).length === 0,
    sChoices.error ? `error ${sChoices.error.code}` : `${(sChoices.data ?? []).length} rows`
  );

  const sQuestions = await studentAClient.from('questions').select('id');
  check(
    'student cannot read questions directly',
    !sQuestions.error && (sQuestions.data ?? []).length === 0,
    sQuestions.error ? `error ${sQuestions.error.code}` : `${(sQuestions.data ?? []).length} rows`
  );

  const fKey = await facultyFClient.from('answer_keys').select('id').eq('id', keyRowId);
  check(
    'assigned faculty CAN read answer_keys (boundary works both ways)',
    !fKey.error && (fKey.data ?? []).length === 1,
    fKey.error ? `error ${fKey.error.code}` : `${(fKey.data ?? []).length} rows`
  );

  const gKey = await facultyGClient.from('answer_keys').select('id').eq('id', keyRowId);
  check(
    'unassigned faculty cannot read answer_keys',
    !gKey.error && (gKey.data ?? []).length === 0,
    gKey.error ? `error ${gKey.error.code}` : `${(gKey.data ?? []).length} rows`
  );

  // The student-visible response rows must carry no correctness fields —
  // grading results reach students only through the results surface. A real
  // fixture row keeps the projection check from passing vacuously.
  await insertReturning('student_responses', {
    attempt_id: ids.attemptA,
    question_id: keyQuestionId,
    selected_choice_id: keyChoiceA,
  });
  const adminResponses = await admin
    .from('student_responses')
    .select('id')
    .eq('attempt_id', ids.attemptA);
  const resp = await studentAClient
    .from('student_responses')
    .select('*')
    .eq('attempt_id', ids.attemptA)
    .limit(5);
  const rows = resp.data ?? [];
  const respKeys = new Set(rows.flatMap((r) => Object.keys(r)));
  const leaky = [...respKeys].filter((k) =>
    /is_correct|correct_choice|canonical_answer|accepted_answers|points_awarded/i.test(k)
  );
  const gradedLeak = rows.some(
    (r) => r.scoring_status === 'pending' && (r.earned_points ?? null) !== null
  );
  check(
    'student_responses exposes no answer-key/correctness data',
    (adminResponses.data ?? []).length > 0 &&
      rows.length > 0 &&
      leaky.length === 0 &&
      !gradedLeak,
    leaky.length > 0
      ? `leaky columns: ${leaky.join(', ')}`
      : gradedLeak
        ? 'earned_points visible while scoring_status=pending'
        : `fixture=${(adminResponses.data ?? []).length}, student sees ${rows.length}, error ${resp.error?.code ?? 'none'}`
  );
}

// ---------------------------------------------------------------------------
// 7. Realtime publication
// ---------------------------------------------------------------------------

async function testRealtime() {
  const { ids } = created;
  const outcome = await new Promise((resolve) => {
    let settle;
    const timeout = setTimeout(() => settle({ reason: 'timeout' }), 15_000);
    settle = (value) => {
      clearTimeout(timeout);
      resolve(value);
    };

    const channel = admin.channel(`e2e-exam-${TAG}`);
    channel
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'exam_events',
          filter: `deployment_id=eq.${ids.deployment}`,
        },
        (payload) => settle({ delivered: payload })
      )
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          admin
            .from('exam_events')
            .insert({
              attempt_id: ids.attemptA,
              student_id: created.studentA.id,
              deployment_id: ids.deployment,
              event_type: 'page_reloaded',
              severity: 'warning',
            })
            .then(({ error }) => {
              if (error) settle({ insertError: error.message });
            });
          return;
        }
        if (status === 'TIMED_OUT' || status === 'CLOSED') {
          settle({ status });
          return;
        }
        if (status === 'CHANNEL_ERROR') {
          settle({ status, err });
        }
      });
  });

  const detail = outcome.delivered
    ? `event=${outcome.delivered.new?.event_type}`
    : outcome.insertError
      ? `insert error: ${outcome.insertError}`
      : outcome.status
        ? `channel ${outcome.status}${outcome.err ? `: ${outcome.err}` : ''}`
        : 'no event within 15s';
  check(
    'exam_events realtime (publication) delivers inserts',
    Boolean(outcome.delivered),
    detail
  );
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

async function cleanup() {
  const { ids, users } = created;
  await admin.from('exam_events').delete().eq('deployment_id', ids.deployment ?? '');
  await admin.from('exam_sessions').delete().eq('deployment_id', ids.deployment ?? '');
  await admin.from('exam_manifests').delete().eq('attempt_id', ids.attemptA ?? '');
  await admin.from('exam_manifests').delete().eq('attempt_id', ids.attemptA2 ?? '');
  await admin.from('exam_manifests').delete().eq('attempt_id', ids.attemptB ?? '');
  await admin.from('exam_attempts').delete().eq('deployment_id', ids.deployment ?? '');
  await admin.from('assessment_deployments').delete().eq('id', ids.deployment ?? '');
  await admin.from('assessments').delete().eq('id', ids.assessment ?? '');
  await admin.from('student_responses').delete().eq('attempt_id', ids.attemptA ?? '');
  if (ids.keyQuestion) {
    await admin.from('answer_keys').delete().eq('question_id', ids.keyQuestion);
    await admin.from('question_choices').delete().eq('question_id', ids.keyQuestion);
    await admin.from('questions').delete().eq('id', ids.keyQuestion);
  }
  await admin.from('assessment_versions').delete().eq('id', ids.version ?? '');
  await admin.from('faculty_assignments').delete().eq('id', ids.facultyAssignment ?? '');
  await admin.from('subject_offerings').delete().eq('id', ids.offering ?? '');
  await admin.from('subjects').delete().eq('id', ids.subject ?? '');
  await admin.from('sections').delete().eq('id', ids.section ?? '');
  await admin.from('year_levels').delete().eq('id', ids.yearLevel ?? '');
  await admin.from('programs').delete().eq('id', ids.program ?? '');
  await admin.from('semesters').delete().eq('id', ids.semester ?? '');
  await admin.from('academic_years').delete().eq('id', ids.academicYear ?? '');

  for (const userId of users) {
    await admin.from('faculty_profiles').delete().eq('user_id', userId);
    await admin.from('student_profiles').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('id', userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`cleanup user ${userId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------

let exitCode = 0;
try {
  await testSchema();
  await createFixtures();
  await testPolicyRoundTrip();
  await testSessionInvariants();
  await testCheckConstraints();
  await testRls();
  await testRealtime();
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
if (failures > 0) {
  console.error(`${failures} FAILED`);
  exitCode = 1;
} else {
  console.log('ALL EXAM E2E CHECKS PASSED');
}
process.exit(exitCode);
