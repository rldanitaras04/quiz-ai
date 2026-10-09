// Rate limiter behaviour. Runs in `npm test` with no server or environment.
//
// The regression this suite exists to prevent: the two hand-rolled limiters it
// replaces kept every key that ever called them for the life of the process,
// so memory grew with the number of distinct users rather than with the number
// of *active* users. The `maxKeys` tests below fail if that ceiling is lost.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createRateLimiter } from '../src/lib/rate-limit.ts';

/** Deterministic clock so window behaviour is exact, not timing-dependent. */
function clock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
      return t;
    },
  };
}

test('allows up to max requests then denies', () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 1_000, max: 3, now: c.now });

  assert.equal(limiter.check('u1'), true);
  assert.equal(limiter.check('u1'), true);
  assert.equal(limiter.check('u1'), true);
  assert.equal(limiter.check('u1'), false, '4th request in the window must be denied');
});

test('limits each key independently', () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 1_000, max: 1, now: c.now });

  assert.equal(limiter.check('a'), true);
  assert.equal(limiter.check('a'), false);
  assert.equal(limiter.check('b'), true, 'b must not be affected by a');
});

test('the window slides: requests are allowed again after it passes', () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 1_000, max: 2, now: c.now });

  assert.equal(limiter.check('u'), true);
  assert.equal(limiter.check('u'), true);
  assert.equal(limiter.check('u'), false);

  c.advance(1_000);
  assert.equal(limiter.check('u'), true, 'the window should have rolled over');
});

test('denied requests are not recorded, so hammering does not extend the lockout', () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 1_000, max: 1, now: c.now });

  assert.equal(limiter.check('u'), true);
  // 50 denied attempts inside the window.
  for (let i = 0; i < 50; i += 1) assert.equal(limiter.check('u'), false);

  c.advance(1_000);
  assert.equal(
    limiter.check('u'),
    true,
    'a client that kept retrying must still be allowed once the original window elapses'
  );
});

test('tracked keys are bounded by maxKeys', () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 5, maxKeys: 3, now: c.now });

  for (let i = 0; i < 100; i += 1) {
    limiter.check(`user-${i}`);
    assert.ok(limiter.size() <= 3, `size exceeded maxKeys after ${i + 1} distinct keys`);
  }
  assert.equal(limiter.size(), 3);
});

test('eviction drops the least-recently-used key, not merely the oldest', () => {
  const c = clock();
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 2, now: c.now });

  assert.equal(limiter.check('a'), true);
  assert.equal(limiter.check('b'), true);
  assert.equal(limiter.check('a'), false, 'a is at its limit and becomes most-recently-used');
  assert.equal(limiter.check('c'), true, 'adding a third key evicts one');

  assert.equal(limiter.size(), 2);
  assert.equal(limiter.check('a'), false, 'a was most recently used, so it must have survived');
  assert.equal(limiter.check('b'), true, 'b was least recently used, so its history must be gone');
});

test('rejects nonsensical configuration', () => {
  assert.throws(() => createRateLimiter({ windowMs: 0, max: 1 }), /windowMs/);
  assert.throws(() => createRateLimiter({ windowMs: 1_000, max: 0 }), /max/);
  assert.throws(() => createRateLimiter({ windowMs: 1_000, max: 1, maxKeys: 0 }), /maxKeys/);
});
