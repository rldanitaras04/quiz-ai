import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateEmail,
  validatePassword,
  validateStudentNumber,
  validateDurationMinutes,
  validateAttemptLimit,
  validateRequired,
  validateUuid,
} from '../src/lib/validators.ts';

test('validateEmail accepts a normal address', () => {
  assert.equal(validateEmail('student@test.com').success, true);
});

test('validateEmail rejects malformed addresses', () => {
  for (const bad of ['', 'no-at-sign', 'a@b', 'a b@c.com', '@test.com']) {
    const result = validateEmail(bad);
    assert.equal(result.success, false, `${bad} should be rejected`);
    assert.equal(result.errors[0].field, 'email');
  }
});

test('validatePassword enforces all four rules at once', () => {
  assert.equal(validatePassword('Student123!').success, true);

  const tooShort = validatePassword('Ab1');
  assert.equal(tooShort.success, false);
  assert.ok(tooShort.errors.some((e) => e.message.includes('at least 8')));

  const noUpper = validatePassword('student123');
  assert.equal(noUpper.success, false);
  assert.ok(noUpper.errors.some((e) => e.message.includes('uppercase')));

  const noLower = validatePassword('STUDENT123');
  assert.equal(noLower.success, false);
  assert.ok(noLower.errors.some((e) => e.message.includes('lowercase')));

  const noDigit = validatePassword('StudentName');
  assert.equal(noDigit.success, false);
  assert.ok(noDigit.errors.some((e) => e.message.includes('number')));
});

test('validateStudentNumber allows letters, digits and hyphens only', () => {
  assert.equal(validateStudentNumber('2024-0001').success, true);
  assert.equal(validateStudentNumber('S-12345').success, true);
  assert.equal(validateStudentNumber('2024 0001').success, false);
  assert.equal(validateStudentNumber('2024/0001').success, false);
  assert.equal(validateStudentNumber('').success, false);
});

test('validateDurationMinutes allows 1–480 minutes', () => {
  assert.equal(validateDurationMinutes(60).success, true);
  assert.equal(validateDurationMinutes(1).success, true);
  assert.equal(validateDurationMinutes(480).success, true);
  assert.equal(validateDurationMinutes(0).success, false);
  assert.equal(validateDurationMinutes(481).success, false);
});

test('validateAttemptLimit allows 1–10 attempts', () => {
  assert.equal(validateAttemptLimit(1).success, true);
  assert.equal(validateAttemptLimit(10).success, true);
  assert.equal(validateAttemptLimit(0).success, false);
  assert.equal(validateAttemptLimit(11).success, false);
});

test('validateRequired rejects null, undefined and empty string', () => {
  assert.equal(validateRequired(null, 'title').success, false);
  assert.equal(validateRequired(undefined, 'title').success, false);
  assert.equal(validateRequired('', 'title').success, false);
  assert.equal(validateRequired('ok', 'title').success, true);
});

test('validateUuid only accepts canonical uuids', () => {
  assert.equal(validateUuid('ad754535-6873-4539-bb23-6f33aa2cd95f', 'id').success, true);
  assert.equal(validateUuid('not-a-uuid', 'id').success, false);
  assert.equal(validateUuid('', 'id').success, false);
});
