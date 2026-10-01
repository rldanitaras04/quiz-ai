#!/usr/bin/env node
// HTTP route existence check: proves every route in the tree actually responds,
// catching build/config-level breakage that static analysis cannot see.
//
//   npm run check:routes                 # against http://localhost:3000
//   BASE_URL=http://localhost:3001 npm run check:routes
//
// Needs a running dev/prod server of this app. Method:
//  - HEAD probe per route: the proxy passes non-GET through, so Next routing
//    decides: existing page -> 200/307 (layout redirect), missing -> 404.
//    A self-check first proves the probe can see a 404 at all.
//  - GET probe per page: public pages -> 200; protected pages -> 307/308 to
//    /login (verifies the proxy's auth redirect for every protected route).
//
// Exit codes: 0 ok | 1 route failures | 2 server unreachable | 3 probe invalid.
import { buildRouteTree, probePath } from './lib/route-tree.mjs';

const BASE = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const TIMEOUT_MS = 120_000;
const MISSING_PROBE = '/__route_check_this_is_not_a_route__';

const ROUTES = buildRouteTree();

async function request(path, method) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, location: res.headers.get('location') };
}

async function waitReady() {
  for (let i = 0; i < 45; i++) {
    try {
      const { status } = await request('/', 'GET');
      if (status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

if (!(await waitReady())) {
  console.error(`✗ ${BASE} is not reachable.`);
  console.error('  Start the app first (npm run dev) or set BASE_URL.');
  process.exit(2);
}

// Self-check: without this, a proxy/middleware change that 307s everything
// would make every probe "pass" while routes silently stopped existing.
{
  const probe = await request(MISSING_PROBE, 'HEAD');
  if (probe.status !== 404) {
    console.error(`✗ probe invalid: HEAD ${MISSING_PROBE} returned ${probe.status}, expected 404.`);
    console.error('  Route existence cannot be verified against this server.');
    process.exit(3);
  }
}

const failures = [];
let checked = 0;

const isRedirect = (s) => s === 301 || s === 302 || s === 303 || s === 307 || s === 308;

for (const route of [...ROUTES.keys()].sort()) {
  const path = probePath(route);
  checked++;

  // 1. Existence (works for pages and API routes alike).
  try {
    const head = await request(path, 'HEAD');
    if (head.status === 404) {
      failures.push(`HEAD ${route} -> 404 (route does not exist)`);
      continue;
    }
    if (head.status >= 500) {
      failures.push(`HEAD ${route} -> ${head.status} (server error)`);
      continue;
    }
  } catch (e) {
    failures.push(`HEAD ${route} -> ${e.name}: ${e.message}`);
    continue;
  }

  // 2. Page GET behaviour: public = 200, protected = redirect to /login.
  //    (API routes self-authenticate and vary by method; existence is enough.)
  if (route.startsWith('/api/')) continue;
  try {
    const get = await request(path, 'GET');
    if (get.status === 200) continue;
    if (isRedirect(get.status) && (get.location ?? '').replace(/\/$/, '').endsWith('/login')) continue;
    if (get.status === 404) failures.push(`GET ${route} -> 404`);
    else failures.push(`GET ${route} -> ${get.status}${get.location ? ` (location: ${get.location})` : ''} — expected 200 or redirect to /login`);
  } catch (e) {
    failures.push(`GET ${route} -> ${e.name}: ${e.message}`);
  }
}

console.log(`checked ${checked} routes against ${BASE}`);
if (failures.length > 0) {
  console.error(`✗ ${failures.length} routing failure(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log('✓ every route responds (no 404s, proxy redirects intact)');
