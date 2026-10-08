'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminUser, type ActionResult } from '../actions';
import { recordAuditLog } from '@/lib/audit';
import { enrollStudents } from '@/lib/enrollment';
import { createAdminClient } from '@/lib/supabase/admin';
import { notifyUser } from '@/lib/notifications';
import { LOGIN_PATH, RESET_PASSWORD_PATH, appOrigin } from '@/lib/constants';
import { logger } from '@/lib/logger';

/**
 * User and role administration (spec §2.1: "manage users and role
 * assignments").
 *
 * Registration deliberately creates accounts with `profiles.status='pending'`
 * awaiting an administrator, so without these actions a self-registered account
 * can never be approved and the faculty/student workflows can never start.
 *
 * Safety guards mirror the platform's actual authorization model:
 *   - the caller's identity comes from the session, never from the client;
 *   - an administrator cannot lock themselves out;
 *   - the last remaining super_admin cannot be demoted.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches `profiles_status_check`. Reads may surface any of these. */
const USER_STATUSES = ['active', 'inactive', 'suspended', 'pending'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * The subset an administrator may WRITE: activate or suspend. Email
 * confirmation verifies the address, so the admin's remaining lever is
 * simply letting the person in or keeping them out — setUserStatus rejects
 * anything else (e.g. pushing a user back to 'pending').
 */
const ADMIN_SETTABLE_STATUSES: readonly string[] = USER_STATUSES.filter(
  (s) => s === 'active' || s === 'suspended'
);

/** Matches the role vocabulary used throughout the app. */
const ASSIGNABLE_ROLES = ['super_admin', 'faculty', 'student'] as const;
type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Matches `student_profiles_verification_status_check`. */
const VERIFICATION_STATUSES = ['pending', 'verified', 'failed'] as const;
type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function friendlyError(message: string | undefined, fallback: string): string {
  const m = message ?? '';
  if (/duplicate key|unique constraint/i.test(m)) {
    return 'That record already exists.';
  }
  if (/foreign key/i.test(m)) {
    return 'That change would leave a record without its required parent.';
  }
  if (/permission denied|row-level security/i.test(m)) {
    return 'You do not have permission to make this change.';
  }
  if (/check constraint/i.test(m)) {
    return 'One of the submitted values is not allowed.';
  }
  return fallback;
}

function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

function isVerificationStatus(value: string): value is VerificationStatus {
  return (VERIFICATION_STATUSES as readonly string[]).includes(value);
}

function revalidateUsers(): void {
  revalidatePath('/admin/users');
  revalidatePath('/admin');
  // Section moves auto-enroll students into the section's active offerings.
  revalidatePath('/admin/subjects');
  revalidatePath('/faculty/subjects');
  revalidatePath('/faculty');
  revalidatePath('/student/subjects');
  revalidatePath('/student/assessments');
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string;
  status: string;
  createdAt: string;
  roles: string[];
  studentNumber: string | null;
  verificationStatus: string | null;
  sectionId: string | null;
  /**
   * Whether the address is confirmed in auth.users — the "email verified"
   * badge in the admin table. Null when the lookup failed or the user has
   * no auth row, so the UI can show "unknown" instead of a wrong answer.
   */
  emailConfirmed: boolean | null;
}

/**
 * auth.users.email_confirmed_at, which the session client cannot read, so
 * it comes from the service-role Auth API. Page size 100, walked until a
 * short page; a hard stop keeps a pathological response from looping.
 * Returns null when nothing could be loaded (the badge then reads
 * "unknown" rather than mislabelling every account as unconfirmed).
 */
async function loadEmailConfirmation(): Promise<Map<string, boolean> | null> {
  try {
    const admin = createAdminClient();
    const confirmed = new Map<string, boolean>();

    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
      if (error) return confirmed.size > 0 ? confirmed : null;

      const users = data?.users ?? [];
      for (const u of users) confirmed.set(u.id, Boolean(u.email_confirmed_at));
      if (users.length < 100) break;
    }

    return confirmed;
  } catch {
    return null;
  }
}

/**
 * Every account with its roles and, for students, the data the review actions
 * need (student number, identity-verification state, and academic section).
 */
export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const { supabase } = await requireAdminUser();

  const [profilesResult, rolesResult, studentsResult, confirmedById] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, full_name, status, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('user_roles').select('user_id, role'),
    supabase.from('student_profiles').select('user_id, student_number, verification_status, section_id'),
    loadEmailConfirmation(),
  ]);

  const rolesByUser = new Map<string, string[]>();
  for (const r of rolesResult.data ?? []) {
    const list = rolesByUser.get(r.user_id) ?? [];
    list.push(r.role);
    rolesByUser.set(r.user_id, list);
  }

  const studentByUser = new Map(
    (studentsResult.data ?? []).map((s) => [s.user_id, s] as const)
  );

  return (profilesResult.data ?? []).map((p) => {
    const student = studentByUser.get(p.id);
    return {
      id: p.id,
      email: p.email ?? '',
      fullName: p.full_name ?? '(no name)',
      status: p.status ?? 'active',
      createdAt: p.created_at ?? '',
      roles: rolesByUser.get(p.id) ?? [],
      studentNumber: student?.student_number ?? null,
      verificationStatus: student?.verification_status ?? null,
      sectionId: student?.section_id ?? null,
      emailConfirmed: confirmedById ? (confirmedById.get(p.id) ?? null) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Account status
// ---------------------------------------------------------------------------

/**
 * Tells a user their account has been unlocked, now that approval is the
 * only thing standing between registration and using the app.
 *
 * Email goes through Supabase Auth SMTP as a magic link: GoTrue can only
 * send its own templated emails, so the "your account was approved — sign
 * in" copy lives in the project's Magic Link template (Authentication ->
 * Email Templates), and clicking it signs the user straight in. The link is
 * issued by the SERVICE-ROLE client, which uses the implicit flow (no PKCE
 * code challenge), so it can be opened from the recipient's own browser —
 * /login consumes the tokens it lands with. `emailRedirectTo` must be on
 * the project's redirect allowlist.
 *
 * If dispatching fails, fall back to an in-app notification so the approval
 * is still visible after they sign in. Never throws: the status change has
 * already happened and must not be rolled back over a mail problem.
 */
async function dispatchApprovalNotice(userId: string, email: string): Promise<string> {
  if (!email) return 'skipped';

  try {
    const admin = createAdminClient();

    const { error } = await admin.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${appOrigin()}${LOGIN_PATH}`,
        // Never create a mailbox that is not already a profile: this is a
        // notification, not a signup path.
        shouldCreateUser: false,
      },
    });

    if (!error) return 'email';
    logger.error('Approval email not dispatched:', error.message);
  } catch (err) {
    logger.error('Approval email not dispatched:', err instanceof Error ? err.message : err);
  }

  const notified = await notifyUser({
    userId,
    type: 'system',
    title: 'Your account was approved',
    body: 'An administrator approved your account. Sign in with your email address and password to start using the app.',
    data: { account_approved: true },
  });

  return notified ? 'in_app' : 'failed';
}

/**
 * Activate or suspend an account — the two status transitions an
 * administrator has (email confirmation verifies the address; the admin's
 * remaining job is simply to let the person in or keep them out).
 */
export async function setUserStatus(userId: string, status: string): Promise<ActionResult> {
  const { supabase, userId: actorId } = await requireAdminUser();

  if (!UUID_RE.test(text(userId))) return { error: 'Invalid user id.' };
  if (!ADMIN_SETTABLE_STATUSES.includes(status)) {
    return { error: 'Administrators can only activate or suspend an account.' };
  }
  if (userId === actorId && status !== 'active') {
    return { error: 'You cannot deactivate or suspend your own account.' };
  }

  // Read first: the approval notice needs the PREVIOUS status (only a
  // transition INTO 'active' notifies) and the address to send it to.
  const { data: profile } = await supabase
    .from('profiles')
    .select('status, email')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return { error: 'That user account no longer exists.' };

  const { data, error } = await supabase
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update the account.') };
  if (!data) return { error: 'That user account no longer exists.' };

  // Unlocking an account (pending/suspended/inactive -> active) emails the
  // user a sign-in link. Best-effort: it runs AFTER the update, so a mail
  // failure can only downgrade the notice, never fail the action.
  const approvalNotice =
    status === 'active' && profile.status !== 'active'
      ? await dispatchApprovalNotice(userId, profile.email ?? '')
      : 'skipped';

  await recordAuditLog({
    actorUserId: actorId,
    action: 'update',
    entityType: 'profile',
    entityId: userId,
    metadata: { status, approval_notice: approvalNotice },
  });

  revalidateUsers();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

/**
 * Email this account a password-reset link — the administrator's escape
 * hatch for someone who cannot get in (wrong password, lost access to the
 * original device, no self-service recovery working). Same rules as every
 * other emailed link: issued by the service-role client so it uses the
 * implicit flow and opens in the recipient's own browser, redirected to an
 * allowlisted path (/reset-password) that consumes the tokens and shows the
 * "choose a new password" form.
 */
export async function sendUserPasswordReset(userId: string): Promise<ActionResult> {
  const { supabase, userId: actorId } = await requireAdminUser();

  if (!UUID_RE.test(text(userId))) return { error: 'Invalid user id.' };

  const { data: profile } = await supabase
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return { error: 'That user account no longer exists.' };
  if (!profile.email) return { error: 'That account has no email address on file.' };

  const { error } = await createAdminClient().auth.resetPasswordForEmail(profile.email, {
    redirectTo: `${appOrigin()}${RESET_PASSWORD_PATH}`,
  });

  if (error) {
    const status = (error as { status?: number }).status;
    if (status !== 429) {
      logger.error('Password reset email not dispatched:', error.message);
    }
    return {
      error: /rate limit/i.test(error.message)
        ? 'Too many requests — wait a minute and try again.'
        : 'Could not send the reset email right now. Please try again shortly.',
    };
  }

  await recordAuditLog({
    actorUserId: actorId,
    action: 'update',
    entityType: 'profile',
    entityId: userId,
    metadata: { password_reset_email: true },
  });

  return { success: true };
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export async function assignRole(userId: string, role: string): Promise<ActionResult> {
  const { supabase, userId: actorId } = await requireAdminUser();

  if (!UUID_RE.test(text(userId))) return { error: 'Invalid user id.' };
  if (!isAssignableRole(role)) return { error: 'Invalid role.' };

  // The target must have a profile — user_roles.user_id has an FK to
  // profiles(id), so a role for a profile-less user cannot exist.
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle();

  if (!profile) return { error: 'That user account no longer exists.' };

  if (role === 'student') {
    // A student role is meaningless without a student profile (it holds the
    // student number and program), and student_profiles.user_id is the FK
    // target for enrollments.
    const { data: studentProfile } = await supabase
      .from('student_profiles')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!studentProfile) {
      return {
        error: 'That user has no student profile. They must register as a student first.',
      };
    }
  }

  const { error } = await supabase.from('user_roles').insert({ user_id: userId, role });

  if (error) return { error: friendlyError(error.message, 'Failed to assign the role.') };

  // A faculty member needs the companion profile row that the app reads when
  // listing assignable faculty. Non-fatal if it already exists.
  if (role === 'faculty') {
    await supabase.from('faculty_profiles').insert({ user_id: userId });
  }

  await recordAuditLog({
    actorUserId: actorId,
    action: 'update',
    entityType: 'user_role',
    entityId: userId,
    metadata: { granted: role },
  });

  revalidateUsers();
  return { success: true };
}

export async function revokeRole(userId: string, role: string): Promise<ActionResult> {
  const { supabase, userId: actorId } = await requireAdminUser();

  if (!UUID_RE.test(text(userId))) return { error: 'Invalid user id.' };
  if (!isAssignableRole(role)) return { error: 'Invalid role.' };

  if (role === 'super_admin') {
    if (userId === actorId) {
      return { error: 'You cannot remove your own administrator role.' };
    }

    const { data: admins } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'super_admin');

    if ((admins?.length ?? 0) <= 1) {
      return { error: 'The system must keep at least one administrator.' };
    }
  }

  const { data, error } = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('role', role)
    .select('role')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to remove the role.') };
  if (!data) return { error: 'That user does not have that role.' };

  await recordAuditLog({
    actorUserId: actorId,
    action: 'update',
    entityType: 'user_role',
    entityId: userId,
    metadata: { revoked: role },
  });

  revalidateUsers();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Student identity verification
// ---------------------------------------------------------------------------

export async function setStudentVerification(
  userId: string,
  status: string
): Promise<ActionResult> {
  const { supabase, userId: actorId } = await requireAdminUser();

  if (!UUID_RE.test(text(userId))) return { error: 'Invalid user id.' };
  if (!isVerificationStatus(status)) return { error: 'Invalid verification status.' };

  // verification_* columns are revoked from `authenticated` (students could
  // otherwise self-grant on their own row), so the direct UPDATE above would
  // be denied — the SECURITY DEFINER function re-checks super admin inside.
  const { data, error } = await supabase.rpc('admin_set_student_verification', {
    p_student_id: userId,
    p_status: status,
  });

  if (error) {
    if (error.code === '42501') return { error: 'Not authorized to change verification status.' };
    if (error.code === '22023') return { error: 'Invalid verification status.' };
    return { error: friendlyError(error.message, 'Failed to update verification.') };
  }
  if (data !== true) return { error: 'That user has no student profile.' };

  await recordAuditLog({
    actorUserId: actorId,
    action: 'update',
    entityType: 'student_profile',
    entityId: userId,
    metadata: { verification_status: status },
  });

  revalidateUsers();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Student section assignment (with offering-enrollment sync)
// ---------------------------------------------------------------------------

/**
 * Assigns (or clears) the student's academic section.
 *
 * Sync hook: while the section is set, the student is enrolled — and
 * previously-withdrawn rows re-enrolled — into every ACTIVE offering that
 * targets that section. This is the fix for "the student is in the section
 * but not enrolled in the subject": section membership seeds enrollment.
 *
 * Clearing the section (null) does NOT withdraw them from offerings — they
 * may have attempt history; withdrawal stays a faculty decision on the roster.
 * Moving to a DIFFERENT section DOES withdraw the old section's active
 * enrollments, so My Subjects never shows the same subject once per section.
 *
 * Setting the same section again re-runs the sync, so it also repairs drift.
 */
export async function setStudentSection(
  userId: string,
  sectionId: string | null
): Promise<ActionResult> {
  const { supabase, userId: actorId } = await requireAdminUser();

  if (!UUID_RE.test(text(userId))) return { error: 'Invalid user id.' };

  const sid = sectionId ? text(sectionId) : null;
  if (sid && !UUID_RE.test(sid)) return { error: 'Invalid section id.' };

  const { data: studentProfile } = await supabase
    .from('student_profiles')
    .select('user_id, section_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!studentProfile) return { error: 'That user has no student profile.' };

  if (sid) {
    const { data: section } = await supabase
      .from('sections')
      .select('id, name')
      .eq('id', sid)
      .maybeSingle();
    if (!section) return { error: 'That section no longer exists.' };
  }

  const { data: updated, error } = await supabase
    .from('student_profiles')
    .update({ section_id: sid, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update the section.') };
  if (!updated) return { error: 'That student profile no longer exists.' };

  // Moving BETWEEN sections: withdraw the old section's active enrollments
  // first, otherwise the student keeps both sections' offerings and sees the
  // same subject twice. Clearing the section skips this (documented above).
  let autoWithdrew = 0;
  const previousSectionId = studentProfile.section_id;
  if (previousSectionId && sid && previousSectionId !== sid) {
    const { data: oldOfferings } = await supabase
      .from('subject_offerings')
      .select('id')
      .eq('section_id', previousSectionId);
    const oldOfferingIds = (oldOfferings ?? []).map((o) => o.id);

    if (oldOfferingIds.length > 0) {
      const { data: stale } = await supabase
        .from('enrollments')
        .select('id')
        .eq('student_id', userId)
        .eq('status', 'enrolled')
        .in('subject_offering_id', oldOfferingIds);
      const staleIds = (stale ?? []).map((e) => e.id);

      if (staleIds.length > 0) {
        const { error: withdrawError } = await supabase
          .from('enrollments')
          .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
          .in('id', staleIds);
        if (!withdrawError) autoWithdrew = staleIds.length;
      }
    }
  }

  // Enrollment sync (only when moving INTO a section).
  let autoEnrolled = 0;
  if (sid) {
    const { data: offerings } = await supabase
      .from('subject_offerings')
      .select('id')
      .eq('section_id', sid)
      .eq('status', 'active');

    for (const offering of offerings ?? []) {
      const summary = await enrollStudents(supabase, offering.id, [userId]);
      autoEnrolled += summary.added + summary.reenrolled;
    }
  }

  await recordAuditLog({
    actorUserId: actorId,
    action: 'update',
    entityType: 'student_profile',
    entityId: userId,
    metadata: {
      section_id: sid,
      previous_section_id: previousSectionId,
      auto_enrolled_offerings: autoEnrolled,
      auto_withdrawn_offerings: autoWithdrew,
    },
  });

  revalidateUsers();
  return { success: true };
}
