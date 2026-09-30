import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeSecurityPolicy,
  resolveSecurityPolicy,
  validateSecurityPolicyInput,
  SECURITY_POLICY_KEYS,
  severityForEventType,
  isSecurityEventType,
  monitorStateLabel,
  HEARTBEAT_STALE_AFTER_MS,
} from '../src/lib/exam-security.ts';

// ---------------------------------------------------------------------------
// Policy normalization
// ---------------------------------------------------------------------------

test('normalizeSecurityPolicy fills defaults for an empty input', () => {
  const policy = normalizeSecurityPolicy(null);
  assert.equal(policy.security_mode, 'standard');
  assert.equal(policy.security_response_mode, 'record');
  assert.equal(policy.offline_autosave, true);
  assert.equal(policy.allow_session_recovery, true);
  assert.equal(policy.detect_copy_attempts, false);
});

test('explicit undefined values never wipe a default', () => {
  const policy = normalizeSecurityPolicy({ offline_autosave: undefined, security_mode: undefined });
  assert.equal(policy.offline_autosave, true, 'undefined must not override the default');
  assert.equal(policy.security_mode, 'standard');
});

test('normalizeSecurityPolicy coerces an unknown mode to standard, not to a pass-through', () => {
  const policy = normalizeSecurityPolicy({ security_mode: 'paranoid' });
  assert.equal(policy.security_mode, 'standard');
  const response = normalizeSecurityPolicy({ security_response_mode: 'explode' });
  assert.equal(response.security_response_mode, 'record');
});

// ---------------------------------------------------------------------------
// Strict validation (server-side, before any write)
// ---------------------------------------------------------------------------

test('validateSecurityPolicyInput accepts an empty and a valid partial policy', () => {
  assert.equal(validateSecurityPolicyInput(undefined), null);
  assert.equal(validateSecurityPolicyInput({}), null);
  assert.equal(
    validateSecurityPolicyInput({ security_mode: 'lockdown_ready', require_fullscreen: true }),
    null
  );
});

test('validateSecurityPolicyInput rejects unknown enums and non-boolean toggles', () => {
  assert.ok(validateSecurityPolicyInput({ security_mode: 'ultra' }));
  assert.ok(validateSecurityPolicyInput({ security_response_mode: 'delete' }));
  assert.ok(validateSecurityPolicyInput({ require_fullscreen: 'yes' }));
  assert.ok(validateSecurityPolicyInput({ detect_copy_attempts: 1 }));
});

test('every security policy key is accepted by validation', () => {
  for (const key of SECURITY_POLICY_KEYS) {
    if (key === 'security_mode' || key === 'security_response_mode') continue;
    const value = normalizeSecurityPolicy(null)[key];
    assert.equal(
      validateSecurityPolicyInput({ [key]: value }),
      null,
      `${key} should accept its normalized value`
    );
  }
});

// ---------------------------------------------------------------------------
// Effective policy resolution
// ---------------------------------------------------------------------------

test('STANDARD observes nothing even when detection toggles are stored on', () => {
  const policy = resolveSecurityPolicy({
    security_mode: 'standard',
    require_fullscreen: true,
    detect_tab_visibility: true,
    detect_copy_attempts: true,
    record_connection_events: true,
  });
  assert.equal(policy.requireFullscreen, false);
  assert.equal(policy.detectTabVisibility, false);
  assert.equal(policy.detectCopyAttempts, false);
  assert.equal(policy.recordConnectionEvents, false);
});

test('ENHANCED honours the stored detection toggles', () => {
  const policy = resolveSecurityPolicy({
    security_mode: 'enhanced',
    require_fullscreen: true,
    detect_tab_visibility: false,
    detect_copy_attempts: true,
    record_connection_events: true,
  });
  assert.equal(policy.requireFullscreen, true);
  assert.equal(policy.detectTabVisibility, false);
  assert.equal(policy.detectCopyAttempts, true);
  assert.equal(policy.recordConnectionEvents, true);
});

test('durability features stay available in every mode', () => {
  for (const mode of ['standard', 'enhanced', 'lockdown_ready']) {
    const policy = resolveSecurityPolicy({ security_mode: mode, offline_autosave: true });
    assert.equal(policy.offlineAutosave, true, `${mode} keeps offline autosave`);
    assert.equal(policy.allowSessionRecovery, true);
  }
});

// ---------------------------------------------------------------------------
// Event vocabulary + severity (server-authoritative)
// ---------------------------------------------------------------------------

test('severity is derived from the event type, not chosen by the client', () => {
  assert.equal(severityForEventType('exam_started'), 'info');
  assert.equal(severityForEventType('tab_hidden'), 'warning');
  assert.equal(severityForEventType('fullscreen_exited'), 'warning');
  assert.equal(severityForEventType('concurrent_session_attempt'), 'critical');
  assert.equal(severityForEventType('identity_reverification_failed'), 'critical');
  assert.equal(severityForEventType('attempt_terminated'), 'critical');
});

test('isSecurityEventType rejects unknown event types', () => {
  assert.equal(isSecurityEventType('tab_hidden'), true);
  assert.equal(isSecurityEventType('cheating_detected'), false);
  assert.equal(isSecurityEventType(''), false);
  assert.equal(isSecurityEventType(null), false);
});

// ---------------------------------------------------------------------------
// Monitor labels
// ---------------------------------------------------------------------------

test('monitorStateLabel reports offline save before anything else', () => {
  const label = monitorStateLabel({
    connectionState: 'offline',
    syncState: 'pending',
    lastHeartbeatAt: new Date().toISOString(),
    now: new Date(),
  });
  assert.equal(label, 'OFFLINE / LOCAL SAVE ACTIVE');
});

test('monitorStateLabel flags a stale heartbeat as operational state', () => {
  const now = new Date();
  const stale = new Date(now.getTime() - (HEARTBEAT_STALE_AFTER_MS + 1)).toISOString();
  const label = monitorStateLabel({
    connectionState: 'online',
    syncState: 'synced',
    lastHeartbeatAt: stale,
    now,
  });
  assert.equal(label, 'HEARTBEAT STALE');
});

test('monitorStateLabel distinguishes synced from syncing when fresh', () => {
  const now = new Date();
  const fresh = now.toISOString();
  assert.equal(
    monitorStateLabel({ connectionState: 'online', syncState: 'synced', lastHeartbeatAt: fresh, now }),
    'ONLINE / SYNCED'
  );
  assert.equal(
    monitorStateLabel({ connectionState: 'online', syncState: 'syncing', lastHeartbeatAt: fresh, now }),
    'ONLINE / SYNCING'
  );
});
