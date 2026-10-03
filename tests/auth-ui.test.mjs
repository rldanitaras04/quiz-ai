// Auth password reveal-toggle guarantees. Runs in `npm test` (no server).
//
// Enforced invariants:
//  1. Every password field on the account screens (login, register, and the
//     initial admin setup) goes through the shared Input with `revealable`,
//     so users can check what they typed before submitting.
//  2. Input implements the toggle itself: Show/Hide labels, type="button"
//     (it must never submit the form), password-only activation, and the
//     right padding that keeps the icon from overlapping the text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8');

const PASSWORD_FIELD_FILES = [
  ['src', 'app', '(auth)', 'login', 'page.tsx'],
  ['src', 'app', '(auth)', 'register', 'RegisterForm.tsx'],
  ['src', 'app', 'setup', 'page.tsx'],
];

test('every auth password field is revealable', () => {
  for (const parts of PASSWORD_FIELD_FILES) {
    const src = read(...parts);
    const rel = parts.join('/');
    assert.match(src, /type="password"/, `${rel}: no password field found`);
    // The toggle prop must sit on the same JSX element as type="password".
    assert.match(
      src,
      /type="password"[\s\S]{0,200}revealable/,
      `${rel}: password field is missing revealable`
    );
  }
});

test('the Input reveal toggle is wired safely', () => {
  const src = read('src', 'components', 'ui', 'Input.tsx');
  // The prop exists and only activates for password fields.
  assert.match(src, /revealable\?: boolean/);
  assert.match(src, /revealable && type === 'password'/);
  // The button announces the action it will perform.
  assert.match(src, /revealed \? 'Hide password' : 'Show password'/);
  // type="button" — toggling visibility must never submit the form.
  assert.match(src, /type="button"/);
  // Padding so the eye icon never sits on top of the typed characters.
  assert.match(src, /pr-10/);
});
