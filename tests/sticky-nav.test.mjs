// Sticky navigation guarantees. Runs in `npm test` (no server).
//
// Enforced invariants:
//  1. The app shell fits the VISIBLE viewport (`h-dvh`, never `h-screen`):
//     on mobile browsers 100vh is the larger (URL-bar-hidden) viewport, so a
//     100vh shell overflows the document and the top bar + bottom tab bar
//     scroll away instead of staying fixed.
//  2. Only the main pane scrolls, and its overscroll is contained so edge
//     gestures (rubber-banding, pull to refresh) cannot chain to the document
//     and drag the chrome.
//  3. The in-page mobile workspace tab rows stick under the top bar, with an
//     opaque background and a stacking level, so content never shows through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');

const WORKSPACE_TAB_FILES = [
  ['src', 'app', '(dashboard)', 'student', 'subjects', '[offeringId]', 'StudentSubjectWorkspaceClient.tsx'],
  ['src', 'app', '(dashboard)', 'faculty', 'subjects', '[offeringId]', 'FacultySubjectWorkspaceClient.tsx'],
  ['src', 'app', '(dashboard)', 'faculty', 'subjects', '[offeringId]', 'assessments', '[assessmentId]', 'AssessmentWorkspaceClient.tsx'],
];

test('the app shell is sized to the visible viewport', () => {
  const src = read('src', 'components', 'layout', 'AppShell.tsx');
  assert.match(src, /flex h-dvh overflow-hidden/, 'shell root must use the dynamic viewport height');
  assert.doesNotMatch(
    src,
    /h-screen/,
    'h-screen (100vh) overflows the mobile visible viewport and scrolls the chrome'
  );
});

test('only the main pane scrolls and its overscroll is contained', () => {
  const src = read('src', 'components', 'layout', 'AppShell.tsx');
  const main = src.match(/<main[^>]*>/)?.[0];
  assert.ok(main, 'AppShell must render the main scrollpane');
  assert.match(main, /overflow-y-auto/, 'main must be the scroll container');
  assert.match(
    main,
    /overscroll-contain/,
    'edge gestures must not chain to the document and drag the shell'
  );
});

test('in-page workspace tabs stick under the top bar', () => {
  for (const parts of WORKSPACE_TAB_FILES) {
    const src = read(...parts);
    const rel = parts.join('/');
    const nav = src.match(/<nav[^>]*lg:hidden[^>]*>/)?.[0];
    assert.ok(nav, `${rel}: mobile in-page nav not found`);
    assert.match(nav, /sticky top-0/, `${rel}: tabs must stick to the top of the scrollport`);
    assert.match(nav, /z-10/, `${rel}: sticky tabs need a stacking level`);
    assert.match(
      nav,
      /bg-\[var\(--color-background\)\]/,
      `${rel}: sticky tabs must be opaque so content cannot show through`
    );
  }
});
