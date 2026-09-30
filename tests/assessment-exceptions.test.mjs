import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAssessmentExceptions } from '../src/lib/assessment-exceptions.ts';

const NOW = new Date('2026-10-01T08:00:00.000Z');

const deployment = {
  opens_at: '2026-10-01T09:00:00.000Z',
  closes_at: '2026-10-01T11:00:00.000Z',
  duration_minutes: 60,
  attempt_limit: 1,
};

let sequence = 0;
function exception(overrides) {
  sequence += 1;
  return {
    id: `ex-${sequence}`,
    deployment_id: 'dep-1',
    student_id: 'stu-1',
    exception_type: 'extended_time',
    override_opens_at: null,
    override_closes_at: null,
    additional_minutes: null,
    additional_attempts: null,
    reason: 'test',
    authorized_by: 'fac-1',
    expires_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

test('with no exceptions the deployment window is unchanged', () => {
  const result = applyAssessmentExceptions(deployment, [], NOW);
  assert.equal(result.hasException, false);
  assert.deepEqual(result.applied, []);
  assert.equal(result.durationMinutes, 60);
  assert.equal(result.attemptLimit, 1);
  assert.equal(result.opensAt.toISOString(), deployment.opens_at);
  assert.equal(result.closesAt.toISOString(), deployment.closes_at);
});

test('extended_time adds its minutes', () => {
  const result = applyAssessmentExceptions(
    deployment,
    [exception({ exception_type: 'extended_time', additional_minutes: 30 })],
    NOW
  );
  assert.equal(result.durationMinutes, 90);
  assert.equal(result.hasException, true);
  assert.equal(result.applied.length, 1);
});

test('additional_attempt raises the limit', () => {
  const result = applyAssessmentExceptions(
    deployment,
    [exception({ exception_type: 'additional_attempt', additional_attempts: 2 })],
    NOW
  );
  assert.equal(result.attemptLimit, 3);
  assert.equal(result.durationMinutes, 60);
});

test('schedule_override only ever widens the window', () => {
  const result = applyAssessmentExceptions(
    deployment,
    [
      exception({
        exception_type: 'schedule_override',
        override_opens_at: '2026-10-01T07:30:00.000Z',
        override_closes_at: '2026-10-01T12:30:00.000Z',
      }),
    ],
    NOW
  );
  assert.equal(result.opensAt.toISOString(), '2026-10-01T07:30:00.000Z');
  assert.equal(result.closesAt.toISOString(), '2026-10-01T12:30:00.000Z');
});

test('a later override_opens_at never pulls the window in', () => {
  const result = applyAssessmentExceptions(
    deployment,
    [
      exception({
        exception_type: 'schedule_override',
        override_opens_at: '2026-10-01T10:00:00.000Z',
        override_closes_at: '2026-10-01T10:30:00.000Z',
      }),
    ],
    NOW
  );
  assert.equal(result.opensAt.toISOString(), deployment.opens_at);
  assert.equal(result.closesAt.toISOString(), deployment.closes_at);
  assert.equal(result.hasException, true, 'the row was applied even though it widened nothing');
});

test('expired exceptions are ignored entirely', () => {
  const result = applyAssessmentExceptions(
    deployment,
    [
      exception({
        exception_type: 'extended_time',
        additional_minutes: 45,
        expires_at: '2026-09-30T00:00:00.000Z',
      }),
      exception({ exception_type: 'additional_attempt', additional_attempts: 1 }),
    ],
    NOW
  );
  assert.equal(result.durationMinutes, 60, 'expired extended_time must not apply');
  assert.equal(result.attemptLimit, 2, 'unexpired additional_attempt still applies');
  assert.equal(result.applied.length, 1);
});

test('an exception is valid through its expires_at instant, expired after', () => {
  const atExpiry = applyAssessmentExceptions(
    deployment,
    [exception({ exception_type: 'extended_time', additional_minutes: 45, expires_at: NOW.toISOString() })],
    NOW
  );
  assert.equal(atExpiry.durationMinutes, 105, 'still valid at the exact expiry instant');
  assert.equal(atExpiry.hasException, true);

  const afterExpiry = applyAssessmentExceptions(
    deployment,
    [exception({ exception_type: 'extended_time', additional_minutes: 45, expires_at: NOW.toISOString() })],
    new Date(NOW.getTime() + 1)
  );
  assert.equal(afterExpiry.durationMinutes, 60, 'expired 1ms later');
  assert.equal(afterExpiry.hasException, false);
});

test('multiple extended_time exceptions accumulate', () => {
  const result = applyAssessmentExceptions(
    deployment,
    [
      exception({ exception_type: 'extended_time', additional_minutes: 15 }),
      exception({ exception_type: 'extended_time', additional_minutes: 45 }),
    ],
    NOW
  );
  assert.equal(result.durationMinutes, 120);
  assert.equal(result.applied.length, 2);
});
