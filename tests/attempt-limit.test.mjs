import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTABLE_ATTEMPT_STATUSES,
  countUsedAttempts,
  hasRemainingAttempts,
  isCountableAttempt,
} from '../src/lib/attempt-limit.ts';

test('every countable status consumes a seat', () => {
  for (const status of COUNTABLE_ATTEMPT_STATUSES) {
    assert.equal(isCountableAttempt(status), true, `${status} should be countable`);
  }
});

test('only "cancelled" is exempt from the attempt limit', () => {
  assert.equal(isCountableAttempt('cancelled'), false);
  assert.equal(isCountableAttempt('unknown_status'), false);
  assert.equal(isCountableAttempt(''), false);
});

test('countUsedAttempts ignores cancelled rows', () => {
  const attempts = [
    { status: 'submitted' },
    { status: 'cancelled' },
    { status: 'timed_out' },
    { status: 'in_progress' },
    { status: 'expired' },
    { status: 'cancelled' },
  ];
  assert.equal(countUsedAttempts(attempts), 4);
});

test('a timed-out student still consumes the seat they used', () => {
  const attempts = [{ status: 'timed_out' }, { status: 'expired' }];
  assert.equal(countUsedAttempts(attempts), 2);
  assert.equal(hasRemainingAttempts(attempts, 2), false);
  assert.equal(hasRemainingAttempts(attempts, 3), true);
});

test('an empty roster leaves the full limit available', () => {
  assert.equal(countUsedAttempts([]), 0);
  assert.equal(hasRemainingAttempts([], 1), true);
  assert.equal(hasRemainingAttempts([], 0), false);
});

test('attempt_limit of 0 blocks everyone, even with only cancelled history', () => {
  assert.equal(hasRemainingAttempts([], 0), false);
  assert.equal(hasRemainingAttempts([{ status: 'cancelled' }], 0), false);
});
