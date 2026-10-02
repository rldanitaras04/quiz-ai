import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getIdentityVerificationAdapter,
  registerIdentityVerificationAdapter,
} from '../src/lib/identity-verification.ts';

const fakeAdapter = (id) => ({
  id,
  label: `Fake ${id}`,
  verify: async () => ({ ok: true, method: 'provider', provider: id }),
});

test('no IDENTITY_ADAPTER configured → manual verification only', () => {
  delete process.env.IDENTITY_ADAPTER;
  assert.equal(getIdentityVerificationAdapter(), null);
});

test('a registered adapter is resolved through IDENTITY_ADAPTER', async () => {
  registerIdentityVerificationAdapter('fake', () => fakeAdapter('fake'));
  process.env.IDENTITY_ADAPTER = 'fake';

  const adapter = getIdentityVerificationAdapter();
  assert.equal(adapter?.id, 'fake');

  const outcome = await adapter.verify({ studentUserId: 'student-1' });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.method, 'provider');

  delete process.env.IDENTITY_ADAPTER;
});

test('adapter ids are matched case-insensitively (config typo tolerance)', () => {
  registerIdentityVerificationAdapter('CaseTest', () => fakeAdapter('casetest'));
  process.env.IDENTITY_ADAPTER = '  CASETEST  ';
  assert.equal(getIdentityVerificationAdapter()?.id, 'casetest');
  delete process.env.IDENTITY_ADAPTER;
});

test('an unregistered IDENTITY_ADAPTER value degrades to null, not a lockout', () => {
  process.env.IDENTITY_ADAPTER = 'some-vendor';
  assert.equal(getIdentityVerificationAdapter(), null);
  delete process.env.IDENTITY_ADAPTER;
});
