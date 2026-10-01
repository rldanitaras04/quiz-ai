// Route & link wiring guarantees. Runs in `npm test` (no server needed).
//
// Enforced invariants:
//  1. Every path-shaped string literal in src/ resolves to a real route
//     (href=, router.push, redirect(), redirectTo, object fields, templates).
//     Literals passed to startsWith() must prefix-match a real route.
//  2. Hash links (#anchor) target anchors that exist on the destination page.
//  3. For each role, every global nav item points at a route whose
//     requireRole() gate actually accepts that role (no self-bouncing nav).
//  4. Every page route is either linked from somewhere or explicitly
//     allowlisted as intentionally unlinked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';

import {
  appDir,
  buildRouteTree,
  extractLiterals,
  isPathLiteral,
  lineOf,
  matchRoute,
  normalizeTarget,
  repoRoot,
  walkFiles,
  walkSources,
} from '../scripts/lib/route-tree.mjs';
import { GLOBAL_NAVIGATION } from '../src/config/navigation.ts';
import { homePathForRole } from '../src/config/role-paths.ts';

const ROUTES = buildRouteTree();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All path-shaped literals across src/, with file:line context. */
function collectPathLiterals() {
  const hits = [];
  for (const file of walkSources()) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    for (const { value, start } of extractLiterals(text)) {
      if (!isPathLiteral(value)) continue;
      const rel = relative(repoRoot(), file).split(sep).join('/');
      hits.push({ value, file: rel, line: lineOf(text, start), text, start });
    }
  }
  return hits;
}

/** Role gates declared by layouts, keyed by the URL prefix they protect. */
function collectGates() {
  const gates = [];
  for (const file of walkFiles(appDir())) {
    if (!file.endsWith('layout.tsx')) continue;
    const text = readFileSync(file, 'utf8');
    const m = text.match(/requireRole\(\s*\[([^\]]*)\]/);
    if (!m) continue;
    const roles = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    const rel = relative(appDir(), file).split(sep).join('/');
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    const segs = dir.split('/').filter((s) => s && !/^\(.*\)$/.test(s));
    const prefix = segs.length === 0 ? '/' : '/' + segs.join('/');
    gates.push({ prefix, roles, file: 'src/app/' + rel });
  }
  return gates;
}

const GATES = collectGates();

function gateFor(route) {
  let best = null;
  for (const g of GATES) {
    if (g.prefix === '/') continue;
    if (route === g.prefix || route.startsWith(g.prefix + '/')) {
      if (!best || g.prefix.length > best.prefix.length) best = g;
    }
  }
  return best;
}

function flattenNav(items, out = []) {
  for (const item of items) {
    out.push(item);
    if (item.children) flattenNav(item.children, out);
  }
  return out;
}

const ROLES = ['super_admin', 'faculty', 'student'];

// Pages that exist but are deliberately not linked from anywhere:
//  - /admin/debug: URL-only diagnostics utility, self-gated to super_admin
//  - /student/{notifications,profile}: redirect stubs kept for old links
const ORPHAN_ALLOWLIST = new Set([
  '/admin/debug',
  '/student/notifications',
  '/student/profile',
]);

// ---------------------------------------------------------------------------
// 1. Dead links
// ---------------------------------------------------------------------------

test('route tree is discoverable', () => {
  assert.ok(ROUTES.size > 50, `expected a full route tree, got ${ROUTES.size}`);
  for (const expected of ['/', '/login', '/register', '/admin', '/faculty', '/student', '/api/auth/callback']) {
    assert.ok(ROUTES.has(expected), `route tree missing ${expected}`);
  }
});

test('every path literal in src/ resolves to a real route', () => {
  const failures = [];
  for (const hit of collectPathLiterals()) {
    const context = hit.text.slice(Math.max(0, hit.start - 60), hit.start);

    // startsWith() literals are path prefixes, not links: at least one real
    // route must live under the prefix (keeps proxy public-route exemptions
    // from rotting when routes are renamed or removed).
    if (/startsWith\(\s*$/.test(context)) {
      const hit2 = [...ROUTES.keys()].some((r) => r.startsWith(hit.value) || (hit.value.endsWith('/') && r.startsWith(hit.value.slice(0, -1))));
      if (!hit2) {
        failures.push(`${hit.file}:${hit.line}  startsWith("${hit.value}") prefixes no route`);
      }
      continue;
    }

    const target = normalizeTarget(hit.value);
    if (target === null) continue; // not shaped like a route path
    if (matchRoute(target, ROUTES) === null) {
      failures.push(`${hit.file}:${hit.line}  ->  ${hit.value}  [normalized: ${target}]`);
    }
  }
  assert.deepEqual(failures, [], `dead link targets:\n${failures.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 2. Hash anchors
// ---------------------------------------------------------------------------

test('hash links target anchors that exist on the destination page', () => {
  const failures = [];
  for (const hit of collectPathLiterals()) {
    const hash = hit.value.indexOf('#');
    if (hash <= 0) continue; // no path part (e.g. "#features") -> out of scope
    const rawPath = hit.value.slice(0, hash);
    const anchor = hit.value.slice(hash + 1).split(/[?#]/)[0];
    if (!rawPath.startsWith('/') || !anchor) continue;

    const target = normalizeTarget(rawPath);
    const route = matchRoute(target, ROUTES);
    if (route === null) continue; // dead-link test reports the bad path

    const pageFile = ROUTES.get(route);
    if (!pageFile || !pageFile.endsWith('page.tsx')) continue;
    const dir = dirname(pageFile);
    const found = walkFiles(dir).some((f) => {
      if (!/\.(ts|tsx)$/.test(f)) return false;
      const body = readFileSync(f, 'utf8');
      return (
        body.includes(`id="${anchor}"`) ||
        body.includes(`id='${anchor}'`) ||
        body.includes(`id={\`${anchor}\`}`)
      );
    });
    if (!found) {
      failures.push(`${hit.file}:${hit.line}  ${hit.value}  -> no id="${anchor}" under ${relative(repoRoot(), dir)}`);
    }
  }
  assert.deepEqual(failures, [], `broken anchors:\n${failures.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 3. Per-role navigation wiring
// ---------------------------------------------------------------------------

test('role gates are discovered from layouts', () => {
  // If this fails, the per-role assertions below would silently pass with no
  // gates to check — so require the three known role layouts to parse.
  assert.ok(GATES.length >= 3, `expected >=3 requireRole layout gates, got ${GATES.length}: ${JSON.stringify(GATES)}`);
  for (const role of ROLES) {
    assert.ok(
      GATES.some((g) => g.roles.includes(role)),
      `no layout gate accepts role ${role}`
    );
  }
});

test('every role nav item resolves to a route that role may access', () => {
  const failures = [];
  for (const role of ROLES) {
    const groups = GLOBAL_NAVIGATION[role];
    if (!Array.isArray(groups) || groups.length === 0) {
      failures.push(`GLOBAL_NAVIGATION[${role}] is empty or missing`);
      continue;
    }
    for (const item of flattenNav(groups)) {
      if (!item.href || item.href.startsWith('#')) continue;
      const where = `${role} nav "${item.id || item.label}"`;

      if (Array.isArray(item.roles) && item.roles.length > 0 && !item.roles.includes(role)) {
        failures.push(`${where}: item.roles ${JSON.stringify(item.roles)} excludes owning role ${role}`);
      }

      const target = normalizeTarget(item.href);
      const route = target === null ? null : matchRoute(target, ROUTES);
      if (route === null) {
        failures.push(`${where}: ${item.href} -> no matching route`);
        continue;
      }

      const gate = gateFor(route);
      if (gate && !gate.roles.includes(role)) {
        failures.push(`${where}: ${item.href} is gated by ${gate.file} to [${gate.roles}] — ${role} would be bounced away`);
      }
    }

    // The role's own home (target of cross-role redirects) must exist and be
    // accessible to that role.
    const home = homePathForRole(role);
    const homeRoute = normalizeTarget(home);
    if (homeRoute === null || matchRoute(homeRoute, ROUTES) === null) {
      failures.push(`homePathForRole(${role}) = ${home} -> no matching route`);
    } else {
      const gate = gateFor(homeRoute);
      if (gate && !gate.roles.includes(role)) {
        failures.push(`homePathForRole(${role}) = ${home} gated to [${gate.roles}]`);
      }
    }
  }
  assert.deepEqual(failures, [], `role nav wiring failures:\n${failures.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 4. Orphan routes
// ---------------------------------------------------------------------------

test('every page route is linked from somewhere or allowlisted', () => {
  const linked = new Set();
  for (const hit of collectPathLiterals()) {
    const context = hit.text.slice(Math.max(0, hit.start - 60), hit.start);
    if (/startsWith\(\s*$/.test(context)) continue;
    const target = normalizeTarget(hit.value);
    if (target === null) continue;
    const route = matchRoute(target, ROUTES);
    if (route) linked.add(route);
  }

  const orphans = [];
  for (const route of ROUTES.keys()) {
    if (route.startsWith('/api/')) continue; // server-to-server; called by fetch literals
    if (linked.has(route) || ORPHAN_ALLOWLIST.has(route)) continue;
    orphans.push(route);
  }
  assert.deepEqual(
    orphans,
    [],
    `unlinked routes (link them, or add to ORPHAN_ALLOWLIST with a reason):\n${orphans.join('\n')}`
  );
});
