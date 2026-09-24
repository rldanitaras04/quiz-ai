'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminUser, type ActionResult } from '../actions';
import { recordAuditLog } from '@/lib/audit';
import { enrollStudents } from '@/lib/enrollment';

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

/** Matches `profiles_status_check`. */
const USER_STATUSES = ['active', 'inactive', 'suspended', 'pending'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

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

function isUserStatus(value: string): value is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(value);
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
}

/**
 * Every account with its roles and, for students, the data the review actions
 * need (student number, identity-verification state, and academic section).
 */
export async function getAdminUsers(): Promise<AdminUserRow[]> {
  const { supabase } = await requireAdminUser();

  const [profilesResult, rolesResult, studentsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, email, full_name, status, created_at')
      .order('created_at', { ascending: false }),
    supabase.from('user_roles').select('user_id, role'),
    supabase.from('student_profiles').select('user_id, student_number, verification_status, section_id'),
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
    };
  });
}

// ---------------------------------------------------------------------------
// Account status
// ---------------------------------------------------------------------------

export async function setUserStatus(userId: string, status: string): Promise<ActionResult> {
  const { supabase, userId: actorId } = await requireAdminUser();

  if (!UUID_RE.test(text(userId))) return { error: 'Invalid user id.' };
  if (!isUserStatus(status)) return { error: 'Invalid account status.' };
  if (userId === actorId && status !== 'active') {
    return { error: 'You cannot deactivate or suspend your own account.' };
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update the account.') };
  if (!data) return { error: 'That user account no longer exists.' };

  await recordAuditLog({
    actorUserId: actorId,
    action: 'update',
    entityType: 'profile',
    entityId: userId,
    metadata: { status },
  });

  revalidateUsers();
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

  const { data, error } = await supabase
    .from('student_profiles')
    .update({ verification_status: status, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update verification.') };
  if (!data) return { error: 'That user has no student profile.' };

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
