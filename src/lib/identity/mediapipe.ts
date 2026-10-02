/**
 * MediaPipe identity verification (scope §5 "Exam identity verification").
 *
 * The chosen provider path uses Google's MediaPipe Tasks
 * (github.com/google-ai-edge/mediapipe → npm `@mediapipe/tasks-vision`,
 * FaceLandmarker task) running FULLY ON DEVICE in the taker's browser:
 *
 *   - Face detection + 478 face landmarks + blendshapes (eyeBlink, jawOpen, …)
 *     give the capture page the signals to drive liveness challenges;
 *   - liveness is CHALLENGE-RESPONSE, not blink-only: the server picks 3 of
 *     4 randomized challenges (blink, mouth_open, turn_left, turn_right) per
 *     session and the taker must perform each on camera within the window;
 *   - no camera frame, video, landmark set or template ever reaches the
 *     server — the browser sends back only challenge outcomes + coarse
 *     timings (see VerificationRequest.evidence), so biometric retention on
 *     our side is zero (scope §5 "minimize biometric retention").
 *
 * Why not an external provider: per-check cost and account/sales friction
 * for a school deployment, and on-device capture scores best on retention.
 * Trade-off (recorded in the adapter contract docs): client-produced
 * measurements are attestation, not a certified presentation-attack
 * detection system — the faculty-authorized manual fallback stays active,
 * and the adapter seam lets a certified provider replace this file without
 * touching the exam gate.
 *
 * Server-side hardening of the client evidence:
 *   - session token = HMAC-SHA256 payload (uid, issued/expires, nonce,
 *     challenge set) keyed by SUPABASE_SERVICE_ROLE_KEY — the browser can't
 *     mint or alter one, and the bound uid must match the settling taker;
 *   - evidence re-validated structurally: exact issued challenge set, all
 *     answered ok, every duration and the session length inside plausible
 *     bounds, face presence ≥ 50% of the session, freshness within the TTL;
 *   - refusals never widen: anything structural keeps the stored status
 *     untouched (only an honest liveness failure flips it to `failed`).
 *
 * Deliberately alias-free imports: `tests/identity-providers.test.mjs`
 * loads this module directly (Node type stripping) and cannot resolve `@/`.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type {
  CapturingIdentityVerificationAdapter,
  VerificationOutcome,
  VerificationRequest,
} from '../identity-verification';

/** Liveness challenge vocabulary the capture page knows how to drive. */
export const LIVENESS_CHALLENGES = ['blink', 'mouth_open', 'turn_left', 'turn_right'] as const;
export type LivenessChallenge = (typeof LIVENESS_CHALLENGES)[number];

/** Challenges issued per session (subset chosen at random). */
const CHALLENGE_COUNT = 3;
/** Mint → settle window (seconds). */
const TOKEN_TTL_SECONDS = 600;
/** Capture session length bounds (milliseconds). */
const SESSION_MIN_MS = 3_000;
const SESSION_MAX_MS = 60_000;
/** Per-challenge performance bounds (milliseconds). */
const CHALLENGE_MIN_MS = 100;
const CHALLENGE_MAX_MS = 15_000;
/** The face must be tracked for at least this share of the session. */
const PRESENCE_RATIO_MIN = 0.5;
/** Allowed clock skew when checking issued-at / expires-at. */
const CLOCK_SKEW_SECONDS = 60;

interface CaptureTokenPayload {
  /** Student auth user id the session is bound to. */
  u: string;
  /** Issued-at, epoch seconds. */
  i: number;
  /** Expires-at, epoch seconds. */
  e: number;
  /** Single-session nonce (traceability, not biometric). */
  n: string;
  /** Server-chosen challenges, in issue order. */
  c: string[];
}

function hmacSecret(): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  return secret;
}

function sign(body: string): string {
  return createHmac('sha256', hmacSecret())
    .update(`identity-capture:${body}`)
    .digest('base64url');
}

/** Fisher–Yates driven by crypto randomness (not Math.random). */
function pickChallenges(): string[] {
  const pool = [...LIVENESS_CHALLENGES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32BE(0) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, CHALLENGE_COUNT);
}

function mintToken(studentUserId: string): { token: string; challenges: string[] } {
  const challenges = pickChallenges();
  const now = Math.floor(Date.now() / 1000);
  const payload: CaptureTokenPayload = {
    u: studentUserId,
    i: now,
    e: now + TOKEN_TTL_SECONDS,
    n: randomBytes(16).toString('hex'),
    c: challenges,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return { token: `${body}.${sign(body)}`, challenges };
}

type TokenResult =
  | { ok: true; payload: CaptureTokenPayload }
  | { ok: false; reason: 'token_invalid' | 'token_expired' | 'account_mismatch' };

function parseToken(token: string, studentUserId: string): TokenResult {
  const invalid: TokenResult = { ok: false, reason: 'token_invalid' };
  const parts = token.split('.');
  if (parts.length !== 2) return invalid;

  const [body, signature] = parts;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return invalid;

  let payload: CaptureTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return invalid;
  }
  if (
    !payload ||
    typeof payload.u !== 'string' ||
    typeof payload.i !== 'number' ||
    typeof payload.e !== 'number' ||
    !Array.isArray(payload.c) ||
    payload.c.length === 0 ||
    !payload.c.every((c) => (LIVENESS_CHALLENGES as readonly string[]).includes(c))
  ) {
    return invalid;
  }
  if (payload.u !== studentUserId) return { ok: false, reason: 'account_mismatch' };

  const now = Math.floor(Date.now() / 1000);
  if (now > payload.e + CLOCK_SKEW_SECONDS) return { ok: false, reason: 'token_expired' };
  if (payload.i - CLOCK_SKEW_SECONDS > now) return invalid; // issued in the future

  return { ok: true, payload };
}

type EvidenceResult =
  | { ok: true; totalDurationMs: number; facePresenceMs: number }
  | { ok: false; reason: 'evidence_invalid' | 'liveness_failed' };

/**
 * Structural re-validation of what the capture page claims happened. The
 * numbers are client-produced, so this catches tampering, replay of another
 * session's token, impossible timings and skipped challenges — not a forged
 * but well-formed claim (see the threat-model note in the contract docs).
 */
function validateEvidence(payload: CaptureTokenPayload, raw: unknown): EvidenceResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'evidence_invalid' };
  const evidence = raw as Record<string, unknown>;

  if (evidence.passed !== true) return { ok: false, reason: 'liveness_failed' };
  if (evidence.model !== 'face_landmarker') return { ok: false, reason: 'evidence_invalid' };

  const total = evidence.totalDurationMs;
  const presence = evidence.facePresenceMs;
  if (typeof total !== 'number' || !Number.isFinite(total)) return { ok: false, reason: 'evidence_invalid' };
  if (total < SESSION_MIN_MS || total > SESSION_MAX_MS) return { ok: false, reason: 'evidence_invalid' };
  if (typeof presence !== 'number' || !Number.isFinite(presence)) return { ok: false, reason: 'evidence_invalid' };
  if (presence < PRESENCE_RATIO_MIN * total || presence > total) return { ok: false, reason: 'evidence_invalid' };

  const results = evidence.challengeResults;
  if (!Array.isArray(results) || results.length !== payload.c.length) {
    return { ok: false, reason: 'evidence_invalid' };
  }
  const seen = new Set<string>();
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') return { ok: false, reason: 'evidence_invalid' };
    const r = entry as Record<string, unknown>;
    if (typeof r.challenge !== 'string' || !payload.c.includes(r.challenge) || seen.has(r.challenge)) {
      return { ok: false, reason: 'evidence_invalid' };
    }
    seen.add(r.challenge);
    if (r.ok !== true) return { ok: false, reason: 'liveness_failed' };
    const ms = r.durationMs;
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < CHALLENGE_MIN_MS || ms > CHALLENGE_MAX_MS) {
      return { ok: false, reason: 'evidence_invalid' };
    }
  }
  if (seen.size !== payload.c.length) return { ok: false, reason: 'evidence_invalid' };

  return { ok: true, totalDurationMs: total, facePresenceMs: presence };
}

export class MediaPipeIdentityAdapter implements CapturingIdentityVerificationAdapter {
  readonly id = 'mediapipe';
  readonly label = 'Face liveness (MediaPipe, on-device)';

  async prepareCapture(request: {
    studentUserId: string;
  }): Promise<{ token: string; challenges: string[] }> {
    return mintToken(request.studentUserId);
  }

  async verify(request: VerificationRequest): Promise<VerificationOutcome> {
    const base = { method: 'provider' as const, provider: this.id };

    // Consent is a hard precondition: nothing runs without it.
    if (!request.consentGivenAt) return { ok: false, ...base, reason: 'consent_required' };

    const token = request.capture?.ref;
    if (!token) return { ok: false, ...base, reason: 'capture_required' };
    if (!request.evidence) return { ok: false, ...base, reason: 'evidence_required' };

    const parsed = parseToken(token, request.studentUserId);
    if (!parsed.ok) return { ok: false, ...base, reason: parsed.reason };

    const evidence = validateEvidence(parsed.payload, request.evidence);
    if (!evidence.ok) return { ok: false, ...base, reason: evidence.reason };

    // Minimum metadata only: challenge ids, coarse timings, model name.
    // No landmarks, frames, or other biometric material — the input never
    // had any (scope §5: store result/status + minimum required metadata).
    return {
      ok: true,
      ...base,
      metadata: {
        adapter: 'mediapipe',
        model: 'face_landmarker',
        challenges: parsed.payload.c,
        total_duration_ms: evidence.totalDurationMs,
        face_presence_ms: evidence.facePresenceMs,
        issued_at: new Date(parsed.payload.i * 1000).toISOString(),
        session_nonce: parsed.payload.n,
      },
    };
  }
}

/** Factory for the registry (src/lib/identity/register.ts). */
export function createMediaPipeIdentityAdapter(): CapturingIdentityVerificationAdapter {
  return new MediaPipeIdentityAdapter();
}
