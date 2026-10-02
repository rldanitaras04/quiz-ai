'use server';

/**
 * Student-facing identity verification (scope §5).
 *
 * Three server actions bracket the verification flow:
 *
 *   1. `startIdentityVerification` — requires an explicit consent
 *      acknowledgement first (recorded as `verification_consent_at`), then
 *      asks the registered capturing adapter to mint a session token + a
 *      random challenge set (server-issued, so the browser can't pick its
 *      own challenges).
 *   2. `completeIdentityVerification` — settles the session through the SAME
 *      `verify()` entry point the exam gate calls. The adapter re-validates
 *      token, account binding, challenge set, timing and ranges server-side;
 *      only then does the stored status flip to `verified`.
 *   3. `requestManualVerification` — the scope's faculty-authorized fallback,
 *      made reachable in-app: notifies every instructor assigned to the
 *      student's active offerings (service-role insert — notifications are
 *      REVOKE'd from `authenticated`), deep-linked to the roster where the
 *      existing "Verify identity" button grants the status. A request never
 *      changes verification_status itself; cooldown keeps repeats quiet.
 *
 * What is persisted: status + verification_provider/verified_at/meta (status,
 * provider id, challenge ids, coarse timings, session nonce) and, for manual
 * requests, verification_requested_at. Never camera frames, landmarks or
 * other biometric material — the browser never sends any (the MediaPipe
 * capture runs entirely on-device).
 *
 * Every mutation goes through the service-role client: the `verification_*`
 * columns are REVOKE'd from `authenticated` on student_profiles (a student
 * could otherwise self-grant `verified` on their own row), and the
 * super-admin/faculty manual paths use SECURITY DEFINER functions. This
 * provider path is the third sanctioned writer.
 */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import {
  getIdentityVerificationAdapter,
  MANUAL_REQUEST_COOLDOWN_MS,
  type CapturingIdentityVerificationAdapter,
} from '@/lib/identity-verification';
import '@/lib/identity/register';

export interface StartVerificationResult {
  ok?: true;
  /** Session token to settle with (opaque, HMAC-signed, 10 min TTL). */
  token?: string;
  /** Server-chosen liveness challenges the capture page must drive. */
  challenges?: string[];
  error?: string;
  /** No adapter selected/configured — faculty manual fallback applies. */
  notConfigured?: boolean;
}

export interface CompleteVerificationResult {
  ok?: true;
  /** Already verified before this call — nothing to change. */
  alreadyVerified?: true;
  error?: string;
  /** Adapter refusal cause (also used to decide failed-vs-untouched). */
  reason?: string;
  /** No adapter selected/configured — faculty manual fallback applies. */
  notConfigured?: boolean;
}

/** Honest client-reported liveness failure: status becomes `failed`. */
const FAIL_STATUS_REASONS = new Set(['liveness_failed']);

function friendlyRefusal(reason: string | undefined): string {
  switch (reason) {
    case 'liveness_failed':
      return 'Liveness check was not passed. You can try again.';
    case 'consent_required':
      return 'Consent has not been recorded. Start the verification again.';
    case 'capture_required':
    case 'token_invalid':
    case 'token_expired':
    case 'account_mismatch':
      return 'The verification session expired or is invalid. Start a new verification.';
    case 'evidence_required':
    case 'evidence_invalid':
      return 'The verification data could not be validated. Start a new verification.';
    default:
      return 'Verification failed. You can try again, or ask your instructor to verify you manually.';
  }
}

/**
 * The adapter registry resolves `IDENTITY_ADAPTER`; only adapters that also
 * implement `prepareCapture()` can run the in-page capture flow.
 */
function capturingAdapter(): CapturingIdentityVerificationAdapter | null {
  const adapter = getIdentityVerificationAdapter();
  if (!adapter || !('prepareCapture' in adapter)) return null;
  return adapter as CapturingIdentityVerificationAdapter;
}

async function requireUser(): Promise<{ userId: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { userId: user.id };
}

/**
 * Step 1: record consent, then mint the capture session. Consent is written
 * FIRST — the adapter's contract forbids processing without it, and a failed
 * consent write must abort before any token exists.
 */
export async function startIdentityVerification(): Promise<StartVerificationResult> {
  try {
    const { userId } = await requireUser();

    const adapter = capturingAdapter();
    if (!adapter) {
      return {
        notConfigured: true,
        error:
          'Face verification is not configured on this deployment. Ask your instructor to verify your identity manually.',
      };
    }

    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data, error } = await admin
      .from('student_profiles')
      .update({ verification_consent_at: now, updated_at: now })
      .eq('user_id', userId)
      .select('user_id')
      .maybeSingle();
    if (error) {
      console.error('verification consent write failed', error.message);
      return { error: 'Could not record your consent. Please try again.' };
    }
    if (!data) return { error: 'No student profile is linked to this account.' };

    const capture = await adapter.prepareCapture({ studentUserId: userId });
    return { ok: true, token: capture.token, challenges: capture.challenges };
  } catch (err) {
    console.error('startIdentityVerification failed', err);
    return { error: 'Could not start verification. Please try again.' };
  }
}

/**
 * Step 2: settle the capture session. Success flips status to `verified`
 * with minimum metadata; an honest liveness failure flips it to `failed`
 * (retryable); structural refusals (expired/tampered token, malformed
 * evidence) leave the stored status untouched — they are not attempts by
 * the legitimate holder.
 */
export async function completeIdentityVerification(
  token: string,
  evidence: Record<string, unknown>
): Promise<CompleteVerificationResult> {
  try {
    const { userId } = await requireUser();

    if (typeof token !== 'string' || token.length < 16 || token.length > 1024) {
      return { error: 'The verification session is invalid. Start a new verification.', reason: 'token_invalid' };
    }

    const adapter = capturingAdapter();
    if (!adapter) {
      return { notConfigured: true, error: 'Face verification is not configured on this deployment.' };
    }

    const admin = createAdminClient();
    const { data: profile, error: readError } = await admin
      .from('student_profiles')
      .select('verification_status, verification_consent_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError) {
      console.error('verification read failed', readError.message);
      return { error: 'Could not read your verification status. Please try again.' };
    }
    if (profile?.verification_status === 'verified') return { ok: true, alreadyVerified: true };

    const consentGivenAt = (profile?.verification_consent_at as string | null) ?? undefined;
    if (!consentGivenAt) {
      return { error: friendlyRefusal('consent_required'), reason: 'consent_required' };
    }

    const outcome = await adapter.verify({
      studentUserId: userId,
      consentGivenAt,
      capture: { ref: token },
      evidence: (evidence ?? {}) as Record<string, unknown>,
    });

    if (outcome.ok) {
      const now = new Date().toISOString();
      const { error: writeError } = await admin
        .from('student_profiles')
        .update({
          verification_status: 'verified',
          verification_provider: outcome.provider ?? adapter.id,
          verification_verified_at: now,
          verification_meta: outcome.metadata ?? {},
          updated_at: now,
        })
        .eq('user_id', userId);
      if (writeError) {
        // The checks passed but the save didn't — do NOT report success;
        // the student can settle again (the token stays valid).
        console.error('verification write failed', writeError.message);
        return { error: 'Verification passed but could not be saved. Please try again.' };
      }

      await recordAuditLog({
        actorUserId: userId,
        action: 'update',
        entityType: 'student_profile',
        entityId: userId,
        metadata: {
          verification_status: 'verified',
          method: 'provider',
          provider: outcome.provider ?? adapter.id,
          ...(outcome.metadata ?? {}),
        },
      });
      revalidatePath('/student/verify');
      revalidatePath('/profile');
      return { ok: true };
    }

    const reason = outcome.reason ?? 'failed';
    if (FAIL_STATUS_REASONS.has(reason)) {
      const now = new Date().toISOString();
      await admin
        .from('student_profiles')
        .update({
          verification_status: 'failed',
          verification_provider: adapter.id,
          verification_meta: { reason, provider: adapter.id },
          updated_at: now,
        })
        .eq('user_id', userId);
      await recordAuditLog({
        actorUserId: userId,
        action: 'update',
        entityType: 'student_profile',
        entityId: userId,
        metadata: { verification_status: 'failed', method: 'provider', provider: adapter.id, reason },
      });
      revalidatePath('/student/verify');
    }

    return { error: friendlyRefusal(reason), reason };
  } catch (err) {
    console.error('completeIdentityVerification failed', err);
    return { error: 'Verification failed unexpectedly. Please try again.' };
  }
}

export interface RequestVerificationResult {
  ok?: true;
  /** Inside the cooldown: no new notifications were sent. */
  alreadyRequested?: true;
  /** Instructors notified by this call (0 when alreadyRequested). */
  notified?: number;
  /** When the active request started (ISO) — drives the pending UI. */
  requestedAt?: string;
  error?: string;
}

/**
 * Step 3 (manual fallback): notify every instructor assigned to the
 * student's active offerings so they can grant the status from the roster
 * (scope §5 "faculty-authorized manual verification"). The request itself
 * never changes verification_status — only faculty/admin/provider settles do.
 *
 * Anti-spam: repeat requests inside MANUAL_REQUEST_COOLDOWN_MS return the
 * existing timestamp and send nothing new. Notification rows go through the
 * service-role client (INSERT is REVOKE'd from `authenticated`), one per
 * faculty member, each deep-linked via `data.offering_id` to the roster of
 * an offering they teach AND the student is enrolled in.
 */
export async function requestManualVerification(): Promise<RequestVerificationResult> {
  try {
    const { userId } = await requireUser();
    const admin = createAdminClient();

    const { data: profile, error: readError } = await admin
      .from('student_profiles')
      .select('verification_status, verification_requested_at, profile:profiles(full_name)')
      .eq('user_id', userId)
      .maybeSingle();
    if (readError || !profile) {
      console.error('verification request read failed', readError?.message ?? 'no profile');
      return { error: 'No student profile is linked to this account.' };
    }

    const status = (profile.verification_status as string | null) ?? null;
    const requestedAt = (profile.verification_requested_at as string | null) ?? null;
    if (status === 'verified') return { ok: true, notified: 0, ...(requestedAt ? { requestedAt } : {}) };

    if (requestedAt && Date.now() - Date.parse(requestedAt) < MANUAL_REQUEST_COOLDOWN_MS) {
      return { ok: true, alreadyRequested: true, notified: 0, requestedAt };
    }

    // The student's active offerings…
    const { data: enrollments, error: enrollError } = await admin
      .from('enrollments')
      .select('subject_offering_id')
      .eq('student_id', userId)
      .eq('status', 'enrolled');
    if (enrollError) {
      console.error('verification request enrollments failed', enrollError.message);
      return { error: 'Could not resolve your subjects. Please try again.' };
    }
    const offeringIds = [...new Set((enrollments ?? []).map((e) => String(e.subject_offering_id)))];
    if (offeringIds.length === 0) {
      return {
        error: 'You are not enrolled in any subject yet — contact your instructor to have your identity verified.',
      };
    }

    // …the subjects they belong to (for notification copy)…
    const { data: offerings } = await admin
      .from('subject_offerings')
      .select('id, subject:subjects(code, title)')
      .in('id', offeringIds);
    const labelByOffering = new Map<string, string>();
    for (const row of (offerings ?? []) as Array<{
      id: string;
      subject: { code?: string; title?: string } | null;
    }>) {
      const s = row.subject;
      labelByOffering.set(
        row.id,
        s?.code ? (s.title ? `${s.code} - ${s.title}` : s.code) : s?.title ?? ''
      );
    }

    // …and the faculty assigned to them: one notification per faculty
    // member, aimed at their first overlapping offering's roster.
    const { data: assignments, error: assignError } = await admin
      .from('faculty_assignments')
      .select('faculty_id, subject_offering_id')
      .in('subject_offering_id', offeringIds);
    if (assignError) {
      console.error('verification request assignments failed', assignError.message);
      return { error: 'Could not resolve your instructors. Please try again.' };
    }
    const targetByFaculty = new Map<string, { offeringId: string; label: string }>();
    for (const a of (assignments ?? []) as Array<{
      faculty_id: string;
      subject_offering_id: string;
    }>) {
      if (!targetByFaculty.has(a.faculty_id)) {
        targetByFaculty.set(a.faculty_id, {
          offeringId: a.subject_offering_id,
          label: labelByOffering.get(a.subject_offering_id) ?? '',
        });
      }
    }
    if (targetByFaculty.size === 0) {
      return {
        error:
          'No instructor is assigned to your subjects yet — contact the program coordinator to have your identity verified.',
      };
    }

    const studentName =
      ((profile as { profile?: { full_name?: string | null } | null }).profile?.full_name ?? '') ||
      'A student';
    const nowIso = new Date().toISOString();

    const { error: insertError } = await admin.from('notifications').insert(
      [...targetByFaculty.entries()].map(([facultyId, target]) => ({
        user_id: facultyId,
        type: 'identity_verification_requested',
        title: 'Identity verification requested',
        body:
          `${studentName} requested manual identity verification` +
          `${target.label ? ` for ${target.label}` : ''}. ` +
          'Check their institutional ID on the roster to unlock exams that require identity verification.',
        data: {
          student_user_id: userId,
          student_name: studentName,
          offering_id: target.offeringId,
          subject_label: target.label,
        },
      }))
    );
    if (insertError) {
      // Do not record the request when nothing was delivered.
      console.error('verification request notification failed', insertError.message);
      return { error: 'Could not notify your instructors. Please try again.' };
    }

    const { error: writeError } = await admin
      .from('student_profiles')
      .update({ verification_requested_at: nowIso, updated_at: nowIso })
      .eq('user_id', userId);
    if (writeError) {
      // Notifications are already out; the UI can still reflect the request
      // from the timestamp we return.
      console.error('verification request write failed', writeError.message);
    }

    await recordAuditLog({
      actorUserId: userId,
      action: 'create',
      entityType: 'verification_request',
      entityId: userId,
      metadata: { notified: targetByFaculty.size, offering_ids: offeringIds },
    });
    revalidatePath('/student/verify');

    return { ok: true, notified: targetByFaculty.size, requestedAt: nowIso };
  } catch (err) {
    console.error('requestManualVerification failed', err);
    return { error: 'Could not send the request. Please try again.' };
  }
}
