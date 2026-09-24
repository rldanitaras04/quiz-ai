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
  createOffering: actionId('createOffering', 'admin/subjects/actions.ts'),
  roster: actionId('getOfferingRoster', 'admin/subjects/actions.ts'),
  setSection: actionId('setStudentSection', 'admin/users/actions.ts'),
};

// ---------------------------------------------------------------------------
// Sessions → cookies (via @supabase/ssr itself, so the format matches exactly)
// ---------------------------------------------------------------------------

async function sessionCookie(email, password) {
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
  return [...jar.entries()].map(([n, v]) => `${n}=${v}`).join('; ');
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

/** The action result JSON is embedded in the flight stream; scan for it. */
function actionSucceeded(text) {
  return /"success"\s*:\s*true/.test(text) || /"summary"\s*:\s*\{/.test(text);
}

function actionError(text) {
  const matches = [...text.matchAll(/"error"\s*:\s*"((?:\\.|[^"\\])*)"/g)].map((m) => m[1]);
  return matches.length > 0 ? matches[matches.length - 1] : null;
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
  adminId: null,
  s1Id: null,
  s2Id: null,
  s3Id: null,
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
  fx.adminId = await createUser(fx.adminEmail, 'E2E Admin');
  fx.s1Id = await createUser(fx.s1Email, 'E2E Student One');
  fx.s2Id = await createUser(fx.s2Email, 'E2E Student Two');
  fx.s3Id = await createUser(fx.s3Email, 'E2E Student Three');

  await admin.from('user_roles').insert([
    { user_id: fx.facultyId, role: 'faculty' },
    { user_id: fx.adminId, role: 'super_admin' },
    { user_id: fx.s1Id, role: 'student' },
    { user_id: fx.s2Id, role: 'student' },
    { user_id: fx.s3Id, role: 'student' },
  ]);
  await admin.from('faculty_profiles').insert({ user_id: fx.facultyId });
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

async function startServer() {
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

function stopServer() {
  if (!server) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(server.pid), '/f', '/t'], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid, 'SIGTERM');
    }
  } catch {
    /* already gone */
  }
  server = null;
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
  stopServer();
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
