/**
 * Examination security policy model — shared by the faculty deployment UI,
 * the student Secure Exam Shell and the Faculty Live Exam Monitor.
 *
 * Everything in this file is pure data/logic so it can be unit-tested without
 * a browser or database. Nothing here is a security control by itself: the
 * server re-validates every policy-dependent decision (session creation,
 * event recording, synchronization, submission). These helpers only decide
 * *what the client is configured to observe* and *how facts are labeled*.
 *
 * Important limitation (stated in the UI and the docs): a browser/PWA cannot
 * provide operating-system lockdown. ENHANCED mode observes browser-observable
 * session facts. LOCKDOWN-ready is configuration/integration-ready only — it
 * requires a real managed kiosk environment that does not exist yet, and is
 * never claimed to be functional here.
 *
 * Security events are factual session events. They are never classified as
 * cheating, and severity labels only support filtering/prioritization.
 */

export type SecurityMode = 'standard' | 'enhanced' | 'lockdown_ready';

export const SECURITY_MODES: SecurityMode[] = ['standard', 'enhanced', 'lockdown_ready'];

export const SECURITY_MODE_LABELS: Record<SecurityMode, string> = {
  standard: 'Standard',
  enhanced: 'Enhanced',
  lockdown_ready: 'Lockdown-ready',
};

export const SECURITY_MODE_DESCRIPTIONS: Record<SecurityMode, string> = {
  standard:
    'Authenticated entry, server-authoritative schedule and timer, one active attempt, autosave, randomization and secure submission.',
  enhanced:
    'Standard plus session security detection: full-screen, tab visibility, focus loss, reloads, connectivity, concurrent sessions, heartbeat and the Faculty Live Monitor.',
  lockdown_ready:
    'Enhanced plus configuration for a future managed kiosk/lockdown environment. A browser/PWA cannot lock the operating system — this mode is not functional until an external managed environment is integrated.',
};

/** How the system responds to qualifying security events. */
export type SecurityResponseMode = 'record' | 'warn' | 'reverify';

export const SECURITY_RESPONSE_LABELS: Record<SecurityResponseMode, string> = {
  record: 'Record event only',
  warn: 'Warn student and record',
  reverify: 'Require identity reverification for qualifying events',
};

/**
 * The faculty-configurable policy stored on `assessment_deployments`.
 */
export interface DeploymentSecurityPolicy {
  security_mode: SecurityMode;
  require_fullscreen: boolean;
  detect_fullscreen_exit: boolean;
  detect_tab_visibility: boolean;
  detect_focus_loss: boolean;
  record_page_reloads: boolean;
  detect_concurrent_sessions: boolean;
  detect_copy_attempts: boolean;
  detect_paste_attempts: boolean;
  detect_context_menu: boolean;
  require_face_verification: boolean;
  require_liveness_verification: boolean;
  require_reverification_on_recovery: boolean;
  offline_autosave: boolean;
  sync_on_reconnect: boolean;
  record_connection_events: boolean;
  allow_session_recovery: boolean;
  security_response_mode: SecurityResponseMode;
  requires_identity_verification: boolean;
}

/**
 * What the Secure Exam Shell actually enforces/observes after resolving the
 * mode. STANDARD observes nothing beyond connectivity for save status.
 */
export interface EffectiveSecurityPolicy {
  mode: SecurityMode;
  requireFullscreen: boolean;
  detectFullscreenExit: boolean;
  detectTabVisibility: boolean;
  detectFocusLoss: boolean;
  recordPageReloads: boolean;
  detectConcurrentSessions: boolean;
  detectCopyAttempts: boolean;
  detectPasteAttempts: boolean;
  detectContextMenu: boolean;
  requireReverificationOnRecovery: boolean;
  offlineAutosave: boolean;
  syncOnReconnect: boolean;
  recordConnectionEvents: boolean;
  allowSessionRecovery: boolean;
  responseMode: SecurityResponseMode;
  /** Informational: biometric hooks exist but no provider is integrated. */
  faceVerificationConfigured: boolean;
  livenessVerificationConfigured: boolean;
}

const DEFAULT_POLICY: DeploymentSecurityPolicy = {
  security_mode: 'standard',
  require_fullscreen: false,
  detect_fullscreen_exit: true,
  detect_tab_visibility: true,
  detect_focus_loss: true,
  record_page_reloads: true,
  detect_concurrent_sessions: true,
  detect_copy_attempts: false,
  detect_paste_attempts: false,
  detect_context_menu: false,
  require_face_verification: false,
  require_liveness_verification: false,
  require_reverification_on_recovery: false,
  offline_autosave: true,
  sync_on_reconnect: true,
  record_connection_events: true,
  allow_session_recovery: true,
  security_response_mode: 'record',
  requires_identity_verification: false,
};

export function normalizeSecurityPolicy(
  input: Partial<DeploymentSecurityPolicy> | null | undefined
): DeploymentSecurityPolicy {
  // Explicit `undefined` values must not wipe a default (a spread would).
  const cleaned = Object.fromEntries(
    Object.entries(input ?? {}).filter(([, value]) => value !== undefined)
  ) as Partial<DeploymentSecurityPolicy>;
  const merged = { ...DEFAULT_POLICY, ...cleaned };
  if (!SECURITY_MODES.includes(merged.security_mode)) merged.security_mode = 'standard';
  if (!['record', 'warn', 'reverify'].includes(merged.security_response_mode)) {
    merged.security_response_mode = 'record';
  }
  return merged;
}

/**
 * The policy columns a client may write on a deployment.
 * `requires_identity_verification` is excluded here because it predates the
 * security layer and is already on the deployment whitelist.
 */
export const SECURITY_POLICY_KEYS = [
  'security_mode',
  'require_fullscreen',
  'detect_fullscreen_exit',
  'detect_tab_visibility',
  'detect_focus_loss',
  'record_page_reloads',
  'detect_concurrent_sessions',
  'detect_copy_attempts',
  'detect_paste_attempts',
  'detect_context_menu',
  'require_face_verification',
  'require_liveness_verification',
  'require_reverification_on_recovery',
  'offline_autosave',
  'sync_on_reconnect',
  'record_connection_events',
  'allow_session_recovery',
  'security_response_mode',
] as const satisfies readonly (keyof DeploymentSecurityPolicy)[];

/**
 * Strict validation for client-supplied policy input. Unknown enum values are
 * rejected (not silently coerced) so a typo cannot quietly weaken a policy.
 * Returns an error message, or null when the input is acceptable.
 */
export function validateSecurityPolicyInput(
  input: Partial<DeploymentSecurityPolicy> | null | undefined
): string | null {
  if (!input) return null;
  if (
    input.security_mode !== undefined &&
    !SECURITY_MODES.includes(input.security_mode)
  ) {
    return 'Unknown security mode';
  }
  if (
    input.security_response_mode !== undefined &&
    !['record', 'warn', 'reverify'].includes(input.security_response_mode)
  ) {
    return 'Unknown security response mode';
  }
  for (const key of SECURITY_POLICY_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (key === 'security_mode' || key === 'security_response_mode') continue;
    if (typeof value !== 'boolean') return `${key} must be true or false`;
  }
  return null;
}

/**
 * Resolve the policy the client may act on.
 *
 * STANDARD never observes session events, regardless of what the stored
 * toggles say (the toggles only become meaningful for ENHANCED/LOCKDOWN-ready).
 * The one exception is offline autosave, which is a durability feature, not a
 * surveillance feature — it stays available in every mode.
 */
export function resolveSecurityPolicy(
  input: Partial<DeploymentSecurityPolicy> | null | undefined
): EffectiveSecurityPolicy {
  const policy = normalizeSecurityPolicy(input);
  const enhanced = policy.security_mode !== 'standard';

  return {
    mode: policy.security_mode,
    requireFullscreen: enhanced && policy.require_fullscreen,
    detectFullscreenExit: enhanced && policy.detect_fullscreen_exit,
    detectTabVisibility: enhanced && policy.detect_tab_visibility,
    detectFocusLoss: enhanced && policy.detect_focus_loss,
    recordPageReloads: enhanced && policy.record_page_reloads,
    detectConcurrentSessions: enhanced && policy.detect_concurrent_sessions,
    detectCopyAttempts: enhanced && policy.detect_copy_attempts,
    detectPasteAttempts: enhanced && policy.detect_paste_attempts,
    detectContextMenu: enhanced && policy.detect_context_menu,
    requireReverificationOnRecovery: enhanced && policy.require_reverification_on_recovery,
    offlineAutosave: policy.offline_autosave,
    syncOnReconnect: policy.sync_on_reconnect,
    recordConnectionEvents: enhanced && policy.record_connection_events,
    allowSessionRecovery: policy.allow_session_recovery,
    responseMode: policy.security_response_mode,
    faceVerificationConfigured: policy.require_face_verification,
    livenessVerificationConfigured: policy.require_liveness_verification,
  };
}

// ---------------------------------------------------------------------------
// Security / session event vocabulary
// ---------------------------------------------------------------------------

export const SECURITY_EVENT_TYPES = [
  'exam_started',
  'session_created',
  'session_recovered',
  'session_terminated',
  'fullscreen_entered',
  'fullscreen_exited',
  'tab_hidden',
  'tab_visible',
  'window_blurred',
  'window_focused',
  'page_reloaded',
  'connection_lost',
  'connection_restored',
  'copy_attempt',
  'paste_attempt',
  'context_menu_attempt',
  'concurrent_session_attempt',
  'invalid_session',
  'identity_verified',
  'identity_reverification_required',
  'identity_reverification_failed',
  'pending_sync_started',
  'pending_sync_completed',
  'submission_started',
  'submission_completed',
  'attempt_terminated',
  'faculty_intervention',
  'custom',
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export type EventSeverity = 'info' | 'warning' | 'critical';

const EVENT_SEVERITY: Record<SecurityEventType, EventSeverity> = {
  exam_started: 'info',
  session_created: 'info',
  session_recovered: 'info',
  session_terminated: 'info',
  fullscreen_entered: 'info',
  fullscreen_exited: 'warning',
  tab_hidden: 'warning',
  tab_visible: 'info',
  window_blurred: 'warning',
  window_focused: 'info',
  page_reloaded: 'warning',
  connection_lost: 'warning',
  connection_restored: 'info',
  copy_attempt: 'warning',
  paste_attempt: 'warning',
  context_menu_attempt: 'warning',
  concurrent_session_attempt: 'critical',
  invalid_session: 'critical',
  identity_verified: 'info',
  identity_reverification_required: 'info',
  identity_reverification_failed: 'critical',
  pending_sync_started: 'info',
  pending_sync_completed: 'info',
  submission_started: 'info',
  submission_completed: 'info',
  attempt_terminated: 'critical',
  faculty_intervention: 'warning',
  custom: 'info',
};

export function severityForEventType(type: SecurityEventType): EventSeverity {
  return EVENT_SEVERITY[type] ?? 'info';
}

export function isSecurityEventType(value: unknown): value is SecurityEventType {
  return typeof value === 'string' && (SECURITY_EVENT_TYPES as readonly string[]).includes(value);
}

/** UI labels for severities — operational, never an academic finding. */
export const SEVERITY_LABELS: Record<EventSeverity, string> = {
  info: 'Informational',
  warning: 'Attention',
  critical: 'Critical security',
};

export const EVENT_TYPE_LABELS: Record<SecurityEventType, string> = {
  exam_started: 'Exam started',
  session_created: 'Session created',
  session_recovered: 'Session recovered',
  session_terminated: 'Session closed',
  fullscreen_entered: 'Full-screen entered',
  fullscreen_exited: 'Full-screen exited',
  tab_hidden: 'Tab hidden',
  tab_visible: 'Tab visible',
  window_blurred: 'Window focus lost',
  window_focused: 'Window focused',
  page_reloaded: 'Page reloaded',
  connection_lost: 'Connection lost',
  connection_restored: 'Connection restored',
  copy_attempt: 'Copy attempt',
  paste_attempt: 'Paste attempt',
  context_menu_attempt: 'Context menu attempt',
  concurrent_session_attempt: 'Concurrent session attempt',
  invalid_session: 'Invalid session',
  identity_verified: 'Identity verified',
  identity_reverification_required: 'Identity reverification required',
  identity_reverification_failed: 'Identity reverification failed',
  pending_sync_started: 'Synchronization started',
  pending_sync_completed: 'Synchronization completed',
  submission_started: 'Submission started',
  submission_completed: 'Submission completed',
  attempt_terminated: 'Attempt terminated by faculty',
  faculty_intervention: 'Faculty intervention',
  custom: 'Custom event',
};

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/**
 * Heartbeat interval. Never one second: the session row is updated in place,
 * and the periodic tick is only a liveness fallback for state-change updates
 * (question change, sync acknowledgement, connection change…) which fire
 * immediately when they happen.
 */
export const HEARTBEAT_INTERVAL_MS = 20_000;

/** After this long without a heartbeat the monitor reports HEARTBEAT STALE. */
export const HEARTBEAT_STALE_AFTER_MS = 60_000;

/** Client-side minimum gap between two identical event types. */
export const EVENT_THROTTLE_MS = 1_000;

export type MonitorConnectionLabel =
  | 'ONLINE / SYNCED'
  | 'ONLINE / SYNCING'
  | 'OFFLINE / LOCAL SAVE ACTIVE'
  | 'HEARTBEAT STALE'
  | 'CONNECTION UNKNOWN';

export interface MonitorStateInput {
  connectionState: 'online' | 'offline' | 'unknown';
  syncState: 'synced' | 'syncing' | 'pending' | 'error';
  lastHeartbeatAt: string | null;
  now: Date;
}

/**
 * Operational monitor label. A stale heartbeat is represented as an
 * operational state — it is never treated as evidence of misconduct.
 */
export function monitorStateLabel(input: MonitorStateInput): MonitorConnectionLabel {
  const { connectionState, syncState, lastHeartbeatAt, now } = input;
  const stale =
    !lastHeartbeatAt || now.getTime() - new Date(lastHeartbeatAt).getTime() > HEARTBEAT_STALE_AFTER_MS;

  if (connectionState === 'offline') return 'OFFLINE / LOCAL SAVE ACTIVE';
  if (stale) return 'HEARTBEAT STALE';
  if (connectionState === 'unknown') return 'CONNECTION UNKNOWN';
  if (syncState === 'synced') return 'ONLINE / SYNCED';
  return 'ONLINE / SYNCING';
}
