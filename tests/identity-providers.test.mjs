import test from 'node:test';
import assert from 'node:assert/strict';

// The adapter derives its HMAC key lazily at call time.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

import { MediaPipeIdentityAdapter, LIVENESS_CHALLENGES } from '../src/lib/identity/mediapipe.ts';
import {
  getIdentityVerificationAdapter,
  registerIdentityVerificationAdapter,
  isManualRequestResendable,
  MANUAL_REQUEST_COOLDOWN_MS,
} from '../src/lib/identity-verification.ts';

const STUDENT = '11111111-2222-3333-4444-555555555555';
const OTHER_STUDENT = '99999999-8888-7777-6666-555555555555';

const adapter = new MediaPipeIdentityAdapter();

function decodeToken(token) {
  const [body] = token.split('.');
  return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
}

/** Build evidence matching a freshly prepared capture session. */
function makeEvidence(token, overrides = {}) {
  const payload = decodeToken(token);
  return {
    passed: true,
    model: 'face_landmarker',
    totalDurationMs: 5000,
    facePresenceMs: 4500,
    challengeResults: payload.c.map((challenge) => ({ challenge, ok: true, durationMs: 1000 })),
    ...overrides,
  };
}

async function freshCapture(studentUserId = STUDENT) {
  return adapter.prepareCapture({ studentUserId });
}

test('prepareCapture issues 3 unique challenges from the vocabulary and a signed token', async () => {
  const { token, challenges } = await freshCapture();

  assert.equal(challenges.length, 3);
  assert.equal(new Set(challenges).size, 3);
  for (const c of challenges) assert.ok(LIVENESS_CHALLENGES.includes(c));

  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  const payload = decodeToken(token);
  assert.equal(payload.u, STUDENT);
  assert.deepEqual(payload.c, challenges);
  assert.ok(payload.e > payload.i);
});

test('verify refuses without consent', async () => {
  const { token } = await freshCapture();
  const outcome = await adapter.verify({ studentUserId: STUDENT, capture: { ref: token }, evidence: makeEvidence(token) });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'consent_required');
});

test('verify refuses without a capture session', async () => {
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'capture_required');
});

test('verify refuses when evidence is missing', async () => {
  const { token } = await freshCapture();
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'evidence_required');
});

test('happy path: matching evidence verifies and carries only coarse metadata', async () => {
  const { token, challenges } = await freshCapture();
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
    evidence: makeEvidence(token),
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.method, 'provider');
  assert.equal(outcome.provider, 'mediapipe');
  assert.deepEqual(outcome.metadata.challenges, challenges);
  assert.equal(outcome.metadata.model, 'face_landmarker');
  assert.equal(outcome.metadata.total_duration_ms, 5000);
  assert.equal(outcome.metadata.face_presence_ms, 4500);

  // Minimum metadata only: no frames, landmarks, or other biometric material.
  const allowed = new Set([
    'adapter',
    'model',
    'challenges',
    'total_duration_ms',
    'face_presence_ms',
    'issued_at',
    'session_nonce',
  ]);
  for (const key of Object.keys(outcome.metadata)) {
    assert.ok(allowed.has(key), `unexpected metadata key: ${key}`);
  }
});

test('a tampered token is rejected', async () => {
  const { token } = await freshCapture();
  const [body, sig] = token.split('.');
  const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: `${flipped}.${sig}` },
    evidence: makeEvidence(token),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'token_invalid');
});

test("a token issued for another student can't be settled by them", async () => {
  const { token } = await freshCapture(STUDENT);
  const outcome = await adapter.verify({
    studentUserId: OTHER_STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
    evidence: makeEvidence(token),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'account_mismatch');
});

test('an expired token is rejected (10 min TTL + clock skew)', async () => {
  const { token } = await freshCapture();
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 15 * 60 * 1000;
    const outcome = await adapter.verify({
      studentUserId: STUDENT,
      consentGivenAt: new Date().toISOString(),
      capture: { ref: token },
      evidence: makeEvidence(token),
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'token_expired');
  } finally {
    Date.now = realNow;
  }
});

test('evidence claiming a failed liveness flips the refusal to liveness_failed', async () => {
  const { token } = await freshCapture();
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
    evidence: makeEvidence(token, { passed: false }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'liveness_failed');
});

test('a challenge reported as not completed is liveness_failed', async () => {
  const { token } = await freshCapture();
  const evidence = makeEvidence(token);
  evidence.challengeResults[1] = { ...evidence.challengeResults[1], ok: false };
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
    evidence,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'liveness_failed');
});

test('evidence outside the issued challenge set is rejected', async () => {
  const { token } = await freshCapture();
  const issued = decodeToken(token).c;
  // 3 of 4 vocabulary challenges are issued → exactly one is foreign.
  const foreign = LIVENESS_CHALLENGES.find((c) => !issued.includes(c));
  assert.ok(foreign, 'test setup: expected one unissued challenge');

  const evidence = makeEvidence(token);
  evidence.challengeResults[0] = { challenge: foreign, ok: true, durationMs: 500 };

  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
    evidence,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'evidence_invalid');
});

test('a missing issued challenge is rejected', async () => {
  const { token } = await freshCapture();
  const evidence = makeEvidence(token);
  evidence.challengeResults.pop();
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
    evidence,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'evidence_invalid');
});

test('impossible timings are rejected', async () => {
  const { token } = await freshCapture();
  const base = { studentUserId: STUDENT, consentGivenAt: new Date().toISOString(), capture: { ref: token } };

  const tooFast = await adapter.verify({ ...base, evidence: makeEvidence(token, { totalDurationMs: 500, facePresenceMs: 500 }) });
  assert.equal(tooFast.reason, 'evidence_invalid');

  const tooSlow = await adapter.verify({ ...base, evidence: makeEvidence(token, { totalDurationMs: 120000, facePresenceMs: 60000 }) });
  assert.equal(tooSlow.reason, 'evidence_invalid');

  const noPresence = await adapter.verify({ ...base, evidence: makeEvidence(token, { totalDurationMs: 10000, facePresenceMs: 2000 }) });
  assert.equal(noPresence.reason, 'evidence_invalid');

  const slowChallenge = await adapter.verify({
    ...base,
    evidence: makeEvidence(token, {
      challengeResults: decodeToken(token).c.map((challenge) => ({ challenge, ok: true, durationMs: 16000 })),
    }),
  });
  assert.equal(slowChallenge.reason, 'evidence_invalid');
});

test('a wrong model tag is rejected (not captured with the shipped pipeline)', async () => {
  const { token } = await freshCapture();
  const outcome = await adapter.verify({
    studentUserId: STUDENT,
    consentGivenAt: new Date().toISOString(),
    capture: { ref: token },
    evidence: makeEvidence(token, { model: 'something-else' }),
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.reason, 'evidence_invalid');
});

test('the registry resolves IDENTITY_ADAPTER=mediapipe to a capturing adapter', () => {
  // Same registration src/lib/identity/register.ts performs for the app.
  // (register.ts itself cannot load under Node ESM — extensionless relative
  // specifiers — so it is exercised end-to-end by scripts/e2e-enrollment.mjs,
  // which runs it inside the Next server.)
  registerIdentityVerificationAdapter('mediapipe', () => new MediaPipeIdentityAdapter());
  process.env.IDENTITY_ADAPTER = 'mediapipe';
  try {
    const resolved = getIdentityVerificationAdapter();
    assert.equal(resolved?.id, 'mediapipe');
    assert.equal(typeof resolved.prepareCapture, 'function');
  } finally {
    delete process.env.IDENTITY_ADAPTER;
  }
});

test('manual verification request cooldown: fresh requests wait, stale ones may resend', () => {
  // No request active → free to request.
  assert.equal(isManualRequestResendable(null), true);
  // Just requested → inside the 15-minute cooldown (no new notifications).
  assert.equal(isManualRequestResendable(new Date().toISOString()), false);
  assert.equal(
    isManualRequestResendable(new Date(Date.now() - (MANUAL_REQUEST_COOLDOWN_MS - 60_000)).toISOString()),
    false
  );
  // Cooldown elapsed → may send again.
  assert.equal(
    isManualRequestResendable(
      new Date(Date.now() - (MANUAL_REQUEST_COOLDOWN_MS + 1_000)).toISOString()
    ),
    true
  );
});
