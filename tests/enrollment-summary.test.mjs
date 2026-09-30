import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptySummary,
  mergeSummaries,
  describeSummary,
} from '../src/lib/enrollment-summary.ts';

test('emptySummary starts every counter at zero', () => {
  assert.deepEqual(emptySummary(), {
    added: 0,
    reenrolled: 0,
    alreadyEnrolled: 0,
    notFound: [],
    failed: 0,
  });
});

test('mergeSummaries adds counters and concatenates notFound', () => {
  const merged = mergeSummaries(
    { added: 2, reenrolled: 1, alreadyEnrolled: 3, notFound: ['a'], failed: 1 },
    { added: 5, reenrolled: 0, alreadyEnrolled: 1, notFound: ['b', 'c'], failed: 0 }
  );
  assert.deepEqual(merged, {
    added: 7,
    reenrolled: 1,
    alreadyEnrolled: 4,
    notFound: ['a', 'b', 'c'],
    failed: 1,
  });
});

test('describeSummary omits zero counters and joins the rest', () => {
  assert.equal(
    describeSummary({ added: 2, reenrolled: 1, alreadyEnrolled: 0, notFound: ['x'], failed: 1 }),
    '2 added · 1 re-enrolled · 1 not found · 1 failed'
  );
});

test('describeSummary reports "No changes" for an untouched summary', () => {
  assert.equal(describeSummary(emptySummary()), 'No changes');
  assert.equal(
    describeSummary({ added: 0, reenrolled: 0, alreadyEnrolled: 2, notFound: [], failed: 0 }),
    '2 already enrolled'
  );
});
