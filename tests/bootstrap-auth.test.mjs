// Authorization policy guarantees for `/api/admin/bootstrap`.
//
// Runs in `npm test` (no server needed). `src/lib/bootstrap-policy.ts` is
// deliberately dependency-free so it can be imported here through Node's type
// stripping; the route itself pulls in Next and the Supabase clients, which
// only resolve inside the Next bundler, so those parts are asserted by reading
// the route source instead.
//
// Enforced invariants:
//  1. The action lists partition the known-action set with no overlap.
//  2. Every `action === '...'` comparison in the route sits BELOW the
//     `requireSuperAdmin()` gate — nothing is decided before authorization.
//  3. The actions handled above the gate are exactly the pre-auth list.
//  4. The removed `create_test_student` action is gone from code and policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  AUTHENTICATED_ACTIONS,
  BOOTSTRAP_WINDOW_ACTIONS,
  KNOWN_ACTIONS,
  PRE_AUTH_ACTIONS,
  PUBLIC_ACTIONS,
  checkRequiredEnv,
  isBootstrapWindowAction,
  isKnownAction,
  isPublicAction,
  parseCreateAdminInput,
  parseUserId,
} from '../src/lib/bootstrap-policy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROUTE_SRC = readFileSync(
  join(here, '..', 'src', 'app', 'api', 'admin', 'bootstrap', 'route.ts'),
  'utf8'
);

// ---------------------------------------------------------------------------
// 1. Action lists
// ---------------------------------------------------------------------------

test('action lists partition the known set with no overlap', () => {
  const all = [...PUBLIC_ACTIONS, ...BOOTSTRAP_WINDOW_ACTIONS, ...AUTHENTICATED_ACTIONS];
  assert.equal(new Set(all).size, all.length, 'an action appears in two lists');
  assert.deepEqual([...KNOWN_ACTIONS].sort(), [...all].sort());
});

test('the pre-auth list is exactly public + bootstrap window', () => {
  assert.deepEqual(
    [...PRE_AUTH_ACTIONS].sort(),
    [...PUBLIC_ACTIONS, ...BOOTSTRAP_WINDOW_ACTIONS].sort()
  );
});

test('type guards accept only their own list', () => {
  for (const a of PUBLIC_ACTIONS) {
    assert.equal(isPublicAction(a), true);
    assert.equal(isBootstrapWindowAction(a), false);
  }
  for (const a of BOOTSTRAP_WINDOW_ACTIONS) {
    assert.equal(isBootstrapWindowAction(a), true);
    assert.equal(isPublicAction(a), false);
  }
  for (const a of AUTHENTICATED_ACTIONS) {
    assert.equal(isPublicAction(a), false);
    assert.equal(isBootstrapWindowAction(a), false);
    assert.equal(isKnownAction(a), true);
  }
  assert.equal(isKnownAction('nope'), false);
  assert.equal(isKnownAction(undefined), false);
});

// ---------------------------------------------------------------------------
// 2 & 3. Route source: nothing decided before the auth gate
// ---------------------------------------------------------------------------

/** Every `action === 'literal'` string comparison in the route. */
function literalComparisons(src) {
  const out = [];
  const re = /action\s*===\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src)) !== null) out.push({ value: m[1], index: m.index });
  return out;
}

test('the route handles pre-auth actions through the policy guards', () => {
  assert.match(
    ROUTE_SRC,
    /isPublicAction\(action\)/,
    'route must branch on isPublicAction(action)'
  );
  assert.match(
    ROUTE_SRC,
    /isBootstrapWindowAction\(action\)/,
    'route must branch on isBootstrapWindowAction(action)'
  );
});

test('every literal action comparison sits below the requireSuperAdmin gate', () => {
  const gate = ROUTE_SRC.indexOf('await requireSuperAdmin()');
  assert.ok(gate > -1, 'requireSuperAdmin() call not found in the route');

  for (const { value, index } of literalComparisons(ROUTE_SRC)) {
    assert.ok(
      index > gate,
      `action === '${value}' is evaluated above the auth gate`
    );
  }
});

test('literal comparisons below the gate are exactly the authenticated actions', () => {
  const literals = [...new Set(literalComparisons(ROUTE_SRC).map((c) => c.value))].sort();
  assert.deepEqual(literals, [...AUTHENTICATED_ACTIONS].sort());
});

// ---------------------------------------------------------------------------
// 4. create_test_student is gone
// ---------------------------------------------------------------------------

test('create_test_student is absent from both code and policy', () => {
  assert.ok(!ROUTE_SRC.includes('create_test_student'), 'route still mentions create_test_student');
  assert.ok(
    !KNOWN_ACTIONS.includes('create_test_student'),
    'policy still knows create_test_student'
  );
});

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

test('parseCreateAdminInput rejects missing or weak credentials', () => {
  assert.equal(parseCreateAdminInput(undefined).ok, false);
  assert.equal(parseCreateAdminInput({ email: 'a@b.com' }).ok, false);
  assert.equal(parseCreateAdminInput({ email: 'not-an-email', password: 'longenough', fullName: 'X' }).ok, false);
  assert.equal(parseCreateAdminInput({ email: 'a@b.com', password: 'short', fullName: 'X' }).ok, false);
});

test('parseCreateAdminInput accepts a well-formed payload without defaulting credentials', () => {
  const parsed = parseCreateAdminInput({
    email: 'admin@example.com',
    password: 'supersecret',
    fullName: 'Site Admin',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.email, 'admin@example.com');
  assert.equal(parsed.value.password, 'supersecret');
  assert.equal(parsed.value.fullName, 'Site Admin');
});

test('parseUserId requires a non-empty string', () => {
  assert.equal(parseUserId({}).ok, false);
  assert.equal(parseUserId({ userId: '' }).ok, false);
  assert.equal(parseUserId({ userId: 123 }).ok, false);
  assert.equal(parseUserId({ userId: 'u1' }).ok, true);
});

// ---------------------------------------------------------------------------
// checkRequiredEnv: booleans only, no values, no AI-provider recon
// ---------------------------------------------------------------------------

test('checkRequiredEnv reports only the wizard-required Supabase vars', () => {
  const report = checkRequiredEnv({});
  assert.equal(report.success, false);
  assert.deepEqual(report.missing, [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]);
});

test('checkRequiredEnv succeeds and leaks no values', () => {
  const report = checkRequiredEnv({
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service',
  });
  assert.equal(report.success, true);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(Object.keys(report).sort(), ['missing', 'success']);
});
