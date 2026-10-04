// TEMPORARY dashboard wiring audit (deleted after the report).
//
// For every existing user it:
//   1. mints a REAL session (auth-admin magic-link -> verifyOtp; no password change),
//   2. fetches that role's dashboard pages over HTTP from a fresh `next start`,
//   3. re-runs the page's exact queries under that session (RLS included),
//   4. compares the rendered figures against service-role ground truth.
//
// Run: node --env-file=.env.local scripts/.audit-dashboards.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) {
  console.error('Missing Supabase env vars (run with --env-file=.env.local)');
  process.exit(1);
}
const projectRef = new URL(url).hostname.split('.')[0];
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (label, condition, detail = '') => {
  if (condition) pass += 1;
  else fail += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (label, detail = '') => console.log(`INFO  ${label}${detail ? ` — ${detail}` : ''}`);
const section = (title) => console.log(`\n=== ${title} ===`);

// ---------------------------------------------------------------------------
// Server (fresh build, port 3211)
// ---------------------------------------------------------------------------
let server = null;
let serverLogFd = null;

async function startServer() {
  const logPath = path.join('scripts', '.audit-server.log');
  serverLogFd = fs.openSync(logPath, 'w');
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
    } catch { /* not up yet */ }
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
      await new Promise((resolve) => {
        const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
        killer.once('exit', resolve);
        killer.once('error', resolve);
      });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch { /* already gone */ }
  try { fs.closeSync(serverLogFd); } catch { /* closed */ }
}

async function getPage(pathname, cookie) {
  const res = await fetch(`${BASE}${pathname}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
    signal: AbortSignal.timeout(45000),
  });
  return { status: res.status, html: await res.text(), location: res.headers.get('location') ?? '' };
}

function bounceTarget(res) {
  if (res.location) return res.location;
  const m = res.html.match(/http-equiv="refresh" content="\d+;url=([^"]+)"/);
  return m ? m[1] : '';
}

// ---------------------------------------------------------------------------
// Sessions (magic-link sign-in, no password change)
// ---------------------------------------------------------------------------
async function listAllUsers() {
  const out = [];
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    out.push(...(data?.users ?? []));
    if ((data?.users ?? []).length < 100) break;
    page += 1;
  }
  return out;
}

async function mintSession(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink(${email}): ${error.message}`);
  const tokenHash = link?.hashed_token ?? link?.properties?.hashed_token;
  if (!tokenHash) throw new Error(`generateLink(${email}): no hashed_token in ${JSON.stringify(link)}`);

  const verifier = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } });
  for (const type of ['magiclink', 'email']) {
    const { data, error: vErr } = await verifier.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!vErr && data?.session) return data.session;
    if (type === 'email') throw new Error(`verifyOtp(${email}): ${vErr?.message}`);
  }
  throw new Error(`verifyOtp(${email}): no session`);
}

async function cookieFor(session) {
  const key = `sb-${projectRef}-auth-token`;
  const encoded = 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  let chunks;
  try {
    const { createChunks } = await import('@supabase/ssr/dist/main/utils/chunker.js');
    chunks = await createChunks(key, encoded);
  } catch {
    chunks = [{ name: key, value: encoded }];
  }
  return chunks.map((c) => `${c.name}=${c.value}`).join('; ');
}

function userClient(token) {
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// HTML extraction helpers
// ---------------------------------------------------------------------------
function statValue(html, label) {
  const idx = html.indexOf(`>${label}</p>`);
  if (idx < 0) return null;
  const win = html.slice(idx, idx + 700);
  const m = win.match(/text-3xl font-bold[^>]*>([^<]+)</);
  return m ? m[1].trim() : null;
}

function statCaption(html, label) {
  const idx = html.indexOf(`>${label}</p>`);
  if (idx < 0) return null;
  const win = html.slice(idx, idx + 900);
  const m = win.match(/text-xs font-medium[^>]*>([^<]+)</);
  return m ? m[1].trim() : null;
}

function usageValue(html, label) {
  const idx = html.indexOf(`>${label}</p>`);
  if (idx < 0) return null;
  const win = html.slice(Math.max(0, idx - 700), idx);
  const matches = [...win.matchAll(/text-lg font-bold[^>]*>([^<]+)</g)];
  return matches.length ? matches[matches.length - 1][1].trim() : null;
}

function decodeEntities(s) {
  return s
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, ''));
}

/** My Subjects: subject cards with their section-badge and table rows. */
function extractSubjectCards(html) {
  const linkRe = /href="\/faculty\/subjects\/subject\/[^"]+"[^>]*>([^<]+)<\/a>/g;
  const links = [...html.matchAll(linkRe)];
  return links.map((m, i) => {
    const start = m.index + m[0].length;
    const end = i + 1 < links.length ? links[i + 1].index : html.length;
    const win = html.slice(start, end);
    const badge = win.match(/(\d+)\s+sections?/);
    const rows = [];
    for (const tr of win.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => stripTags(c[1]));
      if (cells.length >= 5 && cells[0] !== 'Section') rows.push(cells);
    }
    return {
      code: decodeEntities(m[1]).split(' - ')[0].trim(),
      badge: badge ? Number(badge[1]) : null,
      rows,
    };
  });
}

// ---------------------------------------------------------------------------
// Ground truth (service role — what is actually in the database)
// ---------------------------------------------------------------------------
async function groundTruth() {
  const countHead = async (table, opts) => {
    let q = admin.from(table).select('id', { count: 'exact', head: true });
    if (opts?.column) q = q.eq(opts.column, opts.value);
    const { count, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    return count ?? 0;
  };

  const [subjectsRes, offeringsRes, assignmentsRes, enrollmentsRes, rolesRes] = await Promise.all([
    admin.from('subjects').select('id, code, title'),
    admin.from('subject_offerings').select('id, subject_id, status, section_id, semester_id'),
    admin.from('faculty_assignments').select('id, subject_offering_id, faculty_id'),
    admin.from('enrollments').select('student_id, subject_offering_id, status'),
    admin.from('user_roles').select('user_id, role'),
  ]);
  if (subjectsRes.error || offeringsRes.error || assignmentsRes.error || enrollmentsRes.error || rolesRes.error) {
    throw new Error('ground truth query failed');
  }

  const counts = {
    profiles: await countHead('profiles'),
    subjects: await countHead('subjects'),
    assessments: await countHead('assessments'),
    assessmentResults: await countHead('assessment_results'),
    questionBank: await countHead('question_bank'),
    activeSections: await countHead('sections', { column: 'is_active', value: 'true' }),
    activeOfferings: await countHead('subject_offerings', { column: 'status', value: 'active' }),
    aiUsageLogs: await countHead('ai_usage_logs'),
    enrollments: await countHead('enrollments'),
    deployments: await countHead('assessment_deployments'),
  };

  const subjects = subjectsRes.data ?? [];
  const offerings = offeringsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const enrollments = enrollmentsRes.data ?? [];
  const roles = rolesRes.data ?? [];

  return { subjects, offerings, assignments, enrollments, roles, counts };
}

// ---------------------------------------------------------------------------
// Faculty My Subjects (page query, replicated under the caller's session)
// ---------------------------------------------------------------------------
async function mySubjectsFigures(client, facultyId) {
  const { data: assignments, error } = await client
    .from('faculty_assignments')
    .select(`
      id,
      subject_offering:subject_offerings(
        id,
        status,
        subject:subjects(id, code, title),
        semester:semesters(id, name, academic_year:academic_years(id, name)),
        section:sections(id, name, program:programs(id, code, name), year_level:year_levels(id, name))
      )
    `)
    .eq('faculty_id', facultyId);
  if (error) return { error: error.message };

  const rows = (assignments ?? []).filter((a) => a.subject_offering && a.subject_offering.subject);
  const bySubject = new Map();
  for (const row of rows) {
    const o = row.subject_offering;
    if (!bySubject.has(o.subject.id)) bySubject.set(o.subject.id, { code: o.subject.code, offerings: [] });
    bySubject.get(o.subject.id).offerings.push({ id: o.id, section: o.section?.name ?? '—' });
  }
  const offeringIds = rows.map((r) => r.subject_offering.id);

  let enrolledByOffering = {};
  let enrolledError = null;
  if (offeringIds.length > 0) {
    const { data, error: e } = await client
      .from('enrollments')
      .select('subject_offering_id')
      .in('subject_offering_id', offeringIds)
      .eq('status', 'enrolled');
    if (e) enrolledError = e.message;
    else for (const row of data ?? []) enrolledByOffering[row.subject_offering_id] = (enrolledByOffering[row.subject_offering_id] ?? 0) + 1;
  }
  return { bySubject, offeringIds, enrolledByOffering, enrolledError };
}

// ---------------------------------------------------------------------------
// Faculty dashboard (page logic, replicated under the caller's session)
// ---------------------------------------------------------------------------
async function facultyDashboardFigures(client, facultyId) {
  const { data: assignments, error } = await client
    .from('faculty_assignments')
    .select(`
      id, subject_offering:subject_offerings(
        id, semester_id, section_id, status,
        subject:subjects(id, code, title),
        section:sections(id, name),
        semester:semesters(id, name, is_active, academic_year:academic_years(id, name))
      )
    `)
    .eq('faculty_id', facultyId);
  if (error) return { error: error.message };

  const rows = (assignments ?? []).filter((row) => row.subject_offering != null);
  if (rows.length === 0) return { empty: true };

  const optionMap = new Map();
  for (const row of rows) {
    const semester = row.subject_offering.semester;
    if (semester && !optionMap.has(semester.id)) {
      optionMap.set(semester.id, {
        id: semester.id,
        label: semester.academic_year ? `${semester.name} ${semester.academic_year.name}` : semester.name,
        isActive: Boolean(semester.is_active),
      });
    }
  }
  const semesterOptions = [...optionMap.values()].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.label.localeCompare(b.label)
  );
  const selectedSemesterId = semesterOptions.find((o) => o.isActive)?.id ?? semesterOptions[0]?.id ?? null;

  const ownOfferings = rows
    .map((row) => row.subject_offering)
    .filter((o) => selectedSemesterId == null || o.semester_id === selectedSemesterId);
  const ownSubjectIds = [...new Set(ownOfferings.map((o) => o.subject?.id).filter(Boolean))];

  let scopeOfferingIds = ownOfferings.map((o) => o.id);
  let scopeSectionIds = ownOfferings.map((o) => o.section_id).filter(Boolean);
  if (ownSubjectIds.length > 0) {
    let q = client.from('subject_offerings').select('id, section_id').in('subject_id', ownSubjectIds);
    if (selectedSemesterId) q = q.eq('semester_id', selectedSemesterId);
    const { data, error: e } = await q;
    if (!e && data) {
      scopeOfferingIds = data.map((r) => r.id);
      scopeSectionIds = data.map((r) => r.section_id).filter(Boolean);
    }
  }
  const sectionCount = new Set(scopeSectionIds).size;

  const figures = {
    selectedSemesterId,
    semesterLabels: semesterOptions.map((o) => o.label),
    ownOfferingsCount: ownOfferings.length,
    ownSubjectCount: ownSubjectIds.length,
    scopeOfferingCount: scopeOfferingIds.length,
    sectionCount,
    students: null,
    assessments: null,
    pending: null,
    scopeError: null,
  };

  if (scopeOfferingIds.length === 0) return figures;

  const { data: enr, error: e1 } = await client
    .from('enrollments').select('student_id')
    .in('subject_offering_id', scopeOfferingIds).eq('status', 'enrolled').limit(10000);
  figures.students = e1 ? null : new Set((enr ?? []).map((r) => r.student_id)).size;
  if (e1) figures.scopeError = `enrollments: ${e1.message}`;

  const { count, error: e2 } = await client
    .from('assessments').select('id', { count: 'exact', head: true })
    .in('subject_offering_id', scopeOfferingIds);
  figures.assessments = e2 ? null : (count ?? 0);
  if (e2) figures.scopeError = `assessments: ${e2.message}`;

  const { data: deps, error: e3 } = await client
    .from('assessment_deployments').select('id')
    .in('subject_offering_id', scopeOfferingIds).limit(5000);
  if (e3) {
    figures.pending = null;
    figures.scopeError = `deployments: ${e3.message}`;
  } else {
    const depIds = (deps ?? []).map((d) => d.id);
    if (depIds.length === 0) figures.pending = 0;
    else {
      figures.pending = 0;
      for (let i = 0; i < depIds.length; i += 100) {
        const chunk = depIds.slice(i, i + 100);
        const { count: c, error: e4 } = await client
          .from('assessment_results').select('id', { count: 'exact', head: true })
          .in('deployment_id', chunk).neq('status', 'released');
        if (e4) { figures.pending = null; figures.scopeError = `results: ${e4.message}`; break; }
        figures.pending += c ?? 0;
      }
    }
  }
  return figures;
}

// ---------------------------------------------------------------------------
// Student dashboard (page queries, replicated under the caller's session)
// ---------------------------------------------------------------------------
async function studentFigures(client, userId) {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [profileRes, studentProfileRes, enrollmentsRes] = await Promise.all([
    client.from('profiles').select('full_name').eq('id', userId).maybeSingle(),
    client
      .from('student_profiles')
      .select('student_number, program:programs(code, name), year_level:year_levels(name), section:sections(name)')
      .eq('user_id', userId)
      .maybeSingle(),
    client
      .from('enrollments')
      .select(`
        id, enrolled_at,
        subject_offering:subject_offerings(
          id, subject:subjects(code, title),
          semester:semesters(id, name, academic_year:academic_years(name)),
          section:sections(name, program:programs(code))
        )
      `)
      .eq('student_id', userId).eq('status', 'enrolled')
      .order('enrolled_at', { ascending: true }),
  ]);

  const errors = [profileRes.error, studentProfileRes.error, enrollmentsRes.error].filter(Boolean).map((e) => `${e.code ?? '?'} ${e.message}`);
  if (errors.length > 0) return { error: errors.join(' | ') };

  const offerings = [];
  const semesterCounts = new Map();
  for (const row of enrollmentsRes.data ?? []) {
    const o = row.subject_offering;
    if (!o?.id) continue;
    const semesterId = o.semester?.id ?? null;
    offerings.push({ offeringId: o.id, code: o.subject?.code ?? '—', semesterId });
    if (semesterId) semesterCounts.set(semesterId, (semesterCounts.get(semesterId) ?? 0) + 1);
  }
  const activeSemesterId = [...semesterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  // Deployments (exact page query).
  let deploymentRows = [];
  let deployError = null;
  if (offerings.length > 0) {
    const { data, error } = await client
      .from('assessment_deployments')
      .select('id, opens_at, closes_at, attempt_limit, subject_offering_id')
      .in('subject_offering_id', offerings.map((o) => o.offeringId))
      .in('status', ['active', 'scheduled'])
      .gte('closes_at', now.toISOString())
      .order('opens_at', { ascending: true })
      .limit(100);
    if (error) deployError = error.message;
    else deploymentRows = data ?? [];
  }
  let openInSevenDays = 0;
  for (const d of deploymentRows) {
    if (new Date(d.opens_at) <= windowEnd && new Date(d.closes_at) >= now) openInSevenDays += 1;
  }

  // Released results (exact page query).
  const { data: resultRows, error: resultsError } = await client
    .from('assessment_results')
    .select('id, percentage, released_at, deployment:assessment_deployments(id, subject_offering_id, subject_offering:subject_offerings(semester_id))')
    .eq('student_id', userId)
    .eq('status', 'released')
    .order('released_at', { ascending: false })
    .limit(500);
  if (resultsError) return { error: `results: ${resultsError.message}` };

  const released = (resultRows ?? []).map((row) => ({
    percentage: Number(row.percentage ?? 0),
    semesterId: row.deployment?.subject_offering?.semester_id ?? null,
  }));
  const releasedThisSemester = activeSemesterId ? released.filter((r) => r.semesterId === activeSemesterId) : released;
  const enrolledThisSemester = activeSemesterId ? offerings.filter((o) => o.semesterId === activeSemesterId).length : offerings.length;
  const average = released.length > 0
    ? Math.round((released.reduce((s, r) => s + r.percentage, 0) / released.length) * 10) / 10
    : null;

  return {
    mySubjects: enrolledThisSemester,
    upcoming: openInSevenDays,
    completed: releasedThisSemester.length,
    average,
    profile: studentProfileRes.data,
    offeringCodes: [...new Set(offerings.map((o) => o.code))],
    activeSemesterId,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const started = Date.now();
try {
  await groundTruth(); // fail fast before booting anything
  await startServer();
  console.log(`Server ready at ${BASE}`);

  const gt = await groundTruth();
  const users = await listAllUsers();

  section('GROUND TRUTH (service role — raw database)');
  info('users', String(users.length));
  info('user_roles rows', gt.roles.map((r) => `${r.role}`).reduce((acc, r) => ((acc[r] = (acc[r] ?? 0) + 1), acc), {}));
  const subjectsByCode = new Map(gt.subjects.map((s) => [s.id, s]));
  const offeringsPerSubject = new Map();
  for (const o of gt.offerings) offeringsPerSubject.set(o.subject_id, (offeringsPerSubject.get(o.subject_id) ?? 0) + 1);
  for (const s of gt.subjects) {
    info(`subject ${s.code}`, `"${s.title}" — offerings: ${offeringsPerSubject.get(s.id) ?? 0}`);
  }
  const enrolledPerOffering = new Map();
  for (const e of gt.enrollments) if (e.status === 'enrolled') enrolledPerOffering.set(e.subject_offering_id, (enrolledPerOffering.get(e.subject_offering_id) ?? 0) + 1);
  info('offerings', gt.offerings.map((o) => `${subjectsByCode.get(o.subject_id)?.code ?? '?'}[${o.status}] enrolled=${enrolledPerOffering.get(o.id) ?? 0}`).join(', '));
  info('counts', gt.counts);

  const rolesByUser = new Map();
  for (const r of gt.roles) {
    if (!rolesByUser.has(r.user_id)) rolesByUser.set(r.user_id, []);
    rolesByUser.get(r.user_id).push(r.role);
  }

  // --- anonymous root -------------------------------------------------------
  section('ANONYMOUS');
  const anonRoot = await getPage('/', null);
  info('GET /', `status=${anonRoot.status} bounce=${bounceTarget(anonRoot) || '(none)'}`);

  for (const user of users) {
    const roles = rolesByUser.get(user.id) ?? [];
    section(`USER ${user.email} [${roles.join(', ') || 'no role'}]`);

    if (roles.length === 0) {
      info('no roles — no dashboard to check');
      continue;
    }

    let session;
    try {
      session = await mintSession(user.email);
    } catch (err) {
      ok(`session for ${user.email}`, false, String(err.message ?? err));
      continue;
    }
    const cookie = await cookieFor(session);
    const client = userClient(session.access_token);

    // Root bounce
    const root = await getPage('/', cookie);
    info('GET /', `status=${root.status} bounce=${bounceTarget(root) || '(none)'}`);

    // ---------------- Faculty: My Subjects ----------------
    if (roles.includes('faculty') || roles.includes('super_admin')) {
      const page = await getPage('/faculty/subjects', cookie);
      ok(`${user.email} GET /faculty/subjects renders`, page.status === 200, `status=${page.status} bounce=${bounceTarget(page)}`);

      const sessionFigs = await mySubjectsFigures(client, user.id);
      if (sessionFigs.error) {
        ok(`${user.email} My Subjects query (RLS session)`, false, sessionFigs.error);
      } else {
        // Ground truth grouping (service role, same grouping rule).
        const gtBySubject = new Map();
        for (const a of gt.assignments) {
          if (a.faculty_id !== user.id) continue;
          const offering = gt.offerings.find((o) => o.id === a.subject_offering_id);
          if (!offering) continue;
          const subject = subjectsByCode.get(offering.subject_id);
          if (!subject) continue;
          if (!gtBySubject.has(subject.id)) gtBySubject.set(subject.id, { code: subject.code, offerings: [] });
          gtBySubject.get(subject.id).offerings.push(offering);
        }

        const cards = extractSubjectCards(page.html);
        const gtCodes = [...gtBySubject.values()].map((g) => g.code).sort();
        const htmlCodes = cards.map((c) => c.code).sort();
        ok(`${user.email} My Subjects: subject cards match DB`,
          JSON.stringify(gtCodes) === JSON.stringify(htmlCodes),
          `db=[${gtCodes}] html=[${htmlCodes}]`);

        // Per-subject section badges.
        for (const [subjectId, group] of gtBySubject) {
          const card = cards.find((c) => c.code === group.code);
          ok(`${user.email} My Subjects: ${group.code} badge = ${group.offerings.length} section(s)`,
            card?.badge === group.offerings.length,
            `html=${card?.badge ?? 'missing'}`);
        }

        // Per-section enrolled counts (session vs html vs service).
        if (sessionFigs.enrolledError) {
          ok(`${user.email} My Subjects: enrollment counts query`, false, sessionFigs.enrolledError);
        } else {
          for (const [subjectId, group] of gtBySubject) {
            const card = cards.find((c) => c.code === group.code);
            for (const offering of group.offerings) {
              const gtEnrolled = enrolledPerOffering.get(offering.id) ?? 0;
              const sessionEnrolled = sessionFigs.enrolledByOffering[offering.id] ?? 0;
              ok(`${user.email} ${group.code}: enrolled count wired (db=${gtEnrolled}, rls=${sessionEnrolled})`,
                gtEnrolled === sessionEnrolled,
                'RLS hides rows the service role sees');
            }
          }
        }
      }

      // ---------------- Faculty dashboard ----------------
      const dash = await getPage('/faculty', cookie);
      ok(`${user.email} GET /faculty renders`, dash.status === 200, `status=${dash.status} bounce=${bounceTarget(dash)}`);
      const figs = await facultyDashboardFigures(client, user.id);

      if (figs.error) {
        ok(`${user.email} faculty dashboard queries (RLS session)`, false, figs.error);
      } else if (figs.empty) {
        info(`${user.email} faculty dashboard: no assignments — empty state expected`,
          `html has empty state: ${dash.html.includes('No subjects assigned')}`);
      } else {
        ok(`${user.email} faculty dashboard queries (RLS session)`, !figs.scopeError, figs.scopeError ?? 'all queries ok');
        const htmlMySubjects = statValue(dash.html, 'My Subjects');
        const htmlAssessments = statValue(dash.html, 'Assessments Created');
        const htmlStudents = statValue(dash.html, 'Total Students');
        const htmlStudentsCaption = statCaption(dash.html, 'Total Students');
        const htmlToCheck = statValue(dash.html, 'To Be Checked');

        ok(`${user.email} /faculty "My Subjects" card wired`,
          htmlMySubjects === String(figs.ownOfferingsCount),
          `html=${htmlMySubjects} expected=${figs.ownOfferingsCount} (offerings in semester; distinct subjects=${figs.ownSubjectCount})`);
        ok(`${user.email} /faculty "Assessments Created" wired`,
          htmlAssessments === String(figs.assessments),
          `html=${htmlAssessments} expected=${figs.assessments} (scope: ${figs.scopeOfferingCount} offerings of your subjects)`);
        ok(`${user.email} /faculty "Total Students" wired`,
          htmlStudents === String(figs.students),
          `html=${htmlStudents} expected=${figs.students}`);
        ok(`${user.email} /faculty "Total Students" caption = section count`,
          htmlStudentsCaption === `${figs.sectionCount} section${figs.sectionCount === 1 ? '' : 's'}`,
          `html=${htmlStudentsCaption} expected=${figs.sectionCount}`);
        ok(`${user.email} /faculty "To Be Checked" wired`,
          htmlToCheck === String(figs.pending),
          `html=${htmlToCheck} expected=${figs.pending}`);
        info(`${user.email} semester filter default`, figs.semesterLabels.join(' | ') + ` → selected=${figs.selectedSemesterId}`);
      }
    }

    // ---------------- Student ----------------
    if (roles.includes('student')) {
      const page = await getPage('/student', cookie);
      ok(`${user.email} GET /student renders without error`,
        page.status === 200 && !page.html.includes('Failed to load your academic context'),
        `status=${page.status} bounce=${bounceTarget(page)}`);

      const figs = await studentFigures(client, user.id);
      if (figs.error) {
        ok(`${user.email} student dashboard queries (RLS session)`, false, figs.error);
      } else {
        ok(`${user.email} student dashboard queries (RLS session)`, true, 'profiles + student_profiles + enrollments + deployments + results');
        const htmlSubjects = statValue(page.html, 'My Subjects');
        const htmlUpcoming = statValue(page.html, 'Upcoming Assessments');
        const htmlCompleted = statValue(page.html, 'Completed Assessments');
        const htmlAverage = statValue(page.html, 'Average Score');
        const expectedAverage = figs.average === null ? '—' : figs.average.toLocaleString();

        ok(`${user.email} /student "My Subjects" wired`,
          htmlSubjects === String(figs.mySubjects), `html=${htmlSubjects} expected=${figs.mySubjects}`);
        ok(`${user.email} /student "Upcoming Assessments" wired`,
          htmlUpcoming === String(figs.upcoming), `html=${htmlUpcoming} expected=${figs.upcoming}`);
        ok(`${user.email} /student "Completed Assessments" wired`,
          htmlCompleted === String(figs.completed), `html=${htmlCompleted} expected=${figs.completed}`);
        ok(`${user.email} /student "Average Score" wired`,
          htmlAverage === expectedAverage, `html=${htmlAverage} expected=${expectedAverage}`);

        for (const code of figs.offeringCodes) {
          ok(`${user.email} /student shows subject code ${code}`, page.html.includes(code));
        }
        if (figs.profile?.program) {
          info(`${user.email} student profile`, `program=${figs.profile.program?.code ?? '?'} year=${figs.profile.year_level?.name ?? '—'} section=${figs.profile.section?.name ?? '—'}`);
        } else {
          info(`${user.email} student profile: no linked program/year/section row`);
        }
      }
    }

    // ---------------- Admin ----------------
    if (roles.includes('super_admin')) {
      const page = await getPage('/admin', cookie);
      ok(`${user.email} GET /admin renders`, page.status === 200, `status=${page.status} bounce=${bounceTarget(page)}`);

      // Session-side counts (RLS as this admin) vs service-role ground truth.
      const sessionCount = async (table, opts) => {
        let q = client.from(table).select('id', { count: 'exact', head: true });
        if (opts?.column) q = q.eq(opts.column, opts.value);
        const { count, error } = await q;
        return error ? { error: error.message } : { count: count ?? 0 };
      };
      const checks = [
        ['Total Users', 'profiles', null, gt.counts.profiles],
        ['Total Subjects', 'subjects', null, gt.counts.subjects],
        ['Questions in Bank', 'question_bank', null, gt.counts.questionBank],
        ['Active Sections', 'sections', { column: 'is_active', value: 'true' }, gt.counts.activeSections],
        ['Active Offerings', 'subject_offerings', { column: 'status', value: 'active' }, gt.counts.activeOfferings],
        ['AI API Calls', 'ai_usage_logs', null, gt.counts.aiUsageLogs],
      ];
      for (const [label, table, opts, expected] of checks) {
        const s = await sessionCount(table, opts);
        if (s.error) {
          ok(`${user.email} /admin ${label} query`, false, s.error);
          continue;
        }
        ok(`${user.email} /admin ${label}: RLS sees full table`,
          s.count === expected, `rls=${s.count} db=${expected}`);
        const htmlVal = label === 'Questions in Bank' || label === 'Active Sections' || label === 'Active Offerings' || label === 'AI API Calls'
          ? usageValue(page.html, label)
          : statValue(page.html, label);
        ok(`${user.email} /admin "${label}" rendered`,
          htmlVal === String(expected), `html=${htmlVal} expected=${expected}`);
      }

      // These two come from the admin (service) exam client inside the action.
      const htmlAssessments = statValue(page.html, 'Total Assessments');
      ok(`${user.email} /admin "Total Assessments" rendered`,
        htmlAssessments === String(gt.counts.assessments), `html=${htmlAssessments} db=${gt.counts.assessments}`);
      const htmlCompleted = statValue(page.html, 'Completed Exams');
      ok(`${user.email} /admin "Completed Exams" rendered`,
        htmlCompleted === String(gt.counts.assessmentResults), `html=${htmlCompleted} db=${gt.counts.assessmentResults} (rows in assessment_results)`);

      // Panels that should carry data when the tables are non-empty.
      if (gt.counts.deployments > 0) {
        ok(`${user.email} /admin "Recent Exams" panel has rows`, page.html.includes('Recent Exams') && !page.html.includes('No exams deployed yet'));
      } else {
        info(`${user.email} /admin "Recent Exams": no deployments in DB — empty state expected`,
          `empty shown: ${page.html.includes('No exams deployed yet')}`);
      }
      if (gt.counts.assessments > 0) {
        ok(`${user.email} /admin "Top Subjects" panel has rows`, !page.html.includes('No assessments created yet'));
      } else {
        info(`${user.email} /admin "Top Subjects": no assessments in DB — empty state expected`,
          `empty shown: ${page.html.includes('No assessments created yet')}`);
      }
      const panelOk = !page.html.includes('Activity data is unavailable right now.');
      ok(`${user.email} /admin "System Activity" query ok`, panelOk);
    }
  }
} catch (err) {
  console.error('\nAUDIT ERROR:', err);
  fail += 1;
} finally {
  await stopServer();
  console.log(`\n${pass} passed, ${fail} failed in ${Math.round((Date.now() - started) / 1000)}s`);
}
