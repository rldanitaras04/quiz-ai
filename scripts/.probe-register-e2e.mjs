// TEMP e2e: register through the REAL form on the local dev server, then
// assert the CONFIRMATION email path (not invite):
//   invited_at = null | confirmation_sent_at set | status pending
//   -> simulate the link click -> sign-in unblocked -> cleanup.
// Run: node scripts/.probe-register-e2e.mjs   (needs `npm run dev` on :3000)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.PROBE_BASE_URL ?? 'http://localhost:3000';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      const v = l.slice(i + 1).trim().replace(/^"([^"]*)"$/, '$1').replace(/^'([^']*)'$/, '$1');
      return [l.slice(0, i).trim(), v];
    })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const email = `register-e2e-${stamp}@example.com`;
const password = 'ProbePass123!';
const results = [];
const record = (label, ok, detail) => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}\n      ${detail}`);
};

const LAUNCH_OPTS = [
  { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' },
  { executablePath: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe' },
  { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  { executablePath: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe' },
];

async function launch() {
  for (const opts of LAUNCH_OPTS) {
    try {
      return await chromium.launch({ headless: true, ...opts });
    } catch {
      // try the next browser
    }
  }
  throw new Error('No system Edge/Chrome found');
}

const browser = await launch();
let userId = null;

try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
  // Wait for React to hydrate — filling a controlled input before that gets
  // wiped by the first re-render.
  await page.waitForLoadState('networkidle');

  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Min. 8 characters').fill(password);
  await page.getByPlaceholder('Re-enter your password').fill(password);
  // Full name last, then verify it actually stuck (controlled input).
  const nameInput = page.getByPlaceholder('Juan Dela Cruz');
  await nameInput.fill('Register E2E Probe');
  for (let i = 0; i < 3 && !(await nameInput.inputValue()); i++) {
    await page.waitForTimeout(500);
    await nameInput.fill('Register E2E Probe');
  }
  // Faculty role: no student number / program / year / section fields.
  const facultyRadio = page.locator('input[type="radio"][value="faculty"]');
  await facultyRadio.check();
  if (!(await facultyRadio.isChecked())) {
    throw new Error('faculty radio did not switch (role still student)');
  }
  await page.locator('button[type="submit"]').click();

  try {
    await page.waitForURL('**/register/success**', { timeout: 45_000 });
    record('registration submitted', true, `landed on ${new URL(page.url()).pathname}`);
  } catch {
    // Dump whatever the form is showing so the failure is diagnosable.
    await page.waitForTimeout(3_000);
    const url = page.url();
    const alerts = await page.locator('[role="alert"]').allInnerTexts();
    const values = await page.locator('input').evaluateAll((els) =>
      els.map((el) => `${el.name || el.id || el.type}=${el.type === 'password' ? '(filled)' : el.value}`)
    );
    record('registration submitted', false, `stuck on ${url} | alerts=[${alerts.join(' | ')}] | inputs=[${values.join(', ')}]`);
    throw new Error('registration did not reach /register/success');
  }

  // ---- what did GoTrue record? ---------------------------------------------
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const user = (list?.users ?? []).find((u) => u.email === email);

  if (!user) {
    record('auth user created', false, 'no user found for the registered email');
  } else {
    userId = user.id;
    record(
      'confirmation email path (not invitation)',
      !user.invited_at && Boolean(user.confirmation_sent_at),
      `invited_at=${user.invited_at ?? 'null ✓'} | confirmation_sent_at=${user.confirmation_sent_at ?? 'NOT SENT'}`
    );
    record(
      'created UNCONFIRMED (verification still pending)',
      !user.email_confirmed_at,
      `email_confirmed_at=${user.email_confirmed_at ?? 'null ✓'}`
    );
  }

  const { data: profile } = userId
    ? await admin.from('profiles').select('status').eq('id', userId).maybeSingle()
    : { data: null };
  record('profile status is pending', profile?.status === 'pending', `status=${profile?.status ?? '(missing)'}`);

  // ---- simulate the user clicking the emailed link -------------------------
  if (user) {
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'signup',
      email,
      options: { emailRedirectTo: 'https://seams-ai.vercel.app/login' },
    });
    if (linkErr) {
      record('confirmation link generated', false, linkErr.message);
    } else {
      const res = await fetch(link.properties.action_link, { redirect: 'manual' });
      const dest = (res.headers.get('location') ?? '').replace(/[?#].*$/, '');
      record(
        'click confirms the account',
        res.status >= 302 && res.status < 308,
        `HTTP ${res.status} -> ${dest}`
      );
    }

    const signIn = await anon.auth.signInWithPassword({ email, password });
    record(
      'sign-in works after confirming',
      !signIn.error,
      signIn.error ? `blocked: ${signIn.error.message}` : 'session established ✓ (then the pending screen applies)'
    );
  }
} finally {
  await browser.close();

  // Clean up whatever the attempt created, even if it never navigated.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  const stray = (list?.users ?? []).find((u) => u.email === email);
  if (stray) {
    const { error: delErr } = await admin.auth.admin.deleteUser(stray.id);
    record('cleanup: probe account removed', !delErr, delErr ? delErr.message : 'removed');
  } else if (userId) {
    record('cleanup: probe account removed', false, 'user id held but account already gone');
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
