/**
 * End-to-end test for enrollment management (faculty roster, bulk enroll,
 * admin roster, section↔offering sync hooks).
 *
 * Exercises the REAL stack: built server (`next start`), real HTTP, real
 * Supabase sessions via @supabase/ssr cookies, real server actions resolved
 * from `.next/server/server-reference-manifest.json`, real RLS paths.
 *
 * Run:  node --env-file=.env.local scripts/e2e-enrollment.mjs
 * (requires a fresh `npm run build` first)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const PORT = 3210;
const BASE = `http://localhost:${PORT}`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Missing Supabase env vars. Run: node --env-file=.env.local scripts/e2e-enrollment.mjs');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const projectRef = new URL(url).hostname.split('.')[0];
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// Server-action manifest
// ---------------------------------------------------------------------------

const manifestPath = path.join('.next', 'server', 'server-reference-manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('Missing .next/server/server-reference-manifest.json — run `npm run build` first.');
  process.exit(1);
}
const manifestNode = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).node;

function actionId(exportName, filenamePart) {
  for (const [id, v] of Object.entries(manifestNode)) {
    if (v.exportedName === exportName && (!filenamePart || String(v.filename).includes(filenamePart))) {
      return id;
    }
  }
  throw new Error(`Server action not found in manifest: ${exportName}`);
}

const ACT = {
  addStudent: actionId('addStudentToOffering', 'students/actions.ts'),
  addStudents: actionId('addStudentsToOffering', 'students/actions.ts'),
  removeStudent: actionId('removeStudentFromOffering', 'students/actions.ts'),
  restoreStudent: actionId('restoreStudentToOffering', 'students/actions.ts'),
  enrollSection: actionId('enrollSectionStudents', 'students/actions.ts'),
  verifyStudent: actionId('verifyStudentIdentity', 'students/actions.ts'),
  createOffering: actionId('createOffering', 'admin/subjects/actions.ts'),
  roster: actionId('getOfferingRoster', 'admin/subjects/actions.ts'),
  setSection: actionId('setStudentSection', 'admin/users/actions.ts'),
  setVerification: actionId('setStudentVerification', 'admin/users/actions.ts'),
  startVerify: actionId('startIdentityVerification', 'student/verify/actions.ts'),
  completeVerify: actionId('completeIdentityVerification', 'student/verify/actions.ts'),
  requestVerify: actionId('requestManualVerification', 'student/verify/actions.ts'),
  completeJob: actionId('completeGenerationJob', 'assessments/actions.ts'),
  failJob: actionId('failGenerationJob', 'assessments/actions.ts'),
  genTos: actionId('generateAssessmentTOS', 'assessments/actions.ts'),
  approve: actionId('approveAssessment', 'assessments/actions.ts'),
  createNewVersion: actionId('createNewVersion', 'assessments/actions.ts'),
  propose: actionId('proposeAssessmentModifications', 'assessments/actions.ts'),
  apply: actionId('applyAssessmentModifications', 'assessments/actions.ts'),
  quality: actionId('getPreExamQuality', 'assessments/actions.ts'),
  submitExam: actionId('submitExam', 'exam/actions.ts'),
  assignProctor: actionId('assignProctor', 'proctoring/actions.ts'),
  removeProctor: actionId('removeProctor', 'proctoring/actions.ts'),
  listProctors: actionId('listProctors', 'proctoring/actions.ts'),
  concludeAttempt: actionId('concludeAttempt', 'monitor/actions.ts'),
  concludeSelected: actionId('concludeSelectedAttempts', 'monitor/actions.ts'),
  concludeAll: actionId('concludeAllAttempts', 'monitor/actions.ts'),
  reviewQueue: actionId('getIdentificationResponsesNeedingReview', 'review/actions.ts'),
  scoreResponse: actionId('scoreIdentificationResponse', 'review/actions.ts'),
  recommend: actionId('getScoreRecommendation', 'review/actions.ts'),
};

// ---------------------------------------------------------------------------
// Sessions → cookies (via @supabase/ssr itself, so the format matches exactly)
// ---------------------------------------------------------------------------

async function signIn(email, password) {
  const jar = new Map();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`);

  if (jar.size === 0 && data.session) {
    // Fallback: encode the session the way ssr writes it (base64url JSON,
    // chunked if over 3180 chars). Only used if the server client did not
    // flush cookies for this sign-in.
    const key = `sb-${projectRef}-auth-token`;
    const encoded = 'base64-' + Buffer.from(JSON.stringify(data.session), 'utf8').toString('base64url');
    let chunks;
    try {
      const { createChunks } = await import('@supabase/ssr/dist/main/utils/chunker.js');
      chunks = createChunks(key, encoded);
    } catch {
      chunks = [{ name: key, value: encoded }];
    }
    for (const c of chunks) jar.set(c.name, c.value);
  }

  if (jar.size === 0) throw new Error(`No auth cookies produced for ${email}`);
  const cookie = [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
  return { client, cookie };
}

async function sessionCookie(email, password) {
  return (await signIn(email, password)).cookie;
}

/**
 * Server-side Supabase fetches occasionally stall on half-open sockets to the
 * cloud project; retry timeouts so the suite reports real failures only.
 */
async function withRetry(label, fn, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError' || String(err?.message ?? err).includes('aborted');
      console.log(`  ! ${label} attempt ${i}/${attempts}: ${err?.message ?? err}`);
      if (!isTimeout || i === attempts) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

async function callAction({ cookie, actionId: id, pathname, args, label }) {
  return withRetry(label ?? `POST ${pathname}#${String(id).slice(0, 8)}`, async () => {
    const res = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: {
        'Next-Action': id,
        'Content-Type': 'text/plain;charset=UTF-8',
        Accept: 'text/x-component',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(45000),
    });
    const text = await res.text();
    return { status: res.status, text };
  });
}

async function getPage(pathname, cookie) {
  return withRetry(`GET ${pathname}`, async () => {
    const res = await fetch(`${BASE}${pathname}`, {
      headers: cookie ? { Cookie: cookie } : {},
      signal: AbortSignal.timeout(45000),
    });
    return { status: res.status, html: await res.text(), location: res.headers.get('location') ?? '' };
  });
}

/**
 * GET without following redirects — guard assertions need the real Location
 * header (fetch() strips it after following, which hides WHERE a bounce went).
 */
async function getPageManual(pathname, cookie) {
  return withRetry(`GET (manual) ${pathname}`, async () => {
    const res = await fetch(`${BASE}${pathname}`, {
      headers: cookie ? { Cookie: cookie } : {},
      redirect: 'manual',
      signal: AbortSignal.timeout(45000),
    });
    return { status: res.status, html: await res.text(), location: res.headers.get('location') ?? '' };
  });
}

/**
 * Where a guard actually sent us. A redirect() thrown before the response
 * flushes arrives as a 307 with a Location header; one thrown AFTER the shell
 * starts streaming (these guards run after several awaits) comes back as
 * 200 + <meta http-equiv="refresh" content="1;url=…"> — fetch never follows
 * that, so the target lives in the document itself.
 */
function bounceTarget(res) {
  if (res.location) return res.location;
  const m = res.html.match(/http-equiv="refresh" content="\d+;url=([^"]+)"/);
  return m ? m[1] : '';
}

/** Plain JSON POST (route handlers such as /api/exam/start). */
async function postJson(pathname, cookie, body) {
  return withRetry(`POST ${pathname}`, async () => {
    const res = await fetch(`${BASE}${pathname}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, json };
  });
}

/** The action result JSON is embedded in the flight stream; scan for it. */
function actionSucceeded(text) {
  return /"success"\s*:\s*true/.test(text) || /"summary"\s*:\s*\{/.test(text);
}

function actionError(text) {
  const matches = [...text.matchAll(/"error"\s*:\s*"((?:\\.|[^"\\])*)"/g)].map((m) => m[1]);
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

/** Extract a JSON-encoded string value by key from the flight stream. */
function flightString(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
  return m ? JSON.parse(`"${m[1]}"`) : null;
}

/** Extract a JSON array/object/bool/number value by key from the flight stream. */
function flightValue(text, key) {
  const m = text.match(
    new RegExp(`"${key}"\\s*:\\s*(\\[[^\\]]*\\]|\\{[^}]*\\}|"(?:\\\\.|[^"\\\\])*"|true|false|-?[0-9.]+)`)
  );
  return m ? JSON.parse(m[1]) : null;
}

/**
 * Like flightValue, but bracket-balanced and string-aware — for arrays whose
 * elements contain nested objects/arrays (e.g. AI modification proposals with
 * fields.choices), which would break flightValue's non-nesting regex.
 */
function extractJsonByKey(text, key) {
  const m = text.match(new RegExp(`"${key}"\\s*:`));
  if (!m) return null;
  let i = (m.index ?? 0) + m[0].length;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  const open = text[i];
  if (open !== '[' && open !== '{') return null;
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let j = i; j < text.length; j += 1) {
    const ch = text[j];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, j + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const stamp = Date.now().toString(36).toUpperCase();
const SHORT = stamp.slice(-6);

const fx = {
  userIds: [],
  subjectIds: [],
  offeringIds: [],
  sectionId: null,
  semesterId: null,
  academicYearId: null,
  programId: null,
  yearLevelId: null,
  facultyEmail: `e2efac-${SHORT}@e2e.test`.toLowerCase(),
  // Second faculty member — the T35 proctoring fixture needs somebody to
  // ASSIGN as a proctor who is not the offering's own faculty.
  faculty2Email: `e2efac2-${SHORT}@e2e.test`.toLowerCase(),
  adminEmail: `e2eadm-${SHORT}@e2e.test`.toLowerCase(),
  s1Email: `e2es1-${SHORT}@e2e.test`.toLowerCase(),
  s2Email: `e2es2-${SHORT}@e2e.test`.toLowerCase(),
  s3Email: `e2es3-${SHORT}@e2e.test`.toLowerCase(),
  password: 'E2ePassword1!',
  s1Number: `E2E${SHORT}-1`,
  s2Number: `E2E${SHORT}-2`,
  s3Number: `E2E${SHORT}-3`,
  subjectCode1: `E2E${SHORT}`.slice(0, 20),
  subjectCode2: `E2E${SHORT}B`.slice(0, 20),
  programCode: `E2E${SHORT}`.slice(0, 10),
  sectionName: `S${SHORT}`.slice(0, 20),
  facultyId: null,
  faculty2Id: null,
  adminId: null,
  s1Id: null,
  s2Id: null,
  s3Id: null,
  // Assessment/deployment fixtures for the exam-eligibility probes (T26-T28).
  exam: null,
};

async function createUser(email, fullName) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: fx.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  const id = data.user.id;
  fx.userIds.push(id);

  const { error: pErr } = await admin.from('profiles').insert({
    id,
    email,
    full_name: fullName,
    status: 'active',
  });
  if (pErr) throw new Error(`profile ${email}: ${pErr.message}`);
  return id;
}

async function setupFixtures() {
  const ay = await admin
    .from('academic_years')
    .insert({ name: `E2E-AY-${SHORT}`, starts_on: '2026-01-01', ends_on: '2026-12-31', is_active: true })
    .select('id')
    .single();
  if (ay.error) throw new Error(`academic year: ${ay.error.message}`);
  fx.academicYearId = ay.data.id;

  const sem = await admin
    .from('semesters')
    .insert({
      academic_year_id: fx.academicYearId,
      name: `E2E-SM-${SHORT}`,
      starts_on: '2026-01-01',
      ends_on: '2026-06-30',
      is_active: true,
    })
    .select('id')
    .single();
  if (sem.error) throw new Error(`semester: ${sem.error.message}`);
  fx.semesterId = sem.data.id;

  const prog = await admin
    .from('programs')
    .insert({ code: fx.programCode, name: `E2E Program ${SHORT}`, is_active: true })
    .select('id')
    .single();
  if (prog.error) throw new Error(`program: ${prog.error.message}`);
  fx.programId = prog.data.id;

  const yl = await admin
    .from('year_levels')
    .insert({ name: `E2E Year ${SHORT}`, sort_order: 99 })
    .select('id')
    .single();
  if (yl.error) throw new Error(`year level: ${yl.error.message}`);
  fx.yearLevelId = yl.data.id;

  const sec = await admin
    .from('sections')
    .insert({
      program_id: fx.programId,
      year_level_id: fx.yearLevelId,
      name: fx.sectionName,
      is_active: true,
    })
    .select('id')
    .single();
  if (sec.error) throw new Error(`section: ${sec.error.message}`);
  fx.sectionId = sec.data.id;

  for (const code of [fx.subjectCode1, fx.subjectCode2]) {
    const s = await admin
      .from('subjects')
      .insert({ code, title: `E2E Subject ${code}`, is_active: true })
      .select('id')
      .single();
    if (s.error) throw new Error(`subject ${code}: ${s.error.message}`);
    fx.subjectIds.push(s.data.id);
  }

  fx.facultyId = await createUser(fx.facultyEmail, 'E2E Faculty');
  fx.faculty2Id = await createUser(fx.faculty2Email, 'E2E Faculty Two');
  fx.adminId = await createUser(fx.adminEmail, 'E2E Admin');
  fx.s1Id = await createUser(fx.s1Email, 'E2E Student One');
  fx.s2Id = await createUser(fx.s2Email, 'E2E Student Two');
  fx.s3Id = await createUser(fx.s3Email, 'E2E Student Three');

  await admin.from('user_roles').insert([
    { user_id: fx.facultyId, role: 'faculty' },
    { user_id: fx.faculty2Id, role: 'faculty' },
    { user_id: fx.adminId, role: 'super_admin' },
    { user_id: fx.s1Id, role: 'student' },
    { user_id: fx.s2Id, role: 'student' },
    { user_id: fx.s3Id, role: 'student' },
  ]);
  await admin.from('faculty_profiles').insert([
    { user_id: fx.facultyId },
    { user_id: fx.faculty2Id },
  ]);
  await admin.from('student_profiles').insert([
    { user_id: fx.s1Id, student_number: fx.s1Number, program_id: fx.programId, year_level_id: fx.yearLevelId, section_id: null, verification_status: 'verified' },
    { user_id: fx.s2Id, student_number: fx.s2Number, program_id: fx.programId, year_level_id: fx.yearLevelId, section_id: null, verification_status: 'verified' },
    { user_id: fx.s3Id, student_number: fx.s3Number, program_id: fx.programId, year_level_id: fx.yearLevelId, section_id: null, verification_status: 'verified' },
  ]);

  // Offering 1 — no faculty yet so the 4b hook (createOffering auto-enroll)
  // is NOT what puts anyone in it; faculty actions own its roster.
  const o1 = await admin
    .from('subject_offerings')
    .insert({
      subject_id: fx.subjectIds[0],
      semester_id: fx.semesterId,
      program_id: fx.programId,
      year_level_id: fx.yearLevelId,
      section_id: fx.sectionId,
      status: 'active',
    })
    .select('id')
    .single();
  if (o1.error) throw new Error(`offering1: ${o1.error.message}`);
  fx.offeringIds.push(o1.data.id);

  const fa = await admin
    .from('faculty_assignments')
    .insert({ subject_offering_id: o1.data.id, faculty_id: fx.facultyId, is_primary: true })
    .select('id')
    .single();
  if (fa.error) throw new Error(`faculty assignment: ${fa.error.message}`);
}

async function cleanup() {
  // Users first: cascades profiles → student_profiles → enrollments and
  // faculty_profiles → faculty_assignments.
  for (const id of fx.userIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
  // Exam-eligibility/notification fixtures (T26-T28), in FK-safe order.
  if (fx.exam?.assessmentId) {
    for (const depId of fx.exam.deploymentIds) {
      const { data: attemptRows } = await admin
        .from('exam_attempts')
        .select('id')
        .eq('deployment_id', depId);
      const attemptIds = (attemptRows ?? []).map((r) => r.id);
      if (attemptIds.length > 0) {
        await admin.from('exam_manifests').delete().in('attempt_id', attemptIds);
        await admin.from('student_responses').delete().in('attempt_id', attemptIds);
        await admin.from('assessment_results').delete().in('attempt_id', attemptIds);
      }
      await admin.from('exam_events').delete().eq('deployment_id', depId);
      await admin.from('exam_sessions').delete().eq('deployment_id', depId);
      await admin.from('exam_attempts').delete().eq('deployment_id', depId);
      await admin.from('assessment_deployments').delete().eq('id', depId);
    }
    await admin.from('questions').delete().eq('assessment_version_id', fx.exam.versionId);
    await admin.from('assessment_versions').delete().eq('id', fx.exam.versionId);
    await admin.from('assessments').delete().eq('id', fx.exam.assessmentId);
  }
  for (const id of fx.offeringIds) {
    await admin.from('subject_offerings').delete().eq('id', id);
  }
  for (const id of fx.subjectIds) {
    await admin.from('subjects').delete().eq('id', id);
  }
  if (fx.sectionId) await admin.from('sections').delete().eq('id', fx.sectionId);
  if (fx.semesterId) await admin.from('semesters').delete().eq('id', fx.semesterId);
  if (fx.academicYearId) await admin.from('academic_years').delete().eq('id', fx.academicYearId);
  if (fx.programId) await admin.from('programs').delete().eq('id', fx.programId);
  if (fx.yearLevelId) await admin.from('year_levels').delete().eq('id', fx.yearLevelId);
  console.log('Cleanup complete.');
}

async function enrollmentStatus(offeringId, studentId) {
  const { data } = await admin
    .from('enrollments')
    .select('status')
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentId)
    .maybeSingle();
  return data?.status ?? null;
}

async function enrollmentCount(offeringId) {
  const { count } = await admin
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('subject_offering_id', offeringId);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let server = null;
let serverLogFd = -1;

/**
 * Fail fast when the test port is already taken: a leaked `next start` from
 * an earlier run answers the readiness probe before the freshly spawned child
 * can report EADDRINUSE, so the run would silently test a stale server whose
 * chunk files no longer match the current .next build.
 */
async function assertPortFree() {
  const busy = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (err) => resolve(err.code === 'EADDRINUSE'));
    probe.once('listening', () => probe.close(() => resolve(false)));
    probe.listen(PORT);
  });
  if (busy) {
    throw new Error(
      `Port ${PORT} is already in use — a leaked server from an earlier run would ` +
        'answer the readiness probe while serving a stale build. Kill it first.'
    );
  }
}

async function startServer() {
  await assertPortFree();
  const serverLogPath = path.join('scripts', '.e2e-server.log');
  serverLogFd = fs.openSync(serverLogPath, 'w');
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    shell: true,
    detached: true,
    stdio: ['ignore', serverLogFd, serverLogFd],
    env: process.env,
  });

  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/`, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('next start did not become ready in 60s');
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function stopServer() {
  if (!server) return;
  const pid = server.pid;
  server = null;
  try {
    if (process.platform === 'win32') {
      // Await the kill: fire-and-forget let `process.exit` run before taskkill
      // completed, leaking a stale server that later answered readiness probes
      // while serving a wiped .next build.
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
        killer.once('exit', resolve);
        killer.once('error', resolve);
      });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    /* already gone */
  }
  try {
    fs.closeSync(serverLogFd);
  } catch {
    /* already closed */
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

async function run() {
  console.log('Setting up fixtures…');
  await setupFixtures();
  const o1 = fx.offeringIds[0];
  const facultyPath = `/faculty/subjects/${o1}/students`;

  // The MediaPipe adapter needs no vendor key server-side (all camera work
  // is in-browser), so the REAL adapter — not a mock — runs in this suite.
  process.env.IDENTITY_ADAPTER = 'mediapipe';
  await startServer();
  console.log(`Server ready at ${BASE}`);

  const facultyCookie = await sessionCookie(fx.facultyEmail, fx.password);
  const adminCookie = await sessionCookie(fx.adminEmail, fx.password);
  const studentCookie = await sessionCookie(fx.s1Email, fx.password);

  // T1 — unauthenticated is redirected by the proxy
  {
    const res = await fetch(`${BASE}/faculty/subjects`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
    const loc = res.headers.get('location') ?? '';
    check('T1 unauth /faculty/subjects redirects to /login',
      [301, 302, 303, 307, 308].includes(res.status) && loc.includes('/login'),
      `status=${res.status} location=${loc}`);
  }

  // T2 — faculty can render the roster (empty state uses the fixed copy)
  {
    const { status, html } = await getPage(facultyPath, facultyCookie);
    check('T2 faculty roster page renders', status === 200, `status=${status}`);
    check('T2 empty state copy (no self-enrollment wording)',
      html.includes('No students enrolled') && html.includes('Add students by student number'),
      '');
    check('T2 stale "once they enroll" copy is gone', !html.includes('once they enroll in this offering'));
  }

  // T3 — faculty adds student 1 by number
  {
    const r = await callAction({ cookie: facultyCookie, actionId: ACT.addStudent, pathname: facultyPath, args: [o1, fx.s1Number] });
    check('T3 addStudentToOffering succeeds', actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);
    check('T3 DB: student1 enrolled', (await enrollmentStatus(o1, fx.s1Id)) === 'enrolled');
  }

  // T4 — roster shows the student with their number (object/array embed fix)
  {
    const { html } = await getPage(facultyPath, facultyCookie);
    check('T4 roster shows student number', html.includes(fx.s1Number), '');
    check('T4 roster shows Enrolled badge', html.includes('Enrolled'));
  }

  // T5 — faculty withdraws (this failed pre-migration: missing updated_at)
  {
    const r = await callAction({ cookie: facultyCookie, actionId: ACT.removeStudent, pathname: facultyPath, args: [o1, fx.s1Id] });
    check('T5 removeStudentFromOffering succeeds', actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);
    check('T5 DB: student1 withdrawn', (await enrollmentStatus(o1, fx.s1Id)) === 'withdrawn');
  }

  // T6 — withdrawn rows stay visible with Re-enroll
  {
    const { html } = await getPage(facultyPath, facultyCookie);
    check('T6 roster shows Withdrawn row', html.includes('Withdrawn') && html.includes(fx.s1Number));
    check('T6 roster offers Re-enroll', html.includes('Re-enroll'));
  }

  // T7 — re-enroll via the new restore action
  {
    const r = await callAction({ cookie: facultyCookie, actionId: ACT.restoreStudent, pathname: facultyPath, args: [o1, fx.s1Id] });
    check('T7 restoreStudentToOffering succeeds', actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);
    check('T7 DB: student1 enrolled again', (await enrollmentStatus(o1, fx.s1Id)) === 'enrolled');
  }

  // T8 — bulk paste: student2 + an unknown number → partial success summary
  {
    const r = await callAction({
      cookie: facultyCookie,
      actionId: ACT.addStudents,
      pathname: facultyPath,
      args: [o1, [`${fx.s2Number}, NOPE-${SHORT}`]],
    });
    check('T8 addStudentsToOffering returns summary', /"summary"\s*:\s*\{/.test(r.text), actionError(r.text) ?? '');
    check('T8 DB: student2 enrolled', (await enrollmentStatus(o1, fx.s2Id)) === 'enrolled');
    check('T8 DB: unknown number created nothing', (await enrollmentCount(o1)) === 2, `count=${await enrollmentCount(o1)}`);
  }

  // T9 — withdraw student2 so the section catch-all has work to do
  {
    await callAction({ cookie: facultyCookie, actionId: ACT.removeStudent, pathname: facultyPath, args: [o1, fx.s2Id] });
    check('T9 DB: student2 withdrawn', (await enrollmentStatus(o1, fx.s2Id)) === 'withdrawn');
  }

  // T10 — ADMIN assigns student3 to the section → sync hook enrolls them
  {
    const r = await callAction({ cookie: adminCookie, actionId: ACT.setSection, pathname: '/admin/users', args: [fx.s3Id, fx.sectionId] });
    check('T10 setStudentSection succeeds', actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);
    const { data: prof } = await admin.from('student_profiles').select('section_id').eq('user_id', fx.s3Id).single();
    check('T10 DB: student3 section_id set', prof?.section_id === fx.sectionId, String(prof?.section_id));
    check('T10 sync: student3 auto-enrolled in offering1', (await enrollmentStatus(o1, fx.s3Id)) === 'enrolled');
  }

  // T11 — ADMIN creates a second offering for the same section → 4b hook
  {
    const before = await enrollmentCount(o1); // sanity: unchanged
    const r = await callAction({
      cookie: adminCookie,
      actionId: ACT.createOffering,
      pathname: '/admin/subjects',
      args: [{
        subjectId: fx.subjectIds[1],
        semesterId: fx.semesterId,
        programId: fx.programId,
        yearLevelId: fx.yearLevelId,
        sectionId: fx.sectionId,
      }],
    });
    check('T11 createOffering succeeds', actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);

    const { data: offerings } = await admin
      .from('subject_offerings')
      .select('id')
      .eq('subject_id', fx.subjectIds[1])
      .eq('section_id', fx.sectionId);
    const o2 = offerings?.[0]?.id;
    check('T11 second offering exists', Boolean(o2));
    if (o2) fx.offeringIds.push(o2);

    // Section members: student1 (section null still!), student3 (section set).
    // Wait — only student3 has section_id set. So o2 should hold exactly student3.
    // (student1/student2 were never assigned to the section in this run.)
    check('T11 sync: section student3 auto-enrolled in new offering',
      o2 ? (await enrollmentStatus(o2, fx.s3Id)) === 'enrolled' : false);
    check('T11 non-section student2 NOT auto-enrolled in new offering',
      o2 ? (await enrollmentStatus(o2, fx.s2Id)) === null : false);
    check('T11 pre-existing roster untouched', (await enrollmentCount(o1)) === before);
  }

  // T12 — faculty "entire section" catch-all re-enrolls the withdrawn student
  {
    // Put student3 into the section AND withdraw them first? student3 is in
    // section and enrolled in o1. Withdraw student3 from o1, then the section
    // button must restore them.
    await callAction({ cookie: facultyCookie, actionId: ACT.removeStudent, pathname: facultyPath, args: [o1, fx.s3Id] });
    check('T12 prep: student3 withdrawn', (await enrollmentStatus(o1, fx.s3Id)) === 'withdrawn');

    const r = await callAction({ cookie: facultyCookie, actionId: ACT.enrollSection, pathname: facultyPath, args: [o1] });
    check('T12 enrollSectionStudents succeeds', actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);
    check('T12 section catch-all re-enrolled student3', (await enrollmentStatus(o1, fx.s3Id)) === 'enrolled');
    check('T12 non-section student2 still withdrawn', (await enrollmentStatus(o1, fx.s2Id)) === 'withdrawn');
  }

  // T13 — ADMIN roster loader (manage-students modal data source)
  {
    const r = await callAction({ cookie: adminCookie, actionId: ACT.roster, pathname: '/admin/subjects', args: [o1] });
    check('T13 getOfferingRoster succeeds', /"success"\s*:\s*true/.test(r.text), actionError(r.text) ?? `status=${r.status}`);
    check('T13 roster includes student number', r.text.includes(fx.s1Number), '');
  }

  // T14 — ADMIN can use the faculty add action (canManageEnrollment gate)
  {
    // Re-withdraw student2, then admin restores via restoreStudent.
    const rr = await callAction({ cookie: adminCookie, actionId: ACT.restoreStudent, pathname: facultyPath, args: [o1, fx.s2Id] });
    check('T14 admin restore on faculty route succeeds', actionSucceeded(rr.text), actionError(rr.text) ?? '');
    check('T14 DB: student2 enrolled (admin restore)', (await enrollmentStatus(o1, fx.s2Id)) === 'enrolled');
  }

  // T15 — STUDENT cannot enroll anyone (gate denies; no DB write)
  {
    const r = await callAction({ cookie: studentCookie, actionId: ACT.addStudent, pathname: facultyPath, args: [o1, fx.s2Number] });
    const err = actionError(r.text);
    check('T15 student denied by gate', err === 'Not authorized for this offering', err ?? `status=${r.status}`);
    check('T15 DB: roster unchanged by student attempt', (await enrollmentStatus(o1, fx.s2Id)) === 'enrolled');
  }

  // T16 — pages render for each role with the new UI
  {
    const adminSubjects = await getPage('/admin/subjects', adminCookie);
    // React splits literal+expression text with comment nodes: `Students (<!-- -->3<!-- -->)`.
    const subjectsHtml = adminSubjects.html.replace(/<!--.*?-->/g, '');
    check('T16 admin /admin/subjects renders', adminSubjects.status === 200, `status=${adminSubjects.status}`);
    check('T16 admin roster button present', subjectsHtml.includes('Students ('));
    const expectedCount = await enrollmentCount(o1);
    check('T16 admin roster button shows count',
      subjectsHtml.includes(`Students (${expectedCount})`),
      `expected Students (${expectedCount})`);

    const adminUsers = await getPage('/admin/users', adminCookie);
    check('T16 admin /admin/users renders with Section column', adminUsers.status === 200 && adminUsers.html.includes('Section'), `status=${adminUsers.status}`);

    const studentSubjects = await getPage('/student/subjects', studentCookie);
    const studentHtml = studentSubjects.html.replace(/<!--.*?-->/g, '');
    check('T16 student /student/subjects renders', studentSubjects.status === 200, `status=${studentSubjects.status}`);
    check('T16 student sees rostered subject',
      studentHtml.includes(fx.subjectCode1) || studentHtml.includes('E2E Subject'),
      `empty=${studentHtml.includes('No enrolled subjects')} code=${studentHtml.includes(fx.subjectCode1)}`);
  }

  // T17 — audit trail recorded the sync
  {
    const { data: logs } = await admin
      .from('audit_logs')
      .select('entity_type, metadata')
      .eq('entity_type', 'student_profile')
      .eq('entity_id', fx.s3Id);
    check('T17 audit log for section assignment', (logs ?? []).length > 0, `count=${logs?.length ?? 0}`);
  }

  // T18 — discoverability: every path to the roster has an entry point
  {
    const overview = await getPage(`/faculty/subjects/${o1}`, facultyCookie);
    const overviewHtml = overview.html.replace(/<!--.*?-->/g, '');
    check('T18 overview shows Manage Students button',
      overview.status === 200 && overviewHtml.includes('Manage Students'),
      `status=${overview.status}`);
    check('T18 overview stat card links to roster',
      overviewHtml.includes(`/faculty/subjects/${o1}/students`) && overviewHtml.includes('Manage roster'));

    const list = await getPage('/faculty/subjects', facultyCookie);
    const listHtml = list.html.replace(/<!--.*?-->/g, '');
    check('T18 subjects list has per-offering Students link',
      list.status === 200 && listHtml.includes(`href="/faculty/subjects/${o1}/students"`),
      `status=${list.status}`);

    const roster = await getPage(facultyPath, facultyCookie);
    const rosterHtml = roster.html.replace(/<!--.*?-->/g, '');
    check('T18 roster page has Add Student + Bulk Enroll buttons',
      rosterHtml.includes('Add Student') && rosterHtml.includes('Bulk Enroll'));

    const dash = await getPage('/faculty', facultyCookie);
    const dashHtml = dash.html.replace(/<!--.*?-->/g, '');
    check('T18 dashboard has Enroll Students quick action',
      dash.status === 200 && dashHtml.includes('Enroll Students'),
      `status=${dash.status}`);
  }

  // T19 — identity verification: faculty grants manual verification (scope §5)
  {
    // Fixtures default to 'verified' for other suites; start from 'pending'
    // so the grant itself is what the checks observe.
    await admin.from('student_profiles').update({ verification_status: 'pending' }).eq('user_id', fx.s1Id);

    const before = await getPage(facultyPath, facultyCookie);
    const beforeHtml = before.html.replace(/<!--.*?-->/g, '');
    check('T19 roster offers Verify identity while pending',
      beforeHtml.includes('Verify identity') && beforeHtml.includes('ID pending'),
      `verifyBtn=${beforeHtml.includes('Verify identity')} pendingBadge=${beforeHtml.includes('ID pending')}`);

    const r = await callAction({ cookie: facultyCookie, actionId: ACT.verifyStudent, pathname: facultyPath, args: [o1, fx.s1Id] });
    check('T19 faculty verifyStudentIdentity succeeds', actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);
    const { data: prof } = await admin.from('student_profiles').select('verification_status').eq('user_id', fx.s1Id).single();
    check('T19 DB: student1 verification_status = verified', prof?.verification_status === 'verified', String(prof?.verification_status));

    const roster = await getPage(facultyPath, facultyCookie);
    const html = roster.html.replace(/<!--.*?-->/g, '');
    check('T19 roster shows the ID verified badge', html.includes('ID verified'));
    check('T19 roster hides Verify identity once verified', !html.includes('Verify identity'));

    const { data: audit } = await admin
      .from('audit_logs')
      .select('id, metadata')
      .eq('entity_type', 'student_profile')
      .eq('entity_id', fx.s1Id)
      .eq('action', 'update');
    check('T19 audit log records the grant',
      (audit ?? []).some((row) => row.metadata?.method === 'faculty_manual'),
      `count=${audit?.length ?? 0}`);
  }

  // T20 — the SQL function refuses a non-faculty caller: the action's own
  // gate is not the only line of defense (defense in depth).
  {
    await admin.from('student_profiles').update({ verification_status: 'pending' }).eq('user_id', fx.s2Id);
    const { client: studentSess } = await signIn(fx.s2Email, fx.password);
    const { error } = await studentSess.rpc('faculty_verify_student', { p_student_id: fx.s2Id });
    check('T20 student rpc call denied with 42501',
      error?.code === '42501',
      `${error?.code ?? 'no error'} ${error?.message ?? ''}`);
    const { data: prof } = await admin.from('student_profiles').select('verification_status').eq('user_id', fx.s2Id).single();
    check('T20 DB: status untouched by the denied call', prof?.verification_status === 'pending', String(prof?.verification_status));
  }

  // T21 — faculty cannot verify a student outside their enrollments
  {
    await admin.from('student_profiles').update({ verification_status: 'pending' }).eq('user_id', fx.s2Id);
    await callAction({ cookie: facultyCookie, actionId: ACT.removeStudent, pathname: facultyPath, args: [o1, fx.s2Id] });

    const { client: facultySess } = await signIn(fx.facultyEmail, fx.password);
    const { error } = await facultySess.rpc('faculty_verify_student', { p_student_id: fx.s2Id });
    check('T21 faculty rpc denied for a student enrolled in none of their subjects',
      error?.code === '42501',
      `${error?.code ?? 'no error'} ${error?.message ?? ''}`);

    const r = await callAction({ cookie: facultyCookie, actionId: ACT.verifyStudent, pathname: facultyPath, args: [o1, fx.s2Id] });
    check('T21 verify action errors for that student', Boolean(actionError(r.text)), actionError(r.text) ?? `status=${r.status}`);
    const { data: prof } = await admin.from('student_profiles').select('verification_status').eq('user_id', fx.s2Id).single();
    check('T21 DB: status still pending', prof?.verification_status === 'pending', String(prof?.verification_status));
  }

  // T22 — the verification columns are REVOKE'd from `authenticated`: the
  // unrestricted "Students can update own profile" policy must no longer let
  // a student self-grant verified on their own row (20261010 migration).
  {
    await admin.from('student_profiles').update({ verification_status: 'pending' }).eq('user_id', fx.s3Id);
    const { client: s3sess } = await signIn(fx.s3Email, fx.password);
    const { error } = await s3sess
      .from('student_profiles')
      .update({
        verification_status: 'verified',
        verification_consent_at: new Date().toISOString(),
      })
      .eq('user_id', fx.s3Id);
    check('T22 student self-update of verification columns denied with 42501',
      error?.code === '42501',
      `${error?.code ?? 'no error'} ${error?.message ?? ''}`);
    const { data: prof } = await admin
      .from('student_profiles')
      .select('verification_status, verification_consent_at')
      .eq('user_id', fx.s3Id)
      .single();
    check('T22 DB: status untouched by the denied self-update',
      prof?.verification_status === 'pending' && !prof?.verification_consent_at,
      `${prof?.verification_status} consent=${prof?.verification_consent_at}`);
  }

  // T23 — the admin users page path runs through SECURITY DEFINER
  // admin_set_student_verification (the direct UPDATE the revoke now forbids);
  // a student calling the same function is refused inside it.
  {
    const r = await callAction({ cookie: adminCookie, actionId: ACT.setVerification, pathname: '/admin/users', args: [fx.s3Id, 'verified'] });
    check('T23 admin setStudentVerification succeeds via the rpc function',
      actionSucceeded(r.text), actionError(r.text) ?? `status=${r.status}`);
    const { data: prof } = await admin.from('student_profiles').select('verification_status').eq('user_id', fx.s3Id).single();
    check('T23 DB: status verified', prof?.verification_status === 'verified', String(prof?.verification_status));

    const { client: s3sess } = await signIn(fx.s3Email, fx.password);
    const { error } = await s3sess.rpc('admin_set_student_verification', {
      p_student_id: fx.s3Id,
      p_status: 'pending',
    });
    check('T23 student rpc call to admin_set_student_verification denied with 42501',
      error?.code === '42501',
      `${error?.code ?? 'no error'} ${error?.message ?? ''}`);
    const { data: after } = await admin.from('student_profiles').select('verification_status').eq('user_id', fx.s3Id).single();
    check('T23 DB: status untouched by the denied rpc', after?.verification_status === 'verified', String(after?.verification_status));
  }

  // T24 — provider flow (MediaPipe adapter, scope §5): explicit consent →
  // server-issued session + random challenges → settle through the same
  // verify() entry point the exam gate calls. Refusals must not widen.
  {
    const { cookie: s3Cookie } = await signIn(fx.s3Email, fx.password);
    await admin
      .from('student_profiles')
      .update({
        verification_status: 'pending',
        verification_consent_at: null,
        verification_provider: null,
        verification_verified_at: null,
        verification_meta: null,
      })
      .eq('user_id', fx.s3Id);

    const page = await getPage('/student/verify', s3Cookie);
    const pageHtml = page.html.replace(/<!--.*?-->/g, '');
    check('T24 verify page renders the privacy/consent notice',
      page.status === 200 && pageHtml.includes('consent') && pageHtml.includes('MediaPipe'),
      `status=${page.status} consent=${pageHtml.includes('consent')} mp=${pageHtml.includes('MediaPipe')}`);

    const start = await callAction({ cookie: s3Cookie, actionId: ACT.startVerify, pathname: '/student/verify', args: [] });
    const token = flightString(start.text, 'token');
    const challenges = flightValue(start.text, 'challenges');
    check('T24 startIdentityVerification issues a session token',
      Boolean(token), actionError(start.text) ?? `status=${start.status}`);
    check('T24 server picked 3 challenges from the vocabulary',
      Array.isArray(challenges) && challenges.length === 3 &&
        challenges.every((c) => ['blink', 'mouth_open', 'turn_left', 'turn_right'].includes(c)),
      JSON.stringify(challenges));

    const { data: consentRow } = await admin
      .from('student_profiles')
      .select('verification_consent_at')
      .eq('user_id', fx.s3Id)
      .single();
    check('T24 consent timestamp recorded before any capture', Boolean(consentRow?.verification_consent_at));

    const goodEvidence = {
      passed: true,
      model: 'face_landmarker',
      totalDurationMs: 5000,
      facePresenceMs: 4500,
      challengeResults: (challenges ?? []).map((c) => ({ challenge: c, ok: true, durationMs: 1200 })),
    };

    // A tampered session token (altered body, original signature) can't settle.
    const [body, sig] = String(token ?? 'x.y').split('.');
    const tampered = `${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}.${sig}`;
    const bad1 = await callAction({ cookie: s3Cookie, actionId: ACT.completeVerify, pathname: '/student/verify', args: [tampered, goodEvidence] });
    check('T24 tampered session token refused',
      Boolean(actionError(bad1.text)) && !/"ok"\s*:\s*true/.test(bad1.text),
      actionError(bad1.text) ?? `status=${bad1.status}`);

    // Evidence missing an issued challenge can't settle either.
    const shortEvidence = { ...goodEvidence, challengeResults: (goodEvidence.challengeResults ?? []).slice(0, 2) };
    const bad2 = await callAction({ cookie: s3Cookie, actionId: ACT.completeVerify, pathname: '/student/verify', args: [token, shortEvidence] });
    check('T24 incomplete challenge evidence refused',
      Boolean(actionError(bad2.text)), actionError(bad2.text) ?? `status=${bad2.status}`);

    const { data: stillPending } = await admin.from('student_profiles').select('verification_status').eq('user_id', fx.s3Id).single();
    check('T24 DB: structural refusals leave the status pending',
      stillPending?.verification_status === 'pending', String(stillPending?.verification_status));

    // Settle for real — matching evidence for the issued challenge set.
    const ok = await callAction({ cookie: s3Cookie, actionId: ACT.completeVerify, pathname: '/student/verify', args: [token, goodEvidence] });
    check('T24 completeIdentityVerification settles the session',
      /"ok"\s*:\s*true/.test(ok.text), actionError(ok.text) ?? `status=${ok.status}`);

    const { data: prof } = await admin
      .from('student_profiles')
      .select('verification_status, verification_provider, verification_verified_at, verification_meta, verification_consent_at')
      .eq('user_id', fx.s3Id)
      .single();
    check('T24 DB: verified through the provider',
      prof?.verification_status === 'verified' && prof?.verification_provider === 'mediapipe' && Boolean(prof?.verification_verified_at),
      `${prof?.verification_status}/${prof?.verification_provider}`);
    const metaKeys = Object.keys(prof?.verification_meta ?? {});
    check('T24 DB: minimum metadata (challenges + coarse timings, nothing biometric)',
      Array.isArray(prof?.verification_meta?.challenges) &&
        prof.verification_meta.challenges.length === 3 &&
        typeof prof.verification_meta.total_duration_ms === 'number' &&
        !metaKeys.some((k) => ['landmarks', 'frame', 'image', 'template', 'video'].includes(k)),
      JSON.stringify(metaKeys));

    const { data: audit } = await admin
      .from('audit_logs')
      .select('metadata')
      .eq('entity_type', 'student_profile')
      .eq('entity_id', fx.s3Id)
      .eq('action', 'update');
    check('T24 audit log records the provider grant',
      (audit ?? []).some((row) => row.metadata?.method === 'provider'),
      `count=${audit?.length ?? 0}`);

    const after = await getPage('/student/verify', s3Cookie);
    check('T24 verify page shows Identity verified once settled',
      after.html.replace(/<!--.*?-->/g, '').includes('Identity verified'),
      `status=${after.status}`);
  }

  // T25 — manual verification REQUEST loop (scope §5 faculty fallback): the
  // student asks in-app → assigned faculty get a deep-linked notification →
  // the EXISTING roster Verify button grants the status → exam gate unlocks.
  {
    await admin
      .from('student_profiles')
      .update({ verification_status: 'pending', verification_requested_at: null })
      .eq('user_id', fx.s2Id);
    // T21 withdrew student2 from the offering; re-enroll so faculty are resolvable.
    await callAction({ cookie: facultyCookie, actionId: ACT.restoreStudent, pathname: facultyPath, args: [o1, fx.s2Id] });

    const { cookie: s2Cookie } = await signIn(fx.s2Email, fx.password);

    const before = await getPage('/student/verify', s2Cookie);
    check('T25 verify page offers the manual request while pending',
      before.status === 200 && before.html.includes('Request manual verification'),
      `status=${before.status}`);

    const r1 = await callAction({ cookie: s2Cookie, actionId: ACT.requestVerify, pathname: '/student/verify', args: [] });
    check('T25 requestManualVerification succeeds', /"ok"\s*:\s*true/.test(r1.text), actionError(r1.text) ?? `status=${r1.status}`);
    const notified = flightValue(r1.text, 'notified');
    check('T25 notified the assigned instructor', notified === 1, String(notified));

    const { data: noteRows } = await admin
      .from('notifications')
      .select('user_id, type, title, data')
      .eq('type', 'identity_verification_requested')
      .eq('user_id', fx.facultyId)
      .contains('data', { student_user_id: fx.s2Id });
    check('T25 one notification for the faculty, deep-linked to the roster',
      (noteRows ?? []).length === 1 && noteRows?.[0]?.data?.offering_id === o1,
      `count=${noteRows?.length ?? 0} offering=${noteRows?.[0]?.data?.offering_id}`);

    const { data: reqRow } = await admin
      .from('student_profiles')
      .select('verification_requested_at, verification_status')
      .eq('user_id', fx.s2Id)
      .single();
    check('T25 request recorded, status untouched by the request itself',
      Boolean(reqRow?.verification_requested_at) && reqRow?.verification_status === 'pending',
      `${reqRow?.verification_requested_at} status=${reqRow?.verification_status}`);

    // Inside the cooldown a repeat request is idempotent.
    const r2 = await callAction({ cookie: s2Cookie, actionId: ACT.requestVerify, pathname: '/student/verify', args: [] });
    check('T25 repeat request inside cooldown is idempotent',
      /"alreadyRequested"\s*:\s*true/.test(r2.text), actionError(r2.text) ?? `status=${r2.status}`);
    const { data: noteRows2 } = await admin
      .from('notifications')
      .select('id')
      .eq('type', 'identity_verification_requested')
      .contains('data', { student_user_id: fx.s2Id });
    check('T25 no duplicate notification inside cooldown', (noteRows2 ?? []).length === 1, `count=${noteRows2?.length ?? 0}`);

    const pending = await getPage('/student/verify', s2Cookie);
    const pendingHtml = pending.html.replace(/<!--.*?-->/g, '');
    check('T25 student page shows waiting-for-instructor state',
      pendingHtml.includes('waiting for your instructor') && !pendingHtml.includes('Request manual verification'),
      `waiting=${pendingHtml.includes('waiting for your instructor')} btn=${pendingHtml.includes('Request manual verification')}`);

    const notes = await getPage('/notifications', facultyCookie);
    const notesHtml = notes.html.replace(/<!--.*?-->/g, '');
    const rosterHref = `href="/faculty/subjects/${o1}/students"`;
    check('T25 faculty notification list shows the request with a roster link',
      notes.status === 200 && notesHtml.includes('Identity verification requested') && notesHtml.includes(rosterHref),
      `status=${notes.status} title=${notesHtml.includes('Identity verification requested')} link=${notesHtml.includes(rosterHref)}`);

    const { data: auditReq } = await admin
      .from('audit_logs')
      .select('metadata')
      .eq('entity_type', 'verification_request')
      .eq('entity_id', fx.s2Id);
    check('T25 request recorded in the audit log',
      (auditReq ?? []).some((row) => row.metadata?.notified === 1),
      `count=${auditReq?.length ?? 0}`);

    // Close the loop with the existing faculty action (T19's path).
    const verify = await callAction({ cookie: facultyCookie, actionId: ACT.verifyStudent, pathname: facultyPath, args: [o1, fx.s2Id] });
    check('T25 faculty verifies after the request', actionSucceeded(verify.text), actionError(verify.text) ?? `status=${verify.status}`);
    const { data: final } = await admin.from('student_profiles').select('verification_status').eq('user_id', fx.s2Id).single();
    check('T25 DB: student verified — exam gate unlocked', final?.verification_status === 'verified', String(final?.verification_status));
  }

  // T26 — exam eligibility gate (scope §39: unpublished/early exams stay
  // inaccessible; the start endpoint never serves anonymous callers).
  {
    const assessment = await admin
      .from('assessments')
      .insert({
        subject_offering_id: o1,
        title: `E2E Eligibility ${SHORT}`,
        status: 'published',
        created_by: fx.facultyId,
      })
      .select('id')
      .single();
    if (assessment.error) throw new Error(`eligibility assessment: ${assessment.error.message}`);
    const version = await admin
      .from('assessment_versions')
      .insert({
        assessment_id: assessment.data.id,
        version_number: 1,
        status: 'published',
        total_items: 0,
        total_points: 0,
      })
      .select('id')
      .single();
    if (version.error) throw new Error(`eligibility version: ${version.error.message}`);

    fx.exam = {
      assessmentId: assessment.data.id,
      versionId: version.data.id,
      deploymentIds: [],
      depEarly: null,
      depDraft: null,
      depClosed: null,
      depOpen: null,
      mkDeployment: null,
    };

    const mkDeployment = async (values) => {
      const { data, error } = await admin
        .from('assessment_deployments')
        .insert({
          assessment_id: fx.exam.assessmentId,
          assessment_version_id: fx.exam.versionId,
          subject_offering_id: o1,
          duration_minutes: 30,
          attempt_limit: 1,
          question_order_mode: 'fixed',
          choice_order_mode: 'fixed',
          score_release_mode: 'immediate',
          requires_identity_verification: false,
          created_by: fx.facultyId,
          ...values,
        })
        .select('id')
        .single();
      if (error) throw new Error(`deployment insert: ${error.message}`);
      fx.exam.deploymentIds.push(data.id);
      return data.id;
    };
    fx.exam.mkDeployment = mkDeployment;

    fx.exam.depEarly = await mkDeployment({
      opens_at: new Date(Date.now() + 3_600_000).toISOString(),
      closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      status: 'active',
    });
    fx.exam.depDraft = await mkDeployment({
      opens_at: new Date(Date.now() + 3_600_000).toISOString(),
      closes_at: new Date(Date.now() + 7_200_000).toISOString(),
      status: 'draft',
    });
    fx.exam.depClosed = await mkDeployment({
      opens_at: new Date(Date.now() - 7_200_000).toISOString(),
      closes_at: new Date(Date.now() - 3_600_000).toISOString(),
      status: 'active',
    });

    const { cookie: s1Cookie } = await signIn(fx.s1Email, fx.password);

    const anon = await postJson('/api/exam/start', null, { deploymentId: fx.exam.depEarly });
    check('T26 anonymous POST /api/exam/start is refused (401)',
      anon.status === 401, `status=${anon.status}`);

    const early = await postJson('/api/exam/start', s1Cookie, { deploymentId: fx.exam.depEarly });
    check('T26 exam that has not opened yet is refused (403)',
      early.status === 403 && early.json?.error === 'Assessment is not currently available',
      `status=${early.status} error=${early.json?.error}`);

    const draft = await postJson('/api/exam/start', s1Cookie, { deploymentId: fx.exam.depDraft });
    // Either gate is a pass: RLS may hide draft deployments from students
    // entirely (404) before the app's status check runs (403) — the
    // unpublished paper is unreachable both ways.
    check('T26 unpublished (draft) deployment is refused (403/404)',
      (draft.status === 403 && draft.json?.error === 'Assessment is not currently available') ||
        draft.status === 404,
      `status=${draft.status} error=${draft.json?.error}`);

    const { count: refusedAttempts } = await admin
      .from('exam_attempts')
      .select('id', { count: 'exact', head: true })
      .in('deployment_id', [fx.exam.depEarly, fx.exam.depDraft]);
    check('T26 refusals created no attempt rows', refusedAttempts === 0, `count=${refusedAttempts}`);
  }

  // T27 — client clock cannot extend eligibility (scope §39): the SERVER's
  // clock is already past closes_at and attempts cannot be forged around
  // the gate with direct PostgREST writes.
  {
    const { cookie: s1Cookie } = await signIn(fx.s1Email, fx.password);

    // The sweep may already have flipped the status to `closed`; the status
    // branch and the window branch refuse with the same message.
    const closed = await postJson('/api/exam/start', s1Cookie, { deploymentId: fx.exam.depClosed });
    check('T27 start refused after closes_at — client clock cannot extend eligibility',
      closed.status === 403 && closed.json?.error === 'Assessment is not currently available',
      `status=${closed.status} error=${closed.json?.error}`);

    const { client: s1Client } = await signIn(fx.s1Email, fx.password);
    const forge = await s1Client
      .from('exam_attempts')
      .insert({
        deployment_id: fx.exam.depClosed,
        student_id: fx.s1Id,
        attempt_number: 1,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 1_800_000).toISOString(),
        assessment_version_id: fx.exam.versionId,
      })
      .select('id');
    const forgeCode = forge.error?.code ?? null;
    const forged = (forge.data ?? []).length;
    check('T27 attempt cannot be forged past the gate (INSERT REVOKE\u2019d)',
      forgeCode === '42501' || (forgeCode === null && forged === 0),
      forgeCode ? `error ${forgeCode}` : `${forged} rows inserted`);
  }

  // T28 — faculty notification events on submission (scope §32): responses
  // requiring manual review, and submission progress once every enrolled
  // student has submitted. Exercises the real submit action end-to-end.
  {
    const question = await admin
      .from('questions')
      .insert({
        assessment_version_id: fx.exam.versionId,
        question_type: 'identification',
        question_text: 'E2E manual-review probe?',
        points: 1,
        position: 0,
        created_by: fx.facultyId,
      })
      .select('id')
      .single();
    if (question.error) throw new Error(`review question: ${question.error.message}`);

    const depOpen = await fx.exam.mkDeployment({
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: 'active',
    });

    // One in-progress attempt for every student currently enrolled in o1.
    const { data: enrolledRows } = await admin
      .from('enrollments')
      .select('student_id')
      .eq('subject_offering_id', o1)
      .eq('status', 'enrolled');
    const enrolledIds = (enrolledRows ?? []).map((r) => r.student_id);
    check('T28 enrollment fixture ready for the submission round', enrolledIds.length >= 2,
      `enrolled=${enrolledIds.length}`);

    const attemptByStudent = {};
    for (const studentId of enrolledIds) {
      const attempt = await admin
        .from('exam_attempts')
        .insert({
          deployment_id: depOpen,
          student_id: studentId,
          attempt_number: 1,
          status: 'in_progress',
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 1_800_000).toISOString(),
          assessment_version_id: fx.exam.versionId,
        })
        .select('id')
        .single();
      if (attempt.error) throw new Error(`open attempt: ${attempt.error.message}`);
      attemptByStudent[studentId] = attempt.data.id;
    }

    // student1 has an identification response that matches nothing → scored
    // zero → "responses requiring manual review" after submission.
    await admin.from('student_responses').insert({
      attempt_id: attemptByStudent[fx.s1Id],
      question_id: question.data.id,
      text_answer: 'review me',
    });

    const accountsById = {
      [fx.s1Id]: fx.s1Email,
      [fx.s2Id]: fx.s2Email,
      [fx.s3Id]: fx.s3Email,
    };

    const first = await callAction({
      cookie: (await signIn(fx.s1Email, fx.password)).cookie,
      actionId: ACT.submitExam,
      pathname: `/student/assessments/${fx.exam.assessmentId}/exam/${attemptByStudent[fx.s1Id]}`,
      args: [attemptByStudent[fx.s1Id]],
    });
    check('T28 first submit succeeds',
      /"success"\s*:\s*true/.test(first.text),
      actionError(first.text) ?? `status=${first.status}`);

    const { data: reviewNotes } = await admin
      .from('notifications')
      .select('id, data')
      .eq('user_id', fx.facultyId)
      .eq('type', 'review_required')
      .contains('data', { attempt_id: attemptByStudent[fx.s1Id] });
    check('T28 manual-review notification reaches the faculty',
      (reviewNotes ?? []).length === 1,
      `count=${reviewNotes?.length ?? 0}`);

    const progressAfterFirst = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', fx.facultyId)
      .eq('type', 'submission_progress')
      .contains('data', { deployment_id: depOpen });
    check('T28 no all-submitted event before everyone submits',
      (progressAfterFirst.count ?? 0) === 0,
      `count=${progressAfterFirst.count ?? 0}`);

    for (const studentId of enrolledIds.filter((id) => id !== fx.s1Id)) {
      const res = await callAction({
        cookie: (await signIn(accountsById[studentId], fx.password)).cookie,
        actionId: ACT.submitExam,
        pathname: `/student/assessments/${fx.exam.assessmentId}/exam/${attemptByStudent[studentId]}`,
        args: [attemptByStudent[studentId]],
      });
      check(`T28 submit succeeds for ${accountsById[studentId]}`,
        /"success"\s*:\s*true/.test(res.text),
        actionError(res.text) ?? `status=${res.status}`);
    }

    const { data: progressNotes } = await admin
      .from('notifications')
      .select('id, data')
      .eq('user_id', fx.facultyId)
      .eq('type', 'submission_progress')
      .contains('data', { deployment_id: depOpen });
    check('T28 submission-progress event fires once all enrolled students submitted',
      (progressNotes ?? []).length === 1,
      `count=${progressNotes?.length ?? 0}`);

    const facultyNotes = await getPage('/notifications', (await signIn(fx.facultyEmail, fx.password)).cookie);
    const facultyNotesHtml = facultyNotes.html.replace(/<!--.*?-->/g, '');
    check('T28 faculty notification list renders the submission events',
      facultyNotes.status === 200 &&
        facultyNotesHtml.includes('Responses need review') &&
        facultyNotesHtml.includes('All submissions received'),
      `status=${facultyNotes.status} review=${facultyNotesHtml.includes('Responses need review')} progress=${facultyNotesHtml.includes('All submissions received')}`);
  }

  // T29 — generation job state machine (WP-4): terminal transitions run
  // through server actions scoped to the requester, are one-way (a failed
  // row can never regress), and feed the dashboard's failed-jobs filter.
  {
    const mkJob = async (requestedBy = fx.facultyId) => {
      const { data, error } = await admin
        .from('assessment_generation_jobs')
        .insert({
          assessment_id: fx.exam.assessmentId,
          requested_by: requestedBy,
          operation: 'generate_questions',
          status: 'queued',
        })
        .select('id')
        .single();
      if (error) throw new Error(`generation job insert: ${error.message}`);
      return data.id;
    };
    const readJob = async (jobId) => {
      const { data, error } = await admin
        .from('assessment_generation_jobs')
        .select('status, error_message, result_metadata')
        .eq('id', jobId)
        .single();
      if (error) throw new Error(`generation job read: ${error.message}`);
      return data;
    };

    const facultyCookie = (await signIn(fx.facultyEmail, fx.password)).cookie;

    // queued → completed, carrying the batch summary.
    const jobDone = await mkJob();
    const done = await callAction({
      cookie: facultyCookie,
      actionId: ACT.completeJob,
      pathname: facultyPath,
      args: [jobDone, { generated: 5, failed: 1, requested: 6 }],
    });
    check('T29 completeGenerationJob finalizes the batch as completed',
      /"success"\s*:\s*true/.test(done.text),
      actionError(done.text) ?? `status=${done.status}`);
    const doneRow = await readJob(jobDone);
    check('T29 completed row carries the outcome summary',
      doneRow.status === 'completed' &&
        doneRow.result_metadata?.questions_generated === 5 &&
        doneRow.result_metadata?.questions_failed === 1,
      `status=${doneRow.status} meta=${JSON.stringify(doneRow.result_metadata ?? null)}`);

    // queued → failed, with the reason (the dashboard queries status='failed').
    const jobFailed = await mkJob();
    const failedRun = await callAction({
      cookie: facultyCookie,
      actionId: ACT.failJob,
      pathname: facultyPath,
      args: [jobFailed, 'provider exploded (test)'],
    });
    check('T29 failGenerationJob records the failure reason',
      /"success"\s*:\s*true/.test(failedRun.text),
      actionError(failedRun.text) ?? `status=${failedRun.status}`);
    const failedRow = await readJob(jobFailed);
    check('T29 failed row matches the dashboard failed-jobs filter',
      failedRow.status === 'failed' &&
        /provider exploded/.test(failedRow.error_message ?? ''),
      `status=${failedRow.status} err=${(failedRow.error_message ?? '').slice(0, 60)}`);

    // Terminal states are one-way.
    const regress = await callAction({
      cookie: facultyCookie,
      actionId: ACT.completeJob,
      pathname: facultyPath,
      args: [jobFailed, { generated: 1, failed: 0, requested: 1 }],
    });
    check('T29 a failed job cannot be regressed to completed',
      /"success"\s*:\s*false/.test(regress.text),
      regress.text.slice(0, 160));
    const stillFailed = await readJob(jobFailed);
    check('T29 status stays failed after the rejected transition',
      stillFailed.status === 'failed',
      `status=${stillFailed.status}`);

    // Transitions are scoped to the requester: someone else's queued job
    // is untouchable even for assigned faculty.
    const jobForeign = await mkJob(fx.s1Id);
    const foreign = await callAction({
      cookie: facultyCookie,
      actionId: ACT.completeJob,
      pathname: facultyPath,
      args: [jobForeign, { generated: 1, failed: 0, requested: 1 }],
    });
    check('T29 a job can only be finalized by the user who requested it',
      /"success"\s*:\s*false/.test(foreign.text),
      foreign.text.slice(0, 160));
    const stillQueued = await readJob(jobForeign);
    check('T29 the foreign job stays queued',
      stillQueued.status === 'queued',
      `status=${stillQueued.status}`);
  }

  // T30 — identification scoring tiers (scope §26) and result propagation
  // (§27): exact / approved-alias / fuzzy>=0.9 answers auto-score with
  // evidence in scoring_metadata, the uncertain fuzzy band is held with NULL
  // points, a faculty confirmation rewrites the attempt total, re-scoring
  // never overwrites a faculty decision, and the metadata column stays
  // service-role only.
  {
    let nextPosition = 50;
    const mkIdQ = async (text, canonical, accepted = []) => {
      const q = await admin
        .from('questions')
        .insert({
          assessment_version_id: fx.exam.versionId,
          question_type: 'identification',
          question_text: text,
          points: 1,
          position: nextPosition++,
          created_by: fx.facultyId,
        })
        .select('id')
        .single();
      if (q.error) throw new Error(`T30 question: ${q.error.message}`);
      const k = await admin
        .from('answer_keys')
        .insert({
          question_id: q.data.id,
          canonical_answer: canonical,
          accepted_answers: accepted,
        })
        .select('id')
        .single();
      if (k.error) throw new Error(`T30 answer key: ${k.error.message}`);
      return q.data.id;
    };

    const qExact = await mkIdQ('T30 boundary of the cell?', 'cell membrane');
    const qAlias = await mkIdQ('T30 smooth ER abbreviation?', 'smooth endoplasmic reticulum', ['SER']);
    const qFuzzy = await mkIdQ('T30 stacked-sacs organelle?', 'golgi apparatus');
    const qHeld = await mkIdQ('T30 control center of the cell?', 'nucleus');
    const qWrong = await mkIdQ('T30 energy converter?', 'mitochondria');

    const depT30 = await fx.exam.mkDeployment({
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: 'active',
    });

    const attempt = await admin
      .from('exam_attempts')
      .insert({
        deployment_id: depT30,
        student_id: fx.s1Id,
        attempt_number: 1,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 1_800_000).toISOString(),
        assessment_version_id: fx.exam.versionId,
      })
      .select('id')
      .single();
    if (attempt.error) throw new Error(`T30 attempt: ${attempt.error.message}`);
    const attemptId = attempt.data.id;

    const resp = {};
    for (const [key, questionId, textAnswer] of [
      ['exact', qExact, '  Cell   Membrane! '], // folds to "cell membrane"
      ['alias', qAlias, 'SER'],                  // approved alternative answer
      ['fuzzyHigh', qFuzzy, 'golgi appratus'],   // 1 insertion → 0.93 >= 0.9
      ['held', qHeld, 'nucelus'],                // transposition → ~0.71 band
      ['wrong', qWrong, 'ribosome'],             // far from the key → < 0.6
    ]) {
      const r = await admin
        .from('student_responses')
        .insert({ attempt_id: attemptId, question_id: questionId, text_answer: textAnswer })
        .select('id')
        .single();
      if (r.error) throw new Error(`T30 response(${key}): ${r.error.message}`);
      resp[key] = r.data.id;
    }

    const submitted = await callAction({
      cookie: (await signIn(fx.s1Email, fx.password)).cookie,
      actionId: ACT.submitExam,
      pathname: `/student/assessments/${fx.exam.assessmentId}/exam/${attemptId}`,
      args: [attemptId],
    });
    check('T30 submit succeeds', /"success"\s*:\s*true/.test(submitted.text),
      actionError(submitted.text) ?? `status=${submitted.status}`);

    const readResp = async (key) => {
      const { data, error } = await admin
        .from('student_responses')
        .select('earned_points, scoring_status, scoring_metadata, normalized_answer, scored_by')
        .eq('id', resp[key])
        .single();
      if (error) throw new Error(`T30 read(${key}): ${error.message}`);
      return data;
    };

    const exact = await readResp('exact');
    check('T30 exact match auto-scores full points with normalized answer written',
      exact.earned_points === 1 && exact.scoring_status === 'auto_scored' &&
        exact.scoring_metadata?.method === 'exact' &&
        exact.normalized_answer === 'cell membrane',
      `points=${exact.earned_points} status=${exact.scoring_status} norm=${exact.normalized_answer} meta=${JSON.stringify(exact.scoring_metadata)}`);

    const alias = await readResp('alias');
    check('T30 approved alias auto-scores full points',
      alias.earned_points === 1 && alias.scoring_status === 'auto_scored' &&
        alias.scoring_metadata?.method === 'alias' &&
        alias.scoring_metadata?.candidate === 'SER',
      `points=${alias.earned_points} status=${alias.scoring_status} meta=${JSON.stringify(alias.scoring_metadata)}`);

    const fuzzyHigh = await readResp('fuzzyHigh');
    check('T30 fuzzy similarity >= 0.9 auto-scores correct with evidence',
      fuzzyHigh.earned_points === 1 && fuzzyHigh.scoring_status === 'auto_scored' &&
        fuzzyHigh.scoring_metadata?.method === 'fuzzy' &&
        (fuzzyHigh.scoring_metadata?.similarity ?? 0) >= 0.9,
      `points=${fuzzyHigh.earned_points} meta=${JSON.stringify(fuzzyHigh.scoring_metadata)}`);

    const held = await readResp('held');
    check('T30 uncertain fuzzy band is held with NULL points for faculty',
      held.earned_points === null && held.scoring_status === 'manual_review' &&
        held.scoring_metadata?.method === 'fuzzy' &&
        held.scoring_metadata?.similarity >= 0.6 &&
        held.scoring_metadata?.similarity < 0.9,
      `points=${held.earned_points} status=${held.scoring_status} meta=${JSON.stringify(held.scoring_metadata)}`);

    const wrong = await readResp('wrong');
    check('T30 below-floor answer auto-scores incorrect under 0.6 similarity',
      wrong.earned_points === 0 && wrong.scoring_status === 'auto_scored' &&
        (wrong.scoring_metadata?.similarity ?? 1) < 0.6,
      `points=${wrong.earned_points} status=${wrong.scoring_status} meta=${JSON.stringify(wrong.scoring_metadata)}`);

    // Provisional totals (§27): the held item contributes 0 to raw while its
    // points stay in the possible total.
    const { data: versionQs } = await admin
      .from('questions')
      .select('points')
      .eq('assessment_version_id', fx.exam.versionId);
    const possibleExpected = (versionQs ?? []).reduce((s, q) => s + (q.points ?? 0), 0);
    const { data: resultBefore } = await admin
      .from('assessment_results')
      .select('raw_score, possible_score')
      .eq('attempt_id', attemptId)
      .single();
    check('T30 provisional raw excludes the held item while possible counts it',
      resultBefore?.raw_score === 3 && resultBefore?.possible_score === possibleExpected,
      `raw=${resultBefore?.raw_score} possible=${resultBefore?.possible_score} expected=${possibleExpected}`);

    // Held + zero-scored answers raise the faculty review notification (§32).
    const { data: t30Notes } = await admin
      .from('notifications')
      .select('id')
      .eq('user_id', fx.facultyId)
      .eq('type', 'review_required')
      .contains('data', { attempt_id: attemptId });
    check('T30 held and wrong answers notify the faculty for review',
      (t30Notes ?? []).length === 1, `count=${t30Notes?.length ?? 0}`);

    // Review-queue membership: held + zero-scored in, auto-scored correct out.
    const facultyCookie = (await signIn(fx.facultyEmail, fx.password)).cookie;
    const queue = await callAction({
      cookie: facultyCookie,
      actionId: ACT.reviewQueue,
      pathname: facultyPath,
      args: [fx.exam.assessmentId],
    });
    check('T30 review queue contains the held and zero-scored responses',
      queue.text.includes(resp.held) && queue.text.includes(resp.wrong),
      `held=${queue.text.includes(resp.held)} wrong=${queue.text.includes(resp.wrong)}`);
    check('T30 review queue excludes auto-scored correct responses',
      !queue.text.includes(resp.exact) && !queue.text.includes(resp.alias) &&
        !queue.text.includes(resp.fuzzyHigh),
      `exact=${queue.text.includes(resp.exact)} alias=${queue.text.includes(resp.alias)} fuzzy=${queue.text.includes(resp.fuzzyHigh)}`);

    // Faculty confirms the held item → response AND attempt total update (§27).
    const confirm = await callAction({
      cookie: facultyCookie,
      actionId: ACT.scoreResponse,
      pathname: facultyPath,
      args: [resp.held, 1],
    });
    check('T30 faculty confirmation saves the held response',
      /"success"\s*:\s*true/.test(confirm.text),
      actionError(confirm.text) ?? confirm.text.slice(0, 160));

    const after = await readResp('held');
    check('T30 confirmation records faculty provenance over the machine verdict',
      after.earned_points === 1 && after.scoring_status === 'scored' &&
        after.scored_by === fx.facultyId &&
        after.scoring_metadata?.method === 'fuzzy' &&
        after.scoring_metadata?.faculty?.points === 1,
      `points=${after.earned_points} status=${after.scoring_status} by=${after.scored_by} meta=${JSON.stringify(after.scoring_metadata)}`);

    const { data: resultAfter } = await admin
      .from('assessment_results')
      .select('raw_score')
      .eq('attempt_id', attemptId)
      .single();
    check('T30 faculty confirmation propagates to the attempt total',
      resultAfter?.raw_score === 4,
      `raw=${resultAfter?.raw_score} (was ${resultBefore?.raw_score})`);

    // The score route re-runs scoreAttempt: a faculty decision must survive.
    const { cookie: s1Cookie } = await signIn(fx.s1Email, fx.password);
    const rescore = await postJson('/api/exam/score', s1Cookie, { attemptId });
    check('T30 score route re-runs without error',
      rescore.status === 200 && rescore.json?.success === true,
      `status=${rescore.status} error=${rescore.json?.error}`);
    const afterRoute = await readResp('held');
    check('T30 re-scoring never overwrites a faculty decision',
      afterRoute.earned_points === 1 && afterRoute.scoring_status === 'scored' &&
        afterRoute.scored_by === fx.facultyId,
      `points=${afterRoute.earned_points} status=${afterRoute.scoring_status} by=${afterRoute.scored_by}`);
    const { data: resultFinal } = await admin
      .from('assessment_results')
      .select('raw_score')
      .eq('attempt_id', attemptId)
      .single();
    check('T30 attempt total unchanged after re-score',
      resultFinal?.raw_score === 4, `raw=${resultFinal?.raw_score}`);

    // scoring_metadata is service-role only (column-level revokes).
    const { client: s1Client } = await signIn(fx.s1Email, fx.password);
    const leak = await s1Client
      .from('student_responses')
      .select('scoring_metadata')
      .eq('id', resp.held);
    check('T30 scoring_metadata is unreadable to students (42501)',
      leak.error?.code === '42501',
      `error=${leak.error?.code ?? 'no error'} data=${JSON.stringify(leak.data ?? null)}`);

    // ---- T31 — AI score recommendation (scope §26, advisory only) ---------
    // The AI recommends; only scoreIdentificationResponse ever writes points.
    // Runs a REAL provider call (GROQ_API_KEY is configured in .env.local).

    // (a) Students are refused by the gates before any answer key or AI call.
    const denied = await callAction({
      cookie: s1Cookie,
      actionId: ACT.recommend,
      pathname: facultyPath,
      args: [resp.wrong],
    });
    const deniedErr = actionError(denied.text);
    check('T31 student cannot request an AI recommendation',
      ['Not authorized', 'Deployment not found', 'Response not found'].includes(deniedErr ?? ''),
      `error=${deniedErr ?? 'no error'}`);

    // (b) Faculty get a recommendation; the score itself must be untouched.
    const rec = await callAction({
      cookie: facultyCookie,
      actionId: ACT.recommend,
      pathname: facultyPath,
      args: [resp.wrong],
    });
    const recError = actionError(rec.text);
    check('T31 faculty gets an AI recommendation (real provider call)',
      /"success"\s*:\s*true/.test(rec.text),
      recError ?? `status=${rec.status} text=${rec.text.slice(0, 200)}`);

    const recRow = await admin
      .from('student_responses')
      .select('earned_points, scoring_status, scoring_metadata')
      .eq('id', resp.wrong)
      .single();
    if (recRow.error) throw new Error(`T31 read: ${recRow.error.message}`);
    const ai = recRow.data.scoring_metadata?.ai ?? null;
    check('T31 recommendation stored as advisory metadata — score untouched',
      recRow.data.earned_points === 0 &&
        recRow.data.scoring_status === 'auto_scored' &&
        ai !== null &&
        ['correct', 'incorrect', 'uncertain'].includes(ai.verdict) &&
        typeof ai.confidence === 'number' &&
        ai.confidence >= 0 &&
        ai.confidence <= 1 &&
        typeof ai.rationale === 'string' &&
        typeof ai.provider === 'string' &&
        typeof ai.model === 'string' &&
        ai.requested_by === fx.facultyId,
      `points=${recRow.data.earned_points} status=${recRow.data.scoring_status} ai=${JSON.stringify(ai)}`);

    check('T31 machine verdict evidence survives the metadata merge',
      recRow.data.scoring_metadata?.method === 'fuzzy' &&
        typeof recRow.data.scoring_metadata?.similarity === 'number',
      `meta=${JSON.stringify(recRow.data.scoring_metadata)}`);

    // (c) The response carries verdict + a suggested-points value consistent
    // with it (correct → full points, incorrect → 0, uncertain → null).
    const verdictInText = rec.text.match(/"verdict"\s*:\s*"(correct|incorrect|uncertain)"/)?.[1] ?? null;
    const suggestedInText = rec.text.match(/"suggestedPoints"\s*:\s*(null|\d+)/)?.[1] ?? null;
    const expectedSuggested =
      ai?.verdict === 'correct' ? '1' : ai?.verdict === 'incorrect' ? '0' : 'null';
    check('T31 response verdict matches the stored note and suggested points',
      verdictInText !== null && verdictInText === ai?.verdict && suggestedInText === expectedSuggested,
      `text=${verdictInText} db=${ai?.verdict} suggested=${suggestedInText} expected=${expectedSuggested}`);

    // (d) The call is metered for the usage dashboard (scope §32/§29 hooks).
    const { data: usageRows } = await admin
      .from('ai_usage_logs')
      .select('id, status, provider, model')
      .eq('user_id', fx.facultyId)
      .eq('operation', 'score_recommendation');
    check('T31 recommendation is logged once in ai_usage_logs as success',
      (usageRows ?? []).length === 1 && usageRows[0].status === 'success',
      `count=${usageRows?.length ?? 0} status=${usageRows?.[0]?.status} provider=${usageRows?.[0]?.provider}`);

    // ---- T32 — Table of Specifications (scope §10) -------------------------
    // AI proposal → manual-style validation rows → approval snapshots the TOS
    // onto the version → the next version carries it forward (scope §17).
    const tosTopicInsert = await admin
      .from('topics')
      .insert([
        { subject_id: fx.subjectIds[0], title: 'T32 Cell Biology', created_by: fx.facultyId },
        { subject_id: fx.subjectIds[0], title: 'T32 Genetics', created_by: fx.facultyId },
      ])
      .select('title');
    if (tosTopicInsert.error) throw new Error(`T32 topics: ${tosTopicInsert.error.message}`);
    const allowedTosTopics = (tosTopicInsert.data ?? []).map((t) => t.title);

    const tosArgs = {
      offeringId: fx.offeringIds[0],
      topics: allowedTosTopics.map((title) => ({ title })),
      countPerType: { multiple_choice: 4, identification: 2, true_false: 0 },
      difficultyDistribution: { easy: 2, moderate: 3, difficult: 1 },
      bloomDistribution: { remember: 1, understand: 2, apply: 1, analyze: 1, evaluate: 1, create: 0 },
      assessmentCategory: 'quiz',
    };

    // (a) Students are refused by requireOfferingFaculty before any AI call.
    const tosDenied = await callAction({
      cookie: s1Cookie,
      actionId: ACT.genTos,
      pathname: facultyPath,
      args: [tosArgs],
      label: 'T32 student generateAssessmentTOS',
    });
    check('T32 student cannot generate a TOS',
      !actionSucceeded(tosDenied.text),
      `status=${tosDenied.status} text=${tosDenied.text.slice(0, 160)}`);

    // (b) Faculty get a proposal (real provider call) whose rows are all
    // usable: allowed topic, canonical enums, positive whole-number counts.
    const tosGen = await callAction({
      cookie: facultyCookie,
      actionId: ACT.genTos,
      pathname: facultyPath,
      args: [tosArgs],
      label: 'T32 faculty generateAssessmentTOS',
    });
    check('T32 faculty gets a TOS proposal (real provider call)',
      actionSucceeded(tosGen.text),
      actionError(tosGen.text) ?? `status=${tosGen.status} text=${tosGen.text.slice(0, 200)}`);

    const tosRows = flightValue(tosGen.text, 'rows');
    const tosValidation = flightValue(tosGen.text, 'validation');
    const TOS_ENUMS = {
      question_type: ['multiple_choice', 'identification', 'true_false'],
      difficulty: ['easy', 'moderate', 'difficult'],
      bloom_level: ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'],
    };
    const rowsUsable =
      Array.isArray(tosRows) &&
      tosRows.length > 0 &&
      tosRows.every(
        (r) =>
          allowedTosTopics.includes(r.topic) &&
          TOS_ENUMS.question_type.includes(r.question_type) &&
          TOS_ENUMS.difficulty.includes(r.difficulty) &&
          TOS_ENUMS.bloom_level.includes(r.bloom_level) &&
          Number.isInteger(r.count) &&
          r.count > 0
      );
    check('T32 proposal rows are usable (allowed topics, enums, positive counts)',
      rowsUsable && typeof tosValidation === 'object' && tosValidation !== null,
      `rows=${JSON.stringify(tosRows)?.slice(0, 300)} validation=${JSON.stringify(tosValidation)}`);

    const tosUsage = await admin
      .from('ai_usage_logs')
      .select('id, status, provider')
      .eq('user_id', fx.facultyId)
      .eq('operation', 'generate_tos');
    check('T32 TOS generation is logged once in ai_usage_logs as success',
      (tosUsage.data ?? []).length === 1 && tosUsage.data[0].status === 'success',
      `count=${tosUsage.data?.length ?? 0} status=${tosUsage.data?.[0]?.status} provider=${tosUsage.data?.[0]?.provider}`);

    // (c) approveAssessment snapshots the approved TOS onto the version
    // (scope §10: "preserve the approved TOS with the assessment version").
    const tosAssessment = await admin
      .from('assessments')
      .insert({
        subject_offering_id: fx.offeringIds[0],
        created_by: fx.facultyId,
        title: 'T32 TOS snapshot',
        assessment_type: 'multiple_choice',
        status: 'draft',
      })
      .select('id')
      .single();
    if (tosAssessment.error) throw new Error(`T32 assessment: ${tosAssessment.error.message}`);
    const tosVersion = await admin
      .from('assessment_versions')
      .insert({
        assessment_id: tosAssessment.data.id,
        version_number: 1,
        status: 'draft',
        total_items: 0,
        total_points: 0,
      })
      .select('id')
      .single();
    if (tosVersion.error) throw new Error(`T32 version: ${tosVersion.error.message}`);
    await admin
      .from('assessments')
      .update({ current_version_id: tosVersion.data.id })
      .eq('id', tosAssessment.data.id);

    const plannedRows = [
      { topic: 'T32 Cell Biology', question_type: 'multiple_choice', difficulty: 'moderate', bloom_level: 'understand', count: 3 },
      { topic: 'T32 Genetics', question_type: 'identification', difficulty: 'difficult', bloom_level: 'analyze', count: 2 },
    ];
    const tosApprove = await callAction({
      cookie: facultyCookie,
      actionId: ACT.approve,
      pathname: facultyPath,
      args: [tosAssessment.data.id, { rows: plannedRows }],
      label: 'T32 approveAssessment with TOS',
    });
    check('T32 approval succeeds when an approved TOS is supplied',
      actionSucceeded(tosApprove.text),
      actionError(tosApprove.text) ?? `status=${tosApprove.status} text=${tosApprove.text.slice(0, 200)}`);

    const snap = await admin
      .from('assessment_versions')
      .select('status, approved_by, tos_snapshot')
      .eq('id', tosVersion.data.id)
      .single();
    const snapTos = snap.data?.tos_snapshot ?? null;
    // jsonb does not preserve key order — compare rows field-wise.
    const normRow = (r) => `${r.topic}|${r.question_type}|${r.difficulty}|${r.bloom_level}|${r.count}`;
    const snapRowsOk =
      Array.isArray(snapTos?.rows) &&
      snapTos.rows.length === plannedRows.length &&
      plannedRows.every((p) => snapTos.rows.some((r) => normRow(r) === normRow(p)));
    check('T32 tos_snapshot preserves rows, totals and distributions on the version',
      snap.data?.status === 'approved' &&
        snap.data?.approved_by === fx.facultyId &&
        snapTos?.status === 'approved' &&
        snapTos?.approved_by === fx.facultyId &&
        snapTos?.total_items === 5 &&
        snapRowsOk &&
        snapTos?.distributions?.by_type?.multiple_choice === 3 &&
        snapTos?.distributions?.by_type?.identification === 2 &&
        snapTos?.distributions?.by_topic?.['T32 Cell Biology'] === 3,
      `status=${snap.data?.status} tos=${JSON.stringify(snapTos)?.slice(0, 400)}`);

    // (d) Scope §17: the next version carries the approved TOS forward.
    const newVer = await callAction({
      cookie: facultyCookie,
      actionId: ACT.createNewVersion,
      pathname: facultyPath,
      args: [tosAssessment.data.id],
      label: 'T32 createNewVersion',
    });
    const newVerId = flightValue(newVer.text, 'versionId');
    check('T32 createNewVersion succeeds and returns the new version',
      actionSucceeded(newVer.text) && typeof newVerId === 'string',
      `versionId=${String(newVerId)} text=${newVer.text.slice(0, 200)}`);
    if (typeof newVerId === 'string') {
      const copied = await admin
        .from('assessment_versions')
        .select('version_number, tos_snapshot')
        .eq('id', newVerId)
        .single();
      // Both sides are jsonb round-trips, so stringify comparison is stable.
      check('T32 new version preserves the approved TOS verbatim',
        copied.data?.version_number === 2 &&
          JSON.stringify(copied.data?.tos_snapshot) === JSON.stringify(snapTos),
        `num=${copied.data?.version_number} tos=${JSON.stringify(copied.data?.tos_snapshot)?.slice(0, 200)}`);
    }

    // The throwaway assessment is outside every fixture sweep — remove it.
    await admin.from('assessments').delete().eq('id', tosAssessment.data.id);
    await admin.from('topics').delete().in('title', allowedTosTopics);

    // ---- T33 — AI Modification Assistant (scope §16) -----------------------
    // Propose (real provider call) → faculty-gated apply → locked versions
    // land on a NEW version while the historical one stays untouched (§17).
    const modAssessment = await admin
      .from('assessments')
      .insert({
        subject_offering_id: fx.offeringIds[0],
        created_by: fx.facultyId,
        title: 'T33 AI modification',
        assessment_type: 'multiple_choice',
        status: 'draft',
      })
      .select('id')
      .single();
    if (modAssessment.error) throw new Error(`T33 assessment: ${modAssessment.error.message}`);
    const modVersion = await admin
      .from('assessment_versions')
      .insert({
        assessment_id: modAssessment.data.id,
        version_number: 1,
        status: 'draft',
        total_items: 0,
        total_points: 0,
      })
      .select('id')
      .single();
    if (modVersion.error) throw new Error(`T33 version: ${modVersion.error.message}`);
    await admin
      .from('assessments')
      .update({ current_version_id: modVersion.data.id })
      .eq('id', modAssessment.data.id);

    const modQuestions = await admin
      .from('questions')
      .insert([
        {
          assessment_version_id: modVersion.data.id,
          question_type: 'identification',
          question_text: 'T33 Name the powerhouse of the cell.',
          difficulty: 'easy',
          bloom_level: 'remember',
          points: 1,
          position: 1,
          status: 'active',
          created_by: fx.facultyId,
        },
        {
          assessment_version_id: modVersion.data.id,
          question_type: 'identification',
          question_text: 'T33 Define osmosis.',
          difficulty: 'easy',
          bloom_level: 'remember',
          points: 2,
          position: 2,
          status: 'active',
          created_by: fx.facultyId,
        },
      ])
      .select('id, position');
    if (modQuestions.error) throw new Error(`T33 questions: ${modQuestions.error.message}`);
    const modIds = (modQuestions.data ?? []).map((q) => q.id);
    const modIdSet = new Set(modIds);

    // (a) Proposing is faculty-only.
    const modDenied = await callAction({
      cookie: s1Cookie,
      actionId: ACT.propose,
      pathname: facultyPath,
      args: [modAssessment.data.id, 'Set the difficulty of every question to difficult.'],
      label: 'T33 student propose',
    });
    check('T33 student cannot ask for AI modifications',
      !actionSucceeded(modDenied.text),
      `status=${modDenied.status} text=${modDenied.text.slice(0, 160)}`);

    // (b) Faculty get structured proposals (real provider call): every
    // proposal must target a known question (adds excepted) with usable fields.
    const proposeRes = await callAction({
      cookie: facultyCookie,
      actionId: ACT.propose,
      pathname: facultyPath,
      args: [modAssessment.data.id, 'Set the difficulty of every question to difficult.'],
      label: 'T33 faculty propose',
    });
    const proposals = extractJsonByKey(proposeRes.text, 'proposals');
    const droppedProposals = extractJsonByKey(proposeRes.text, 'dropped');
    const proposalsUsable =
      Array.isArray(proposals) &&
      proposals.length > 0 &&
      proposals.every(
        (p) =>
          (p.op === 'update' || p.op === 'add' || p.op === 'delete') &&
          (p.op === 'add' || modIdSet.has(p.question_id)) &&
          typeof p.fields === 'object' &&
          p.fields !== null &&
          typeof p.rationale === 'string'
      );
    check('T33 faculty gets structured proposals (real provider call)',
      actionSucceeded(proposeRes.text) && proposalsUsable && Array.isArray(droppedProposals),
      `err=${actionError(proposeRes.text) ?? '-'} proposals=${JSON.stringify(proposals)?.slice(0, 400)} dropped=${JSON.stringify(droppedProposals)?.slice(0, 200)}`);

    const proposeUsage = await admin
      .from('ai_usage_logs')
      .select('id, status, provider')
      .eq('user_id', fx.facultyId)
      .eq('operation', 'propose_modification');
    check('T33 proposal is logged once in ai_usage_logs as success',
      (proposeUsage.data ?? []).length === 1 && proposeUsage.data[0].status === 'success',
      `count=${proposeUsage.data?.length ?? 0} status=${proposeUsage.data?.[0]?.status} provider=${proposeUsage.data?.[0]?.provider}`);

    // (c) Applying is faculty-only too.
    const applyDenied = await callAction({
      cookie: s1Cookie,
      actionId: ACT.apply,
      pathname: facultyPath,
      args: [modAssessment.data.id, [{ op: 'delete', question_id: modIds[0], fields: {}, rationale: 'x' }]],
      label: 'T33 student apply',
    });
    check('T33 student cannot apply modifications',
      !actionSucceeded(applyDenied.text),
      `status=${applyDenied.status} text=${applyDenied.text.slice(0, 160)}`);

    // (d) Unlocked version: accepted change lands in place on version 1.
    const firstTarget = modQuestions.data[0];
    const applyRes = await callAction({
      cookie: facultyCookie,
      actionId: ACT.apply,
      pathname: facultyPath,
      args: [
        modAssessment.data.id,
        [{
          op: 'update',
          question_id: firstTarget.id,
          fields: { difficulty: 'difficult', question_text: 'T33 renamed question' },
          rationale: 'e2e apply',
        }],
      ],
      label: 'T33 apply (draft)',
    });
    const appliedCount = flightValue(applyRes.text, 'appliedCount');
    const failedList = flightValue(applyRes.text, 'failed');
    check('T33 apply on a draft version reports one applied change',
      actionSucceeded(applyRes.text) && appliedCount === 1 && Array.isArray(failedList) && failedList.length === 0,
      `applied=${appliedCount} failed=${JSON.stringify(failedList)} err=${actionError(applyRes.text) ?? '-'}`);
    const appliedRow = await admin
      .from('questions')
      .select('difficulty, question_text, assessment_version_id')
      .eq('id', firstTarget.id)
      .single();
    check('T33 applied change is written to the question in place',
      appliedRow.data?.difficulty === 'difficult' &&
        appliedRow.data?.question_text === 'T33 renamed question' &&
        appliedRow.data?.assessment_version_id === modVersion.data.id,
      JSON.stringify(appliedRow.data));

    // (e) Locked (published) version: apply must create a NEW version, apply
    // there, and leave version 1's content untouched.
    await admin.from('assessments').update({ status: 'published' }).eq('id', modAssessment.data.id);
    const secondTarget = modQuestions.data[1];
    const applyLocked = await callAction({
      cookie: facultyCookie,
      actionId: ACT.apply,
      pathname: facultyPath,
      args: [
        modAssessment.data.id,
        [{
          op: 'update',
          question_id: secondTarget.id,
          fields: { question_text: 'T33 v2 second question' },
          rationale: 'e2e locked apply',
        }],
      ],
      label: 'T33 apply (published)',
    });
    check('T33 apply on a published assessment succeeds',
      actionSucceeded(applyLocked.text),
      `${actionError(applyLocked.text) ?? ''} text=${applyLocked.text.slice(0, 240)}`);

    const modVersions = await admin
      .from('assessment_versions')
      .select('id, version_number, status')
      .eq('assessment_id', modAssessment.data.id)
      .order('version_number', { ascending: true });
    const v2 = (modVersions.data ?? []).find((v) => v.version_number === 2);
    const modAfter = await admin
      .from('assessments')
      .select('status, current_version_id')
      .eq('id', modAssessment.data.id)
      .single();
    check('T33 locked apply created version 2 as the current draft',
      (modVersions.data ?? []).length === 2 &&
        !!v2 &&
        modAfter.data?.current_version_id === v2.id &&
        modAfter.data?.status === 'draft',
      `versions=${JSON.stringify(modVersions.data)} assessment=${JSON.stringify(modAfter.data)}`);

    const v2Questions = await admin
      .from('questions')
      .select('id, position, question_text')
      .eq('assessment_version_id', v2?.id ?? '')
      .order('position', { ascending: true });
    const v2First = (v2Questions.data ?? []).find((q) => q.position === 1);
    const v2Second = (v2Questions.data ?? []).find((q) => q.position === 2);
    const v1Second = await admin
      .from('questions')
      .select('id, question_text')
      .eq('id', secondTarget.id)
      .maybeSingle();
    check('T33 new version carries BOTH applied changes under new ids',
      (v2Questions.data ?? []).length === 2 &&
        v2First?.question_text === 'T33 renamed question' &&
        v2Second?.question_text === 'T33 v2 second question' &&
        !!v2First &&
        v2First.id !== firstTarget.id &&
        !!v2Second &&
        v2Second.id !== secondTarget.id,
      `v2=${JSON.stringify(v2Questions.data)}`);
    check('T33 version 1 keeps its historical content untouched',
      v1Second?.data?.question_text === 'T33 Define osmosis.',
      `v1Second=${JSON.stringify(v1Second?.data ?? v1Second)}`);

    // The throwaway is outside every fixture sweep — remove it (logs SET NULL).
    await admin.from('assessments').delete().eq('id', modAssessment.data.id);

    // ---- T34 — Pre-exam quality dashboard (scope §31) ----------------------
    // A throwaway with deliberate defects: identical text on two questions,
    // identical embeddings, one question without a canonical answer, zero
    // source grounding, no approved TOS — every check must report exactly
    // that. (getPreExamQuality returns {data}/{error}, so success is asserted
    // structurally; actionSucceeded only gates the denial.)
    const qAssessment = await admin
      .from('assessments')
      .insert({
        subject_offering_id: fx.offeringIds[0],
        created_by: fx.facultyId,
        title: 'T34 quality checks',
        assessment_type: 'identification',
        status: 'draft',
      })
      .select('id')
      .single();
    if (qAssessment.error) throw new Error(`T34 assessment: ${qAssessment.error.message}`);
    const qVersion = await admin
      .from('assessment_versions')
      .insert({
        assessment_id: qAssessment.data.id,
        version_number: 1,
        status: 'draft',
        total_items: 0,
        total_points: 0,
      })
      .select('id')
      .single();
    if (qVersion.error) throw new Error(`T34 version: ${qVersion.error.message}`);
    await admin
      .from('assessments')
      .update({ current_version_id: qVersion.data.id })
      .eq('id', qAssessment.data.id);

    const emb = Array.from({ length: 384 }, (_, i) => (i % 2 ? 0.1 : 0.9));
    const qRows = await admin
      .from('questions')
      .insert([
        {
          assessment_version_id: qVersion.data.id,
          question_type: 'identification',
          question_text: 'T34 Name the powerhouse of the cell.',
          difficulty: 'easy',
          bloom_level: 'remember',
          points: 1,
          position: 1,
          status: 'active',
          created_by: fx.facultyId,
          embedding: emb,
        },
        {
          assessment_version_id: qVersion.data.id,
          question_type: 'identification',
          question_text: 'T34 Name the powerhouse of the cell.',
          difficulty: 'easy',
          bloom_level: 'understand',
          points: 1,
          position: 2,
          status: 'active',
          created_by: fx.facultyId,
          embedding: emb,
        },
        {
          assessment_version_id: qVersion.data.id,
          question_type: 'identification',
          question_text: 'T34 Define osmosis in one sentence.',
          difficulty: 'difficult',
          bloom_level: 'apply',
          points: 1,
          position: 3,
          status: 'active',
          created_by: fx.facultyId,
        },
      ])
      .select('id, position');
    if (qRows.error) throw new Error(`T34 questions: ${qRows.error.message}`);
    const [t34q1, t34q2, t34q3] = qRows.data;
    // Canonical answers for #1/#2 only — #3 deliberately has none.
    const t34Keys = await admin
      .from('answer_keys')
      .insert([
        { question_id: t34q1.id, canonical_answer: 'mitochondrion' },
        { question_id: t34q2.id, canonical_answer: 'mitochondrion' },
      ])
      .select('id');
    if (t34Keys.error) throw new Error(`T34 answer keys: ${t34Keys.error.message}`);

    const qDenied = await callAction({
      cookie: s1Cookie,
      actionId: ACT.quality,
      pathname: facultyPath,
      args: [qAssessment.data.id],
      label: 'T34 student quality',
    });
    check('T34 student cannot read the quality report',
      !actionSucceeded(qDenied.text),
      `status=${qDenied.status}`);

    const qRes = await callAction({
      cookie: facultyCookie,
      actionId: ACT.quality,
      pathname: facultyPath,
      args: [qAssessment.data.id],
      label: 'T34 quality report',
    });
    const issues34 = extractJsonByKey(qRes.text, 'validation_issues');
    const dups34 = extractJsonByKey(qRes.text, 'duplicates');
    const semFlags34 = extractJsonByKey(qRes.text, 'semantic_flags');
    const grounding34 = extractJsonByKey(qRes.text, 'grounding');
    const tos34 = extractJsonByKey(qRes.text, 'tos');
    const dists34 = extractJsonByKey(qRes.text, 'distributions');

    check('T34 report runs for faculty and counts the questions',
      flightValue(qRes.text, 'question_count') === 3,
      `count=${flightValue(qRes.text, 'question_count')} err=${actionError(qRes.text) ?? '-'} text=${qRes.text.slice(0, 200)}`);
    check('T34 validation flags exactly the question without a canonical answer',
      Array.isArray(issues34) &&
        issues34.length === 1 &&
        issues34[0].question_id === t34q3.id &&
        String(issues34[0].issues).includes('canonical'),
      JSON.stringify(issues34));
    check('T34 exact duplicates pair the identical texts',
      Array.isArray(dups34) &&
        dups34.length === 1 &&
        dups34[0].question_ids.length === 2 &&
        dups34[0].question_ids.includes(t34q1.id) &&
        dups34[0].question_ids.includes(t34q2.id),
      JSON.stringify(dups34));
    check('T34 semantic flag pairs the identical embeddings (threshold-applied)',
      Array.isArray(semFlags34) &&
        semFlags34.length === 1 &&
        semFlags34[0].score >= 0.9 &&
        flightValue(qRes.text, 'embedded_count') === 2,
      `flags=${JSON.stringify(semFlags34)} embedded=${flightValue(qRes.text, 'embedded_count')}`);
    check('T34 grounding reports 0 of 3 and no TOS is approved yet',
      grounding34?.grounded === 0 &&
        grounding34?.total === 3 &&
        grounding34?.percentage === 0 &&
        tos34?.approved === false &&
        tos34?.actual_items === 3,
      `grounding=${JSON.stringify(grounding34)} tos=${JSON.stringify(tos34)}`);
    check('T34 distributions match the fixture (difficulty + type)',
      Array.isArray(dists34?.difficulty) &&
        dists34.difficulty.length === 2 &&
        dists34.difficulty.some(d => d.key === 'easy' && d.count === 2) &&
        dists34.difficulty.some(d => d.key === 'difficult' && d.count === 1) &&
        Array.isArray(dists34?.types) &&
        dists34.types.length === 1 &&
        dists34.types[0].key === 'identification' &&
        dists34.types[0].count === 3,
      JSON.stringify(dists34));

    // The throwaway is outside every fixture sweep — remove it.
    await admin.from('assessments').delete().eq('id', qAssessment.data.id);
  }

  // T35 — Proctoring (scope §42): assignment, monitor access, conclude =
  // submit & score, revocation. Uses a second faculty member so the proctor
  // is somebody who is NOT the offering's own faculty.
  {
    const dep35 = await fx.exam.mkDeployment({
      opens_at: new Date(Date.now() - 60_000).toISOString(),
      closes_at: new Date(Date.now() + 3_600_000).toISOString(),
      status: 'active',
      // Two students each take a second attempt (the selected-conclude
      // fixtures); the enforce_attempt_limit() trigger counts them all.
      attempt_limit: 2,
    });
    const monitorPath = `/faculty/subjects/${o1}/assessments/${fx.exam.assessmentId}/monitor`;

    // The enforce_attempt_limit() trigger normalizes attempt_number to the
    // true next number, so callers only pick the student.
    const mkAttempt35 = async (studentId) => {
      const { data, error } = await admin
        .from('exam_attempts')
        .insert({
          deployment_id: dep35,
          student_id: studentId,
          attempt_number: 1,
          status: 'in_progress',
          started_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 1_800_000).toISOString(),
          assessment_version_id: fx.exam.versionId,
        })
        .select('id')
        .single();
      if (error) throw new Error(`T35 attempt: ${error.message}`);
      return data.id;
    };
    const attemptA = await mkAttempt35(fx.s1Id);
    const attemptB = await mkAttempt35(fx.s2Id);
    const attemptC = await mkAttempt35(fx.s3Id);
    const attemptD = await mkAttempt35(fx.s1Id);
    const attemptE = await mkAttempt35(fx.s2Id);

    const facultyCookie = (await signIn(fx.facultyEmail, fx.password)).cookie;
    const proctorCookie = (await signIn(fx.faculty2Email, fx.password)).cookie;
    const adminCookie = (await signIn(fx.adminEmail, fx.password)).cookie;
    const studentCookie = (await signIn(fx.s2Email, fx.password)).cookie;

    // Before assignment nobody but the offering's faculty reaches the monitor:
    // an unassigned faculty member is bounced to their course list.
    const monBefore = await getPageManual(monitorPath, proctorCookie);
    check('T35 unassigned faculty is bounced away from the live monitor',
      bounceTarget(monBefore).includes('/faculty/subjects'),
      `status=${monBefore.status} bounce=${bounceTarget(monBefore) || '(none)'} hasMonitor=${monBefore.html.includes('Live Exam Monitor')}`);

    // 1. Faculty of the offering assigns the second faculty as proctor.
    const assigned = await callAction({
      cookie: facultyCookie,
      actionId: ACT.assignProctor,
      pathname: monitorPath,
      args: [{ deploymentId: dep35, proctorUserId: fx.faculty2Id }],
      label: 'T35 assignProctor',
    });
    check('T35 faculty assigns a proctor to the deployment',
      /"success"\s*:\s*true/.test(assigned.text),
      actionError(assigned.text) ?? `status=${assigned.status}`);

    const { data: proctorNotes } = await admin
      .from('notifications')
      .select('id, data')
      .eq('user_id', fx.faculty2Id)
      .eq('type', 'proctor_assigned');
    check('T35 the assigned proctor is notified with a monitor deep link',
      (proctorNotes ?? []).length === 1 &&
        proctorNotes[0].data?.assessment_id === fx.exam.assessmentId &&
        proctorNotes[0].data?.proctor === true,
      `count=${proctorNotes?.length ?? 0} data=${JSON.stringify(proctorNotes?.[0]?.data ?? null)}`);

    // 2. Assignment opens the gate: the proctor now reads the live monitor
    //    (RLS proctor policies + the extended page guard), while an admin
    //    WITHOUT a proctor row still gets no exam access (scope §2.1) — they
    //    land on the proctoring page where they can assign one.
    const monProctor = await getPageManual(monitorPath, proctorCookie);
    check('T35 assigned proctor opens the live monitor',
      monProctor.status === 200 && monProctor.html.includes('Live Exam Monitor'),
      `status=${monProctor.status} loc=${monProctor.location}`);

    const monAdmin = await getPageManual(monitorPath, adminCookie);
    check('T35 admin without a proctor row is bounced to the proctoring page',
      bounceTarget(monAdmin).includes('/faculty/proctoring'),
      `status=${monAdmin.status} bounce=${bounceTarget(monAdmin) || '(none)'} hasMonitor=${monAdmin.html.includes('Live Exam Monitor')}`);

    const monStudent = await getPageManual(monitorPath, studentCookie);
    check('T35 student is bounced out of the faculty workspace',
      monStudent.status >= 300 && monStudent.status < 400,
      `status=${monStudent.status} loc=${monStudent.location}`);

    // 3. Assignment management stays with faculty/admin (scope §42): a proctor
    //    can use the monitor but is refused the proctoring-management actions
    //    (the Proctors card is not even rendered for them).
    const listRes = await callAction({
      cookie: proctorCookie,
      actionId: ACT.listProctors,
      pathname: monitorPath,
      args: [dep35],
      label: 'T35 listProctors',
    });
    check('T35 proctor is refused proctor-assignment management',
      Boolean(actionError(listRes.text)?.includes('Not authorized to manage proctors')),
      actionError(listRes.text) ?? `status=${listRes.status}`);

    // 4. Full intervention authority: the proctor concludes one attempt —
    //    submit & score, never invalidated (scope §42).
    const concluded = await callAction({
      cookie: proctorCookie,
      actionId: ACT.concludeAttempt,
      pathname: monitorPath,
      args: [{ attemptId: attemptA, offeringId: o1, assessmentId: fx.exam.assessmentId }],
      label: 'T35 concludeAttempt',
    });
    check('T35 proctor concludes the attempt (submit & score)',
      /"success"\s*:\s*true/.test(concluded.text),
      actionError(concluded.text) ?? `status=${concluded.status}`);

    const { data: attA } = await admin
      .from('exam_attempts')
      .select('status, submitted_at')
      .eq('id', attemptA)
      .single();
    check('T35 concluded attempt is submitted, not invalidated',
      attA?.status === 'submitted' && Boolean(attA?.submitted_at),
      `status=${attA?.status}`);

    const { data: resA } = await admin
      .from('assessment_results')
      .select('id, status')
      .eq('attempt_id', attemptA)
      .maybeSingle();
    check('T35 conclude scores the attempt into a result row',
      resA !== null && resA.status === 'released', // fixture deployment is score_release_mode=immediate
      `result=${JSON.stringify(resA)}`);

    const { data: events35 } = await admin
      .from('exam_events')
      .select('event_type, metadata')
      .eq('attempt_id', attemptA)
      .in('event_type', ['faculty_intervention', 'submission_completed']);
    const intervention = (events35 ?? []).find((e) => e.event_type === 'faculty_intervention');
    check('T35 conclude records the intervention event tagged proctor',
      intervention?.metadata?.action === 'conclude_attempt' &&
        intervention?.metadata?.actor_role === 'proctor' &&
        (events35 ?? []).some((e) => e.event_type === 'submission_completed'),
      JSON.stringify(events35));

    // Idempotency: a second conclude finds no in-progress attempt.
    const again = await callAction({
      cookie: proctorCookie,
      actionId: ACT.concludeAttempt,
      pathname: monitorPath,
      args: [{ attemptId: attemptA, offeringId: o1, assessmentId: fx.exam.assessmentId }],
      label: 'T35 conclude again',
    });
    check('T35 a second conclude is refused (not in progress)',
      /"success"\s*:\s*false/.test(again.text),
      actionError(again.text) ?? `status=${again.status}`);

    // 5. No implicit access (scope §42 / §2.1): an admin without a proctor
    //    row cannot conclude, and the attempt is untouched.
    const denied = await callAction({
      cookie: adminCookie,
      actionId: ACT.concludeAttempt,
      pathname: monitorPath,
      args: [{ attemptId: attemptB, offeringId: o1, assessmentId: fx.exam.assessmentId }],
      label: 'T35 conclude by non-proctor',
    });
    check('T35 an admin without a proctor row cannot conclude',
      /"success"\s*:\s*false/.test(denied.text),
      actionError(denied.text) ?? `status=${denied.status}`);
    const { data: attBPre } = await admin
      .from('exam_attempts')
      .select('status')
      .eq('id', attemptB)
      .single();
    check('T35 the refused conclude left the attempt in progress',
      attBPre?.status === 'in_progress',
      `status=${attBPre?.status}`);

    // 5b. Selected conclude (scope §42): the proctor picks students from the
    //     roster and concludes exactly those — unselected attempts keep
    //     running, and the same submit-&-score pipeline is used.
    const selectedRes = await callAction({
      cookie: proctorCookie,
      actionId: ACT.concludeSelected,
      pathname: monitorPath,
      args: [{
        deploymentId: dep35,
        attemptIds: [attemptB, attemptC],
        offeringId: o1,
        assessmentId: fx.exam.assessmentId,
      }],
      label: 'T35 concludeSelectedAttempts',
    });
    check('T35 proctor concludes the selected attempts',
      /"success"\s*:\s*true/.test(selectedRes.text),
      actionError(selectedRes.text) ?? `status=${selectedRes.status}`);
    check('T35 selected conclude reports both finalized attempts',
      String(flightString(selectedRes.text, 'value') ?? '').includes('2 attempts concluded'),
      `value=${String(flightString(selectedRes.text, 'value') ?? '')}`);

    const { data: selState } = await admin
      .from('exam_attempts')
      .select('id, status')
      .in('id', [attemptB, attemptC, attemptD, attemptE]);
    const selMap = Object.fromEntries((selState ?? []).map((r) => [r.id, r.status]));
    check('T35 selected conclude finalized exactly the chosen attempts',
      selMap[attemptB] === 'submitted' &&
        selMap[attemptC] === 'submitted' &&
        selMap[attemptD] === 'in_progress' &&
        selMap[attemptE] === 'in_progress',
      JSON.stringify(selMap));

    // 5c. The same authority wall as the single conclude: an admin without a
    //     proctor row cannot conclude selected students either, and the
    //     attempt they named is untouched.
    const selDenied = await callAction({
      cookie: adminCookie,
      actionId: ACT.concludeSelected,
      pathname: monitorPath,
      args: [{
        deploymentId: dep35,
        attemptIds: [attemptD],
        offeringId: o1,
        assessmentId: fx.exam.assessmentId,
      }],
      label: 'T35 selected conclude by non-proctor',
    });
    check('T35 an admin without a proctor row cannot conclude selected attempts',
      /"success"\s*:\s*false/.test(selDenied.text),
      actionError(selDenied.text) ?? `status=${selDenied.status}`);
    const { data: attDGuard } = await admin
      .from('exam_attempts')
      .select('status')
      .eq('id', attemptD)
      .single();
    check('T35 the refused selected conclude left the attempt in progress',
      attDGuard?.status === 'in_progress',
      `status=${attDGuard?.status}`);

    // 6. Revocation restores the wall.
    const removed = await callAction({
      cookie: facultyCookie,
      actionId: ACT.removeProctor,
      pathname: monitorPath,
      args: [{ deploymentId: dep35, proctorUserId: fx.faculty2Id }],
      label: 'T35 removeProctor',
    });
    check('T35 faculty revokes the proctor assignment',
      /"success"\s*:\s*true/.test(removed.text),
      actionError(removed.text) ?? `status=${removed.status}`);

    const monAfter = await getPageManual(monitorPath, proctorCookie);
    check('T35 revoked proctor loses the live monitor',
      bounceTarget(monAfter).includes('/faculty/subjects'),
      `status=${monAfter.status} bounce=${bounceTarget(monAfter) || '(none)'} hasMonitor=${monAfter.html.includes('Live Exam Monitor')}`);

    const deniedAfter = await callAction({
      cookie: proctorCookie,
      actionId: ACT.concludeAttempt,
      pathname: monitorPath,
      args: [{ attemptId: attemptB, offeringId: o1, assessmentId: fx.exam.assessmentId }],
      label: 'T35 conclude after revocation',
    });
    check('T35 revoked proctor can no longer conclude',
      /"success"\s*:\s*false/.test(deniedAfter.text),
      actionError(deniedAfter.text) ?? `status=${deniedAfter.status}`);

    // 6b. The offering's faculty keeps the selected conclude after the
    //     proctor's revocation (faculty authority is the offering itself).
    const facSel = await callAction({
      cookie: facultyCookie,
      actionId: ACT.concludeSelected,
      pathname: monitorPath,
      args: [{
        deploymentId: dep35,
        attemptIds: [attemptE],
        offeringId: o1,
        assessmentId: fx.exam.assessmentId,
      }],
      label: 'T35 faculty selected conclude',
    });
    check('T35 faculty concludes a selected attempt',
      /"success"\s*:\s*true/.test(facSel.text),
      actionError(facSel.text) ?? `status=${facSel.status}`);
    const { data: attEDone } = await admin
      .from('exam_attempts')
      .select('status')
      .eq('id', attemptE)
      .single();
    check('T35 faculty selected conclude submitted the attempt',
      attEDone?.status === 'submitted',
      `status=${attEDone?.status}`);

    // 7. Conclude-all from the offering's faculty finalizes everyone left and
    //    closes the window so no new attempt can start.
    const allRes = await callAction({
      cookie: facultyCookie,
      actionId: ACT.concludeAll,
      pathname: monitorPath,
      args: [{
        deploymentId: dep35,
        offeringId: o1,
        assessmentId: fx.exam.assessmentId,
        closeWindow: true,
      }],
      label: 'T35 concludeAllAttempts',
    });
    check('T35 conclude-all succeeds',
      /"success"\s*:\s*true/.test(allRes.text),
      actionError(allRes.text) ?? `status=${allRes.status}`);
    check('T35 conclude-all reports its summary including the window close',
      String(flightString(allRes.text, 'value') ?? '').includes('window closed'),
      `value=${String(flightString(allRes.text, 'value') ?? '')}`);

    const { data: attDRemain } = await admin
      .from('exam_attempts')
      .select('status')
      .eq('id', attemptD)
      .single();
    check('T35 conclude-all finalized the remaining attempt',
      attDRemain?.status === 'submitted',
      `status=${attDRemain?.status}`);

    const { data: depAfter } = await admin
      .from('assessment_deployments')
      .select('status')
      .eq('id', dep35)
      .single();
    check('T35 conclude-all closed the deployment window',
      depAfter?.status === 'closed',
      `status=${depAfter?.status}`);

    const { count: closedNotes } = await admin
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'assessment_closed')
      .contains('data', { deployment_id: dep35 });
    check('T35 closing the window notifies the offering\'s students',
      (closedNotes ?? 0) >= 1,
      `count=${closedNotes ?? 0}`);
  }

  // T36 — student dashboard + profile render (regression guard: the FK-less
  // student_profiles columns made PostgREST fail the program/year-level/section
  // embeds with PGRST200, so every dashboard load threw "Failed to load your
  // academic context." and /profile silently skipped the student block).
  {
    const { cookie: s1PageCookie } = await signIn(fx.s1Email, fx.password);

    const dash = await getPage('/student', s1PageCookie);
    check('T36 student dashboard renders', dash.status === 200, `status=${dash.status}`);
    check('T36 dashboard has no academic-context error',
      !dash.html.includes('Failed to load your academic context'),
      dash.html.includes('Failed to load your academic context') ? 'error marker present' : 'clean');

    const prof = await getPage('/profile', s1PageCookie);
    check('T36 profile renders the student block (embeds resolve)',
      prof.status === 200 && prof.html.includes(fx.s1Number),
      `status=${prof.status} hasStudentNumber=${prof.html.includes(fx.s1Number)}`);
  }
}

// ---------------------------------------------------------------------------

let exitCode = 0;
try {
  await run();
} catch (err) {
  exitCode = 1;
  console.error('\nRUN ERROR:', err);
  check('run completed without exceptions', false, String(err?.message ?? err));
} finally {
  await stopServer();
  try {
    await cleanup();
  } catch (err) {
    console.error('Cleanup error:', err);
  }
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  exitCode = 1;
} else {
  console.log('ALL E2E CHECKS PASSED');
}
process.exit(exitCode);
