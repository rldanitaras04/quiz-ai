// Proctoring & conclusion guarantees (scope §42). Runs in `npm test` (no server).
//
// Enforced invariants:
//  1. Concluding an attempt is a SUBMISSION: one shared status rule decides
//     manual `submitted` vs deadline `auto_submitted` (+ session close reason)
//     for both the student's own Submit and the proctor/faculty conclude.
//  2. A proctor-only viewer's workspace tabs narrow to exactly the Live
//     Monitor — every other tab sits behind a faculty guard they fail.
//  3. Both the faculty and admin sidebars expose the proctoring page.
//  4. Every conclude affordance renders in the danger (red) style, and the
//     monitor wires per-student selection into a deployment-scoped
//     conclude-selected action (faculty or assigned proctor only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { conclusionPlanFor } from '../src/lib/conclude.ts';
import {
  GLOBAL_NAVIGATION,
  ROUTES,
  getAssessmentWorkspaceNav,
  proctorOnlyWorkspaceNav,
} from '../src/config/navigation.ts';

// ---------------------------------------------------------------------------
// 1. Conclusion = submission (scope §42 / §25 separation)
// ---------------------------------------------------------------------------

test('concluding before the deadline records a manual submission', () => {
  const plan = conclusionPlanFor(
    '2026-10-03T10:00:00.000Z',
    '2026-10-03T09:59:59.000Z'
  );
  assert.equal(plan.status, 'submitted');
  assert.equal(plan.sessionCloseReason, 'submitted');
  assert.equal(plan.autoSubmitted, false);
});

test('concluding after the deadline records the expiry, never a turn-in', () => {
  const plan = conclusionPlanFor(
    '2026-10-03T10:00:00.000Z',
    '2026-10-03T10:00:01.000Z'
  );
  assert.equal(plan.status, 'auto_submitted');
  assert.equal(plan.sessionCloseReason, 'expired');
  assert.equal(plan.autoSubmitted, true);
});

test('identical timestamps are not yet expired (strict <, as at submit time)', () => {
  const plan = conclusionPlanFor(
    '2026-10-03T10:00:00.000Z',
    '2026-10-03T10:00:00.000Z'
  );
  assert.equal(plan.status, 'submitted');
  assert.equal(plan.sessionCloseReason, 'submitted');
  assert.equal(plan.autoSubmitted, false);
});

test('a missing or empty deadline never auto-submits an attempt', () => {
  for (const expiresAt of [null, undefined, '']) {
    const plan = conclusionPlanFor(expiresAt, '2026-10-03T10:00:00.000Z');
    assert.equal(plan.status, 'submitted', `expiresAt=${String(expiresAt)}`);
    assert.equal(plan.sessionCloseReason, 'submitted');
    assert.equal(plan.autoSubmitted, false);
  }
});

test('conclusion never produces a penalty status (§42: terminate stays separate)', () => {
  const now = '2026-10-03T10:00:00.000Z';
  for (const expiresAt of [null, '2026-10-03T09:00:00.000Z', '2026-10-03T11:00:00.000Z']) {
    const { status } = conclusionPlanFor(expiresAt, now);
    assert.ok(
      status === 'submitted' || status === 'auto_submitted',
      `unexpected status ${status}`
    );
    assert.notEqual(status, 'invalidated');
  }
});

// ---------------------------------------------------------------------------
// 2. Proctor-only workspace navigation
// ---------------------------------------------------------------------------

test('a proctor-only viewer sees exactly the Live Monitor tab', () => {
  const items = getAssessmentWorkspaceNav('off-1', 'ass-1');
  const filtered = proctorOnlyWorkspaceNav(items);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, 'assess-monitor');
  assert.equal(
    filtered[0].href,
    '/faculty/subjects/off-1/assessments/ass-1/monitor'
  );
  // Faculty keeps every workspace tab.
  assert.ok(items.length > filtered.length);
});

test('the workspace nav actually contains the monitor tab the filter targets', () => {
  // Guards the filter above against the tab id being renamed: the proctor
  // view would silently become an empty nav.
  const ids = getAssessmentWorkspaceNav('off-1', 'ass-1').map((i) => i.id);
  assert.ok(ids.includes('assess-monitor'), `ids: ${ids.join(', ')}`);
  assert.ok(ids.includes('assess-overview'));
});

// ---------------------------------------------------------------------------
// 3. Entry points: both assignable roles reach /faculty/proctoring
// ---------------------------------------------------------------------------

function flattenNav(groups) {
  const out = [];
  const walk = (items) => {
    for (const item of items) {
      out.push(item);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  for (const g of groups) walk(g.items);
  return out;
}

test('faculty and admin sidebars both expose the proctoring page', () => {
  assert.equal(ROUTES.facultyProctoring, '/faculty/proctoring');

  const facultyItem = flattenNav(GLOBAL_NAVIGATION.faculty).find(
    (i) => i.href === ROUTES.facultyProctoring
  );
  const adminItem = flattenNav(GLOBAL_NAVIGATION.super_admin).find(
    (i) => i.href === ROUTES.facultyProctoring
  );

  assert.ok(facultyItem, 'faculty nav is missing the Proctoring item');
  assert.ok(adminItem, 'admin nav is missing the Proctoring item');
});

// ---------------------------------------------------------------------------
// 4. Monitor conclude wiring: red conclude actions + per-student selection
// ---------------------------------------------------------------------------

const monitorDir = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'src',
  'app',
  '(dashboard)',
  'faculty',
  'subjects',
  '[offeringId]',
  'assessments',
  '[assessmentId]',
  'monitor'
);
const monitorClientSrc = readFileSync(join(monitorDir, 'MonitorClient.tsx'), 'utf8');
const monitorActionsSrc = readFileSync(join(monitorDir, 'actions.ts'), 'utf8');

test('every conclude action renders in the danger (red) style', () => {
  // Header "Conclude exam…" (conclude-all)
  assert.match(
    monitorClientSrc,
    /variant="danger"[\s\S]{0,200}setConcludeAllOpen\(true\)/,
    'the conclude-all header button is no longer a danger button'
  );
  // Per-row Conclude button
  assert.match(
    monitorClientSrc,
    /variant="danger"[\s\S]{0,160}handleConclude\(row\)/,
    'the row-level Conclude button is no longer a danger button'
  );
  // Bulk "Conclude selected…" bar button
  assert.match(
    monitorClientSrc,
    /variant="danger"[\s\S]{0,200}setConcludeSelectedOpen\(true\)/,
    'the conclude-selected bar button is no longer a danger button'
  );
  // Both confirmation modals confirm in red.
  const dangerConfirms =
    monitorClientSrc.match(/variant="danger"\s+onClick=\{handleConclude(?:All|Selected)\}/g) ?? [];
  assert.equal(dangerConfirms.length, 2, `danger confirms: ${dangerConfirms.length}`);
});

test('the monitor wires per-student selection into a conclude action', () => {
  // Selection checkboxes: per in-progress row + the header select-all.
  assert.match(monitorClientSrc, /aria-label=\{`Select \$\{row\.student\.fullName\}`\}/);
  assert.match(monitorClientSrc, /aria-label="Select all in-progress students shown"/);
  // The confirm dialog must warn about unsynced answers (§42 constraint).
  assert.match(monitorClientSrc, /selectedPendingSyncRows/);
  // The client calls the bulk action with exactly the picked attempt ids.
  assert.match(
    monitorClientSrc,
    /concludeSelectedAttempts\(\s*\{\s*deploymentId,\s*attemptIds: ids,/
  );
  // The server action exists, authorizes at deployment level, and re-scopes
  // the id list to this deployment so a forged list cannot touch another sitting.
  assert.match(monitorActionsSrc, /export async function concludeSelectedAttempts/);
  const body = monitorActionsSrc.slice(
    monitorActionsSrc.indexOf('export async function concludeSelectedAttempts')
  );
  assert.match(body, /await authorizeDeployment\(/);
  assert.match(body, /\.eq\('deployment_id', input\.deploymentId\)/);
  assert.match(body, /\.in\('id', attemptIds\)/);
});
