/**
 * Playwright UX end-to-end test for the Examination Session & Integrity layer.
 *
 * Exercises the REAL built app in a real browser (requires a fresh
 * `npm run build` first), against real Supabase fixtures:
 *   1. responsive layout — 6 viewports × {Live Monitor, Deploy, Exam Shell},
 *      asserting no horizontal page overflow + screenshots;
 *   2. themes — light / dark / system applied pre-paint (mimo:theme), the
 *      `dark` class + data-theme attribute actually flip, background differs;
 *   3. offline — `context.setOffline()` flips the exam shell into
 *      "Offline — Saved on this Device" and back on reconnect.
 *
 * Browser: system Edge/Chrome via playwright-core (no browser download).
 * Run:  node --env-file=.env.local scripts/e2e-ux.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { chromium } from 'playwright-core';

const PORT = 3213;
const BASE = `http://localhost:${PORT}`;
const SHOT_DIR = path.join('scripts', '.e2e-ux');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Missing Supabase env vars. Run: node --env-file=.env.local scripts/e2e-ux.mjs');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TAG = `e2e-ux-${Date.now()}`;
const PASSWORD = 'E2e-Exam-Pass!123';
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

/** Auth cookies for a real Supabase session (same recipe as e2e-avatar). */
async function sessionCookies(user) {
  const jar = new Map();
  const projectRef = new URL(url).hostname.split('.')[0];
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password: PASSWORD,
  });
  if (error) throw new Error(`signIn(${user.email}): ${error.message}`);

  if (jar.size === 0 && data.session) {
    const key = `sb-${projectRef}-auth-token`;
    const encoded =
      'base64-' + Buffer.from(JSON.stringify(data.session), 'utf8').toString('base64url');
    let chunks;
    try {
      const { createChunks } = await import('@supabase/ssr/dist/main/utils/chunker.js');
      chunks = createChunks(key, encoded);
    } catch {
      chunks = [{ name: key, value: encoded }];
    }
    for (const c of chunks) jar.set(c.name, c.value);
  }
  if (jar.size === 0) throw new Error(`No auth cookies produced for ${user.email}`);
  return [...jar.entries()].map(([name, value]) => ({ name, value }));
}

// ---------------------------------------------------------------------------
// Fixtures (subset of e2e-exam: one faculty, one student, real questions)
// ---------------------------------------------------------------------------

async function createFixtures() {
  const [studentA, facultyF] = await Promise.all([
    createUser('studenta'),
    createUser('facultyf'),
  ]);
  created.studentA = studentA;
  created.facultyF = facultyF;

  const { error: fpErr } = await admin
    .from('faculty_profiles')
    .insert({ user_id: facultyF.id, employee_number: `E2E-${TAG.slice(-8)}-1` });
  if (fpErr) throw new Error(`faculty_profiles insert: ${fpErr.message}`);

  // Roles are assigned by the registration action in the real app; without
  // these rows getPrimaryRole() falls back to 'student' and the faculty
  // layout redirects /faculty/... to /student (which then throws).
  const { error: frRoleErr } = await admin
    .from('user_roles')
    .insert({ user_id: facultyF.id, role: 'faculty' });
  if (frRoleErr) throw new Error(`user_roles insert (faculty): ${frRoleErr.message}`);

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
  const { error: spErr } = await admin.from('student_profiles').insert({
    user_id: studentA.id,
    student_number: `E2E-${TAG.slice(-8)}-1`,
    program_id: ids.program,
    year_level_id: ids.yearLevel,
    section_id: ids.section,
    verification_status: 'verified',
  });
  if (spErr) throw new Error(`student_profiles insert: ${spErr.message}`);
  const { error: stRoleErr } = await admin
    .from('user_roles')
    .insert({ user_id: studentA.id, role: 'student' });
  if (stRoleErr) throw new Error(`user_roles insert (student): ${stRoleErr.message}`);

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
    total_items: 2,
    total_points: 2,
  });

  // Two real multiple-choice questions so the exam shell actually renders.
  ids.q1 = await insertReturning('questions', {
    assessment_version_id: ids.version,
    question_type: 'multiple_choice',
    question_text: 'E2E UX question one?',
    points: 1,
    position: 0,
    created_by: facultyF.id,
  });
  ids.q2 = await insertReturning('questions', {
    assessment_version_id: ids.version,
    question_type: 'multiple_choice',
    question_text: 'E2E UX question two?',
    points: 1,
    position: 1,
    created_by: facultyF.id,
  });
  const c1 = await insertReturning('question_choices', {
    question_id: ids.q1, choice_key: 'A', choice_text: 'Alpha', position: 0,
  });
  const c2 = await insertReturning('question_choices', {
    question_id: ids.q1, choice_key: 'B', choice_text: 'Bravo', position: 1,
  });
  const c3 = await insertReturning('question_choices', {
    question_id: ids.q2, choice_key: 'A', choice_text: 'Charlie', position: 0,
  });
  const c4 = await insertReturning('question_choices', {
    question_id: ids.q2, choice_key: 'B', choice_text: 'Delta', position: 1,
  });
  await insertReturning('answer_keys', { question_id: ids.q1, correct_choice_id: c1 });
  await insertReturning('answer_keys', { question_id: ids.q2, correct_choice_id: c3 });

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
    allow_session_recovery: true,
    require_reverification_on_recovery: false,
    security_response_mode: 'record',
  });

  ids.attemptA = await insertReturning('exam_attempts', {
    deployment_id: ids.deployment,
    student_id: studentA.id,
    attempt_number: 1,
    status: 'in_progress',
    started_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 1_800_000).toISOString(),
    assessment_version_id: ids.version,
  });
  await insertReturning('exam_manifests', {
    attempt_id: ids.attemptA,
    question_order: [ids.q1, ids.q2],
    choice_order: { [ids.q1]: [c1, c2], [ids.q2]: [c3, c4] },
    manifest_hash: 'e2e'.padEnd(64, '0'),
  });
  const session = await admin
    .from('exam_sessions')
    .insert({
      attempt_id: ids.attemptA,
      student_id: studentA.id,
      deployment_id: ids.deployment,
      status: 'active',
      started_at: new Date().toISOString(),
    })
    .select('id');
  if (session.error) throw new Error(`exam_sessions insert: ${session.error.message}`);
  ids.sessionA = session.data.id;

  check('fixtures created (offering, assessment, questions, attempt, session)', true);
}

async function cleanup() {
  const { ids, users } = created;
  await admin.from('exam_events').delete().eq('deployment_id', ids.deployment ?? '');
  await admin.from('exam_sessions').delete().eq('deployment_id', ids.deployment ?? '');
  await admin.from('exam_manifests').delete().eq('attempt_id', ids.attemptA ?? '');
  await admin.from('exam_attempts').delete().eq('deployment_id', ids.deployment ?? '');
  await admin.from('student_responses').delete().eq('attempt_id', ids.attemptA ?? '');
  await admin.from('assessment_deployments').delete().eq('id', ids.deployment ?? '');
  await admin.from('assessments').delete().eq('id', ids.assessment ?? '');
  if (ids.q1) {
    await admin.from('answer_keys').delete().in('question_id', [ids.q1, ids.q2]);
    await admin.from('question_choices').delete().in('question_id', [ids.q1, ids.q2]);
    await admin.from('questions').delete().in('id', [ids.q1, ids.q2]);
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
    await admin.from('user_roles').delete().eq('user_id', userId);
    await admin.from('profiles').delete().eq('id', userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) console.error(`cleanup user ${userId}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Server (same harness as e2e-avatar: requires `npm run build` first)
// ---------------------------------------------------------------------------

let server = null;
let serverLogFd = -1;

async function startServer() {
  const serverLogPath = path.join('scripts', '.e2e-ux-server.log');
  serverLogFd = fs.openSync(serverLogPath, 'w');
  const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next');
  server = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    detached: true,
    stdio: ['ignore', serverLogFd, serverLogFd],
    env: process.env,
  });

  const deadline = Date.now() + 60_000;
  for (;;) {
    if (fs.readFileSync(serverLogPath, 'utf8').includes('EADDRINUSE')) {
      throw new Error(`Port ${PORT} is already in use — kill the stale server first`);
    }
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
// Browser
// ---------------------------------------------------------------------------

async function launchBrowser() {
  const attempts = [
    { channel: 'msedge' },
    { channel: 'chrome' },
    { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
    { executablePath: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
    { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
    { executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
  ];
  const failuresSeen = [];
  for (const opts of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch (err) {
      failuresSeen.push(`${opts.channel ?? opts.executablePath}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(
    'No browser available. Tried: ' + failuresSeen.join(' | ') +
      ' — install one or run `npx playwright install chromium`.'
  );
}

const VIEWPORTS = [
  ['small-phone', 360, 740],
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['laptop', 1024, 768],
  ['desktop', 1440, 900],
  ['large', 1920, 1080],
];

const SURFACES = () => [
  {
    name: 'monitor',
    url: `/faculty/subjects/${created.ids.offering}/assessments/${created.ids.assessment}/monitor`,
    cookies: created.facultyCookies,
    ready: (page) => page.getByText('Live sessions').first().waitFor({ timeout: 20_000 }),
  },
  {
    name: 'deploy',
    url: `/faculty/subjects/${created.ids.offering}/assessments/${created.ids.assessment}/deploy`,
    cookies: created.facultyCookies,
    ready: (page) => page.getByText('Deploy Assessment').first().waitFor({ timeout: 20_000 }),
  },
  {
    name: 'exam',
    url: `/student/assessments/${created.ids.assessment}/exam/${created.ids.attemptA}`,
    cookies: created.studentCookies,
    ready: (page) =>
      page
        .waitForFunction(
          () => {
            const t = document.body.innerText;
            return t.includes('Enter Full-screen') || t.includes('Submit');
          },
          undefined,
          { timeout: 25_000 }
        ),
  },
];

async function bodySnippet(page) {
  try {
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    return text.slice(0, 200);
  } catch {
    return '<no body>';
  }
}

async function newAuthedContext(browser, cookies, opts = {}) {
  const context = await browser.newContext({ baseURL: BASE, ...opts });
  await context.addCookies(cookies.map((c) => ({ ...c, url: BASE })));
  return context;
}

// ---------------------------------------------------------------------------
// 1. Responsive matrix: 6 viewports × 3 surfaces, overflow + screenshots
// ---------------------------------------------------------------------------

async function testResponsive(browser) {
  for (const surface of SURFACES()) {
    const context = await newAuthedContext(browser, surface.cookies);
    const page = await context.newPage();
    for (const [vpName, width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      try {
        await page.goto(surface.url, { waitUntil: 'domcontentloaded' });
        await surface.ready(page);
        const dims = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
        }));
        check(
          `${surface.name} @ ${vpName} (${width}×${height}): no horizontal page overflow`,
          dims.scrollW <= dims.innerW + 2,
          `scrollW=${dims.scrollW} innerW=${dims.innerW}`
        );
        const shot = path.join(SHOT_DIR, `${surface.name}-${vpName}.png`);
        await page.screenshot({ path: shot, fullPage: false });
      } catch (err) {
        const snippet = await bodySnippet(page).catch(() => '<no body>');
        check(
          `${surface.name} @ ${vpName} (${width}×${height}): renders without error`,
          false,
          `${String(err.message).split('\n')[0]} | body: ${snippet}`
        );
      }
    }
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// 2. Themes: light / dark / system, pre-paint (mimo:theme)
// ---------------------------------------------------------------------------

async function testThemes(browser) {
  const themes = ['light', 'dark', 'system'];
  const cases = [
    ['monitor', SURFACES()[0]],
    ['exam', SURFACES()[2]],
  ];
  const backgrounds = {};

  for (const [surfaceName, surface] of cases) {
    for (const theme of themes) {
      const context = await newAuthedContext(browser, surface.cookies, {
        colorScheme: 'dark', // system must resolve to dark under this OS preference
      });
      await context.addInitScript((t) => {
        try {
          window.localStorage.setItem('mimo:theme', t);
        } catch {
          /* ignore */
        }
      }, theme);
      const page = await context.newPage();
      const vp = theme === 'system' ? ['system', 1440, 900] : [theme, 1440, 900];
      await page.setViewportSize({ width: vp[1], height: vp[2] });
      try {
        await page.goto(surface.url, { waitUntil: 'domcontentloaded' });
        await surface.ready(page);
        const state = await page.evaluate(() => ({
          themeAttr: document.documentElement.dataset.theme ?? null,
          darkClass: document.documentElement.classList.contains('dark'),
          bg: getComputedStyle(document.body).backgroundColor,
        }));
        const expectedDark = theme !== 'light'; // dark, and system under colorScheme:dark
        check(
          `${surfaceName} theme=${theme}: data-theme + dark class applied pre-paint`,
          state.themeAttr === theme && state.darkClass === expectedDark,
          `data-theme=${state.themeAttr} dark=${state.darkClass} expected dark=${expectedDark}`
        );
        backgrounds[`${surfaceName}:${theme}`] = state.bg;
        await page.screenshot({ path: path.join(SHOT_DIR, `${surfaceName}-theme-${theme}.png`) });
      } catch (err) {
        check(
          `${surfaceName} theme=${theme}: page renders`,
          false,
          String(err.message).split('\n')[0]
        );
      }
      await context.close();
    }
  }

  // Light and dark must be visually distinct (CSS variables actually switch).
  for (const surfaceName of ['monitor', 'exam']) {
    const light = backgrounds[`${surfaceName}:light`];
    const dark = backgrounds[`${surfaceName}:dark`];
    check(
      `${surfaceName}: light and dark backgrounds differ`,
      Boolean(light && dark && light !== dark),
      `light=${light} dark=${dark}`
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Offline: connectivity loss indicator on the exam shell
// ---------------------------------------------------------------------------

async function testOffline(browser) {
  const surface = SURFACES()[2];
  const context = await newAuthedContext(browser, surface.cookies, { viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(surface.url, { waitUntil: 'domcontentloaded' });
    await surface.ready(page);

    await context.setOffline(true);
    const offlineShown = await page
      .getByText('Offline — Saved on this Device')
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check(
      'exam shell shows "Offline — Saved on this Device" after connectivity loss',
      offlineShown,
      offlineShown ? '' : `body: ${await bodySnippet(page)}`
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'exam-offline.png') });

    await context.setOffline(false);
    const offlineCleared = await page
      .waitForFunction(
        () => !document.body.innerText.includes('Offline — Saved on this Device'),
        undefined,
        { timeout: 15_000 }
      )
      .then(() => true)
      .catch(() => false);
    check(
      'exam shell leaves the offline state after reconnect',
      offlineCleared,
      offlineCleared ? '' : 'offline badge still present after 15s'
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'exam-reconnected.png') });
  } catch (err) {
    check('offline round-trip ran without exceptions', false, String(err.message).split('\n')[0]);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------

async function run() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const manifestPath = path.join('.next', 'server', 'server-reference-manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Missing .next build — run `npm run build` first.');
  }

  await createFixtures();
  created.facultyCookies = await sessionCookies(created.facultyF);
  created.studentCookies = await sessionCookies(created.studentA);

  await startServer();
  console.log(`Server ready at ${BASE}`);

  const browser = await launchBrowser();
  try {
    await testResponsive(browser);
    await testThemes(browser);
    await testOffline(browser);
  } finally {
    await browser.close();
  }
}

let exitCode = 0;
try {
  await run();
} catch (err) {
  exitCode = 1;
  console.error('\nRUN ERROR:', err);
  check('run completed without exceptions', false, String(err?.message ?? err));
} finally {
  try {
    await cleanup();
    check('cleanup removed all fixtures', true);
  } catch (err) {
    check('cleanup removed all fixtures', false, String(err?.message ?? err));
  }
  stopServer();
}

console.log(`\nScreenshots: ${SHOT_DIR}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  exitCode = 1;
} else {
  console.log('ALL UX E2E CHECKS PASSED');
}
process.exit(exitCode);
