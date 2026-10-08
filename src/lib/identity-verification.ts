import { logger } from './logger.ts';

/**
 * Replaceable identity-verification adapter (scope §5 "Exam identity
 * verification").
 *
 * The exam gate (`startExamAttempt` in src/lib/exam.ts) authorizes a taker on
 * a deployment with `requires_identity_verification` when either path says
 * yes:
 *
 *   1. Manual — `student_profiles.verification_status = 'verified'`, granted
 *      by faculty on the offering roster ("Verify identity", backed by the
 *      `faculty_verify_student` SQL function) or by a super admin. This is
 *      the scope's faculty-authorized fallback and stays active alongside
 *      any provider.
 *   2. Provider — an adapter selected through the `IDENTITY_ADAPTER`
 *      environment variable. MediaPipe face landmarks (challenge-response
 *      liveness, all on-device) ships (implementation in src/lib/identity/,
 *      the consent + capture UI under /student/verify); the registry stays
 *      replaceable — the exam gate never names a vendor, so a certified
 *      external provider can replace it without touching the gate.
 *
 * Contract a provider implementation MUST satisfy (scope §5):
 *   - Replaceable: register under its own id and select it via
 *     `IDENTITY_ADAPTER` — the exam gate never names a vendor.
 *   - No blink-only liveness as proof of identity: a provider performs
 *     multi-signal challenge-response liveness (or better), or refuses.
 *   - Consent: `consentGivenAt` is only present when the taker explicitly
 *     acknowledged the privacy/consent notice; a provider must refuse to
 *     process biometrics without it.
 *   - Minimal retention: the outcome carries a status plus small metadata
 *     only — never images, templates, landmark data, or other biometric
 *     material, and nothing is persisted by this module.
 *   - Client capture (optional capability): adapters whose capture runs in
 *     the taker's browser implement `CapturingIdentityVerificationAdapter`
 *     below — prepare the capture (session token + server-issued random
 *     challenges), let the browser do the camera work, then settle through
 *     the same `verify()` entry point the exam gate already calls. The
 *     convergence point is always `student_profiles.verification_status`.
 *
 * Deliberately dependency-free so `tests/identity-verification.test.mjs` can
 * import it directly (tests cannot resolve the `@/` import alias).
 */

/** What the request can carry to a provider. All capture data is a pointer. */
export interface VerificationRequest {
  /** The exam taker (auth user id). */
  studentUserId: string;
  /** Deployment requiring verification, when known. */
  deploymentId?: string;
  /** ISO timestamp of the taker's explicit consent acknowledgement. */
  consentGivenAt?: string;
  /**
   * Pointer to the capture session (server-issued token) or captured frame
   * set — never raw bytes.
   */
  capture?: { ref: string };
  /**
   * Client-side capture results for adapters that run their camera work in
   * the browser (see `CapturingIdentityVerificationAdapter`): challenge
   * outcomes and coarse timings only. The adapter re-validates structure,
   * ranges and freshness server-side; nothing here is biometric material.
   */
  evidence?: Record<string, unknown>;
}

export interface VerificationOutcome {
  ok: boolean;
  /** Which path authorized the taker: a provider, or the manual fallback. */
  method: 'provider' | 'manual';
  /** Adapter id when `method === 'provider'`. */
  provider?: string;
  /** Machine-readable refusal cause (`consent_required`, `no_match`, …). */
  reason?: string;
  /** Minimum required metadata for logging — no biometric material. */
  metadata?: Record<string, unknown>;
}

export interface IdentityVerificationAdapter {
  /** Registry key; also what `IDENTITY_ADAPTER` selects. */
  readonly id: string;
  readonly label: string;
  verify(request: VerificationRequest): Promise<VerificationOutcome>;
}

/**
 * Optional capability for adapters whose capture runs in the taker's own
 * browser (MediaPipe face landmarks, and any future in-page capture). The
 * full flow:
 *
 *   1. `prepareCapture()` — server mints a short-lived session token bound
 *      to the taker and picks the liveness challenges at random, AFTER the
 *      taker explicitly consents;
 *   2. the capture page runs the camera, tracks the face (e.g. MediaPipe
 *      FaceLandmarker landmarks/blendshapes) and drives the taker through
 *      the issued challenges;
 *   3. `verify({ capture: { ref: token }, evidence })` settles it through
 *      the same single entry point the exam gate already calls — the
 *      adapter re-validates token, challenge set, timing and ranges
 *      server-side before it will report `ok`.
 *
 * The exam gate itself never runs step 1 — without a capture session a
 * capturing adapter can only refuse there (`capture_required`) — because
 * authorization converges on `student_profiles.verification_status`, which
 * the completion step (step 3) writes.
 *
 * Threat model note: the measurements in `evidence` are produced by the
 * taker's own browser, so this deters casual spoofing (static photos,
 * someone else present, skipped checks) but is not a certified presentation
 * attack detection system — which is exactly why the faculty-authorized
 * manual fallback stays and why swapping in a certified provider behind
 * this contract needs no gate changes.
 */
export interface CapturingIdentityVerificationAdapter extends IdentityVerificationAdapter {
  prepareCapture(request: {
    studentUserId: string;
  }): Promise<{ token: string; challenges: string[] }>;
}

type AdapterFactory = () => IdentityVerificationAdapter;

/**
 * Repeat manual-verification requests inside this window are ignored: the
 * student page shows the pending state and no new faculty notifications are
 * sent. Shared by the server action (enforcement) and the verify page UI
 * (when to offer "send again").
 */
export const MANUAL_REQUEST_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Whether a new manual-verification request may notify instructors yet
 * (no request active, or the cooldown has elapsed). The clock read lives
 * here rather than in component render bodies so React's render-purity lint
 * stays clean; server pages evaluate it per request.
 */
export function isManualRequestResendable(requestedAt: string | null): boolean {
  if (!requestedAt) return true;
  return Date.now() - Date.parse(requestedAt) >= MANUAL_REQUEST_COOLDOWN_MS;
}

const registry = new Map<string, AdapterFactory>();

/** Registers a provider implementation under its id. */
export function registerIdentityVerificationAdapter(id: string, factory: AdapterFactory): void {
  registry.set(id.trim().toLowerCase(), factory);
}

/**
 * Resolves the adapter selected by `IDENTITY_ADAPTER`, or null — which means
 * manual verification only. An unknown id warns and degrades to null rather
 * than locking students out of their exams over a config typo.
 */
export function getIdentityVerificationAdapter(): IdentityVerificationAdapter | null {
  const id = process.env.IDENTITY_ADAPTER?.trim().toLowerCase();
  if (!id) return null;

  const factory = registry.get(id);
  if (!factory) {
    const known = [...registry.keys()].join(', ') || 'none';
    logger.warn(
      `IDENTITY_ADAPTER="${id}" has no registered adapter (known: ${known}); using manual verification only.`
    );
    return null;
  }
  return factory();
}
