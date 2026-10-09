// API route authorization guarantees. Runs in `npm test` (no server needed).
//
// Enforced invariants:
//   1. Every handler file under src/app/api/**/route.ts either proves the
//      caller's identity before doing any work, or is listed in
//      PUBLIC_BY_DESIGN with the reason it needs no guard. A new route that
//      forgets its auth check fails here instead of shipping an open endpoint.
//   2. Every entry in PUBLIC_BY_DESIGN still names a real route file, so the
//      exemption list cannot rot into a stale allowlist (the same pattern
//      tests/routing.test.mjs uses for intentionally-unlinked pages).
//
// This is deliberately a static scan: the suite runs with no server, no
// database and no environment (see `npm test`), so it cannot exercise the
// guards themselves — the e2e suites do that. What it guarantees cheaply is
// that the guard is *present* in the code that handles the request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { relative, sep } from 'node:path';

import { appDir, repoRoot, walkFiles } from '../scripts/lib/route-tree.mjs';

/**
 * Route files that intentionally perform no authentication, each with the
 * reason. Keep this list short and justified; every entry is a hole in
 * invariant 1.
 */
const PUBLIC_BY_DESIGN = new Map([
  [
    'src/app/api/auth/callback/route.ts',
    'Consumes a one-time OAuth/PKCE code before any session exists; there is no caller identity to authorize yet.',
  ],
]);

/**
 * Code that proves the caller is authenticated. Matched against source with
 * comments stripped, so a doc comment mentioning `getUser()` cannot satisfy
 * the check on its own.
 */
const AUTH_MARKERS = [
  // Supabase session client — cookie session or an explicit bearer token.
  /\.auth\.getUser\s*\(/,
  // Shared-secret trigger used by the cron entry point.
  /CRON_SECRET/,
];

/** HTTP method handlers a Next route file can export. */
const HANDLER_EXPORTS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/** Removes block and line comments so only executable text is inspected. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
}

/** Every route.ts under src/app/api, as repo-relative POSIX paths. */
function apiRouteFiles() {
  return walkFiles(appDir())
    .filter((file) => file.split(sep).join('/').includes('/api/'))
    .filter((file) => file.endsWith(`route.ts`))
    .map((file) => relative(repoRoot(), file).split(sep).join('/'))
    .sort();
}

const ROUTES = apiRouteFiles();
const SOURCES = new Map(ROUTES.map((rel) => [rel, readFileSync(`${repoRoot()}/${rel}`, 'utf8')]));

test('every API route file exports at least one HTTP method handler', () => {
  assert.ok(ROUTES.length > 0, 'expected to find API routes');

  for (const rel of ROUTES) {
    const code = stripComments(SOURCES.get(rel));
    const hasHandler = HANDLER_EXPORTS.some((method) =>
      new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${method}\\b`).test(code)
    );
    assert.ok(hasHandler, `${rel} exports no GET/POST/... handler`);
  }
});

test('every API route authenticates the caller or is allowlisted as public', () => {
  const unguarded = [];

  for (const rel of ROUTES) {
    if (PUBLIC_BY_DESIGN.has(rel)) continue;

    const code = stripComments(SOURCES.get(rel));
    const guarded = AUTH_MARKERS.some((marker) => marker.test(code));
    if (!guarded) unguarded.push(rel);
  }

  assert.deepEqual(
    unguarded,
    [],
    'These routes authenticate nobody. Add an auth check (see src/lib/auth.ts) ' +
      'or, if the route is intentionally public, add it to PUBLIC_BY_DESIGN with a reason:\n' +
      unguarded.map((r) => `  - ${r}`).join('\n')
  );
});

test('every route with an error handler sanitizes failures through toInternalError', () => {
  const offenders = [];

  for (const rel of ROUTES) {
    const code = stripComments(SOURCES.get(rel));
    if (!/\}\s*catch\s*\(/.test(code)) continue;
    if (!/toInternalError/.test(code)) offenders.push(rel);
  }

  assert.deepEqual(
    offenders,
    [],
    'These routes catch errors but never call the shared sanitizer ' +
      '(src/lib/api-error.ts), so a raw driver/provider message can reach the client:\n' +
      offenders.map((r) => `  - ${r}`).join('\n')
  );
});

test('PUBLIC_BY_DESIGN entries still point at real route files', () => {
  const stale = [...PUBLIC_BY_DESIGN.keys()].filter(
    (rel) => !existsSync(`${repoRoot()}/${rel}`) || !ROUTES.includes(rel)
  );

  assert.deepEqual(stale, [], `Stale PUBLIC_BY_DESIGN entries:\n${stale.map((r) => `  - ${r}`).join('\n')}`);
});

test('every PUBLIC_BY_DESIGN entry records a reason', () => {
  for (const [rel, reason] of PUBLIC_BY_DESIGN) {
    assert.equal(typeof reason, 'string', `${rel} has no documented reason`);
    assert.ok(reason.trim().length > 20, `${rel}'s reason is too short to be meaningful`);
  }
});
