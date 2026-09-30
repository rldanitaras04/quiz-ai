/**
 * End-to-end test for avatar upload sizing.
 *
 * Regression for the framework-level failure where a legal avatar upload died
 * with `Body exceeded 1 MB limit` before `uploadAvatar` could run its own
 * 2 MB check. Exercises the REAL stack: built server (`next start`), real
 * HTTP multipart POST against the `/profile` server action, real Supabase
 * session, real storage write.
 *
 * Run:  node --env-file=.env.local scripts/e2e-avatar.mjs
 * (requires a fresh `npm run build` first)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const PORT = 3211;
const BASE = `http://localhost:${PORT}`;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('Missing Supabase env vars. Run: node --env-file=.env.local scripts/e2e-avatar.mjs');
  process.exit(1);
}

const projectRef = new URL(url).hostname.split('.')[0];
const results = [];
let failures = 0;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

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
  uploadAvatar: actionId('uploadAvatar', 'actions/profile.ts'),
  deleteAvatar: actionId('deleteAvatar', 'actions/profile.ts'),
};

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
 * Multipart body shaped exactly like React's `encodeReply([file])`:
 * field `0` is the JSON reference array, field `1` is the file itself
 * (`nextPartId` starts at 1, `formFieldPrefix` is empty for fetch calls).
 *
 * The part must be a `File`, not a bare `Blob`: undici omits `filename=` for
 * Blobs, busboy then parses that part as a text field, and React throws
 * "Referenced Blob is not a Blob" when it resolves `$B1`. The file part must
 * also come first — React appends `field 0` (the JSON reference) only after
 * serializing, so `$B1` resolves against an already-flushed file part.
 */
function uploadBody(bytes, type) {
  const fd = new FormData();
  fd.append('1', new File([bytes], 'avatar.png', { type }));
  fd.append('0', JSON.stringify(['$B1']));
  return fd;
}

async function postUpload({ cookie, actionId: id, bytes, type }) {
  const res = await fetch(`${BASE}/profile`, {
    method: 'POST',
    headers: {
      'Next-Action': id,
      Accept: 'text/x-component',
      Cookie: cookie,
    },
    body: uploadBody(bytes, type),
    signal: AbortSignal.timeout(60000),
  });
  return { status: res.status, text: await res.text() };
}

async function postJson({ cookie, actionId: id, args }) {
  const res = await fetch(`${BASE}/profile`, {
    method: 'POST',
    headers: {
      'Next-Action': id,
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'text/x-component',
      Cookie: cookie,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(60000),
  });
  return { status: res.status, text: await res.text() };
}

const MB = 1024 * 1024;

const email = process.env.E2E_AVATAR_EMAIL || process.argv[2];
const password = process.env.E2E_AVATAR_PASSWORD || process.argv[3];

let server = null;
let serverLogFd = -1;

async function startServer() {
  const serverLogPath = path.join('scripts', '.e2e-server.log');
  serverLogFd = fs.openSync(serverLogPath, 'w');
  const nextBin = path.join('node_modules', 'next', 'dist', 'bin', 'next');
  server = spawn(process.execPath, [nextBin, 'start', '-p', String(PORT)], {
    detached: true,
    stdio: ['ignore', serverLogFd, serverLogFd],
    env: process.env,
  });

  const deadline = Date.now() + 60000;
  for (;;) {
    // A leaked server from an earlier run answers the readiness probe too, so
    // fail loudly instead of testing against the wrong process.
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

function snippet(text) {
  const flat = text.replace(/\s+/g, ' ');
  return flat.slice(0, 240);
}

async function run() {
  const cookie = await sessionCookie(email, password);

  await startServer();
  console.log(`Server ready at ${BASE}`);

  // T1 — a 1.9 MB file must reach uploadAvatar (previously: 1 MB framework error)
  {
    const bytes = new Uint8Array(Math.round(1.9 * MB));
    const { status, text } = await postUpload({
      cookie,
      actionId: ACT.uploadAvatar,
      bytes,
      type: 'image/png',
    });
    check('T1 1.9 MB upload is not rejected by the framework body limit',
      !/Body exceeded/i.test(text),
      `status=${status} ${snippet(text)}`);
    check('T1 1.9 MB upload succeeds end to end (storage + profile path)',
      /"success"\s*:\s*true/.test(text),
      snippet(text));
  }

  // T2 — a 2.5 MB file passes the transport (3mb) and is refused by our own
  //      2 MB check, so the user gets the friendly message rather than a
  //      framework runtime error.
  {
    const bytes = new Uint8Array(Math.round(2.5 * MB));
    const { status, text } = await postUpload({
      cookie,
      actionId: ACT.uploadAvatar,
      bytes,
      type: 'image/png',
    });
    check('T2 2.5 MB upload does not hit the framework body limit',
      !/Body exceeded/i.test(text),
      `status=${status} ${snippet(text)}`);
    check('T2 2.5 MB upload is refused with the 2 MB message',
      /Image must be 2 MB or smaller/.test(text),
      snippet(text));
  }

  // T3 — the transport limit still exists (it is a ceiling, not "unlimited")
  {
    const bytes = new Uint8Array(Math.round(4 * MB));
    const { text } = await postUpload({
      cookie,
      actionId: ACT.uploadAvatar,
      bytes,
      type: 'image/png',
    });
    check('T3 4 MB body is still bounded by the configured limit',
      /Body exceeded/i.test(text),
      snippet(text));
  }
}

let exitCode = 0;
try {
  if (!email || !password) {
    throw new Error('Pass the test account: node --env-file=.env.local scripts/e2e-avatar.mjs <email> <password>');
  }
  await run();
} catch (err) {
  exitCode = 1;
  console.error('\nRUN ERROR:', err);
  check('run completed without exceptions', false, String(err?.message ?? err));
} finally {
  // Always put the test user's avatar back the way we found it — this needs
  // the server, so clean up before tearing it down.
  if (email && password) {
    try {
      const cookie = await sessionCookie(email, password);
      const r = await postJson({ cookie, actionId: ACT.deleteAvatar, args: [] });
      console.log(`Cleanup deleteAvatar: status=${r.status} ${/\"success\"\s*:\s*true/.test(r.text) ? 'ok' : snippet(r.text)}`);
    } catch (err) {
      console.error('Cleanup error:', err);
    }
  }
  stopServer();
}

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  exitCode = 1;
} else {
  console.log('ALL AVATAR E2E CHECKS PASSED');
}
process.exit(exitCode);
