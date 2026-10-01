import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isRateLimitAuthError,
  isRefreshRaceError,
  isTransientAuthError,
  withAuthRetry,
} from '../src/lib/auth-errors.ts';

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

test('over_request_rate_limit is transient and a rate limit', () => {
  const error = { code: 'over_request_rate_limit', status: 429, __isAuthError: true };
  assert.equal(isTransientAuthError(error), true);
  assert.equal(isRateLimitAuthError(error), true);
  assert.equal(isRefreshRaceError(error), false);
});

test('refresh_token_already_used is transient but not a rate limit', () => {
  const error = { code: 'refresh_token_already_used', status: 400, __isAuthError: true };
  assert.equal(isTransientAuthError(error), true);
  assert.equal(isRateLimitAuthError(error), false);
  assert.equal(isRefreshRaceError(error), true);
});

test('a bare 429 status without a code is still treated as a rate limit', () => {
  assert.equal(isTransientAuthError({ status: 429 }), true);
  assert.equal(isRateLimitAuthError({ status: 429 }), true);
});

test('permanent auth failures are not transient', () => {
  const invalidCredentials = { code: 'invalid_credentials', status: 400 };
  const sessionExpired = { code: 'session_expired', status: 400 };
  assert.equal(isTransientAuthError(invalidCredentials), false);
  assert.equal(isTransientAuthError(sessionExpired), false);
  assert.equal(isRateLimitAuthError(invalidCredentials), false);
  assert.equal(isRefreshRaceError(invalidCredentials), false);
});

test('null, undefined and non-auth errors are not transient', () => {
  assert.equal(isTransientAuthError(null), false);
  assert.equal(isTransientAuthError(undefined), false);
  assert.equal(isTransientAuthError('boom'), false);
  assert.equal(isTransientAuthError(new Error('boom')), false);
});

test('a successful result (error: null) is not transient', () => {
  assert.equal(isTransientAuthError(null), false);
});

// ---------------------------------------------------------------------------
// withAuthRetry
// ---------------------------------------------------------------------------

const rateLimitError = { code: 'over_request_rate_limit', status: 429 };
const refreshRaceError = { code: 'refresh_token_already_used', status: 400 };
const fatalError = { code: 'invalid_credentials', status: 400 };

test('returns the first result when there is no error', async () => {
  let calls = 0;
  const result = await withAuthRetry(async () => {
    calls += 1;
    return { data: { user: { id: 'u1' } }, error: null };
  }, { baseDelayMs: 1 });

  assert.equal(calls, 1);
  assert.equal(result.error, null);
  assert.equal(result.data.user.id, 'u1');
});

test('retries a rate limit and succeeds', async () => {
  let calls = 0;
  const result = await withAuthRetry(async () => {
    calls += 1;
    if (calls < 3) return { data: null, error: rateLimitError };
    return { data: { user: { id: 'u1' } }, error: null };
  }, { baseDelayMs: 1 });

  assert.equal(calls, 3);
  assert.equal(result.error, null);
});

test('gives up after the configured number of retries', async () => {
  let calls = 0;
  const result = await withAuthRetry(async () => {
    calls += 1;
    return { data: null, error: rateLimitError };
  }, { retries: 2, baseDelayMs: 1 });

  assert.equal(calls, 3); // first attempt + 2 retries
  assert.equal(result.error, rateLimitError);
});

test('does not retry a non-transient error', async () => {
  let calls = 0;
  const result = await withAuthRetry(async () => {
    calls += 1;
    return { data: null, error: fatalError };
  }, { baseDelayMs: 1 });

  assert.equal(calls, 1);
  assert.equal(result.error, fatalError);
});

test('retries a refresh-token race by default', async () => {
  let calls = 0;
  const result = await withAuthRetry(async () => {
    calls += 1;
    if (calls === 1) return { data: null, error: refreshRaceError };
    return { data: { user: { id: 'u1' } }, error: null };
  }, { baseDelayMs: 1 });

  assert.equal(calls, 2);
  assert.equal(result.error, null);
});

test('retryRefreshRace: false skips the refresh-token race retry (server)', async () => {
  let calls = 0;
  const result = await withAuthRetry(
    async () => {
      calls += 1;
      return { data: null, error: refreshRaceError };
    },
    { retryRefreshRace: false, baseDelayMs: 1 }
  );

  assert.equal(calls, 1);
  assert.equal(result.error, refreshRaceError);
});
