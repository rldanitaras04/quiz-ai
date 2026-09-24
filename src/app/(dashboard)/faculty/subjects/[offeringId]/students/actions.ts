'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { canManageEnrollment } from '@/lib/auth';
import {
  enrollStudents,
  parseStudentNumbers,
  resolveStudentIdsByNumbers,
  resolveStudentIdsInSection,
} from '@/lib/enrollment';
import { describeSummary, type EnrollSummary } from '@/lib/enrollment-summary';

/** Every view whose contents change when an enrollment does. */
function revalidateEnrollments(offeringId: string): void {
  revalidatePath(`/faculty/subjects/${offeringId}/students`);
  revalidatePath('/faculty/subjects/[offeringId]/students', 'page');
  revalidatePath(`/faculty/subjects/${offeringId}`);
  revalidatePath('/faculty/subjects');
  revalidatePath('/faculty');
  revalidatePath('/admin/subjects');
  revalidatePath('/student/subjects');
  revalidatePath('/student/assessments');
}

export interface BulkEnrollResult {
  error?: string;
  summary?: EnrollSummary;
}

async function requireEnrollmentManager(
  offeringId: string
): Promise<{ error: string } | { supabase: Awaited<ReturnType<typeof createClient>>; userId: string }> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  if (!(await canManageEnrollment(supabase, user.id, offeringId))) {
    return { error: 'Not authorized for this offering' };
  }

  return { supabase, userId: user.id };
}

export interface StudentSearchHit {
  userId: string;
  studentNumber: string;
  fullName: string | null;
  email: string | null;
  /** Enrollment status on this offering; null when not enrolled. */
  enrollmentStatus?: string | null;
  /** True when the student's academic section matches this offering. */
  inSection?: boolean;
}

type StudentProfileJoinRow = {
  user_id: string;
  student_number: string;
  profiles:
    | { id: string; full_name: string | null; email: string | null }
    | { id: string; full_name: string | null; email: string | null }[]
    | null;
};

function toStudentHit(row: StudentProfileJoinRow): StudentSearchHit {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    userId: row.user_id,
    studentNumber: row.student_number,
    fullName: profile?.full_name ?? null,
    email: profile?.email ?? null,
    enrollmentStatus: null,
    inSection: false,
  };
}

async function attachEnrollmentContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  offeringId: string,
  sectionId: string | null,
  hits: StudentSearchHit[]
): Promise<StudentSearchHit[]> {
  if (hits.length === 0) return hits;

  const ids = hits.map((h) => h.userId);
  const [{ data: enrollments }, { data: sectionProfiles }] = await Promise.all([
    supabase
      .from('enrollments')
      .select('student_id, status')
      .eq('subject_offering_id', offeringId)
      .in('student_id', ids),
    sectionId
      ? supabase.from('student_profiles').select('user_id').eq('section_id', sectionId).in('user_id', ids)
      : Promise.resolve({ data: [] as { user_id: string }[] }),
  ]);

  const statusByStudent = new Map(
    ((enrollments ?? []) as { student_id: string; status: string }[]).map((e) => [e.student_id, e.status])
  );
  const inSectionIds = new Set(
    ((sectionProfiles ?? []) as { user_id: string }[]).map((r) => r.user_id)
  );

  return hits.map((hit) => ({
    ...hit,
    enrollmentStatus: statusByStudent.get(hit.userId) ?? null,
    inSection: inSectionIds.has(hit.userId),
  }));
}

async function offeringSectionId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  offeringId: string
): Promise<{ sectionId: string | null; sectionName: string | null }> {
  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('section_id, section:sections(id, name)')
    .eq('id', offeringId)
    .maybeSingle();

  const section = (offering as { section_id?: string | null; section?: { name?: string } | { name?: string }[] | null } | null) ?? null;
  const sectionName = Array.isArray(section?.section) ? section.section[0]?.name : section?.section?.name;
  return { sectionId: section?.section_id ?? null, sectionName: sectionName ?? null };
}

/**
 * Directory search for enrollment: match by student number or full name.
 * Uses the service-role client (same RLS rationale as `addStudentToOffering`).
 */
export async function searchStudents(
  offeringId: string,
  rawQuery: string
): Promise<{ error?: string; students?: StudentSearchHit[] }> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase } = gate;

  const q = rawQuery.trim();
  if (q.length < 2) return { students: [] };

  const escaped = q.replace(/([\\%_])/g, '\\$1');
  const pattern = `%${escaped}%`;
  const admin = createAdminClient();
  const { sectionId } = await offeringSectionId(supabase, offeringId);

  const [byNumber, byName] = await Promise.all([
    admin
      .from('student_profiles')
      .select('user_id, student_number, profiles(id, full_name, email)')
      .ilike('student_number', pattern)
      .limit(12),
    admin
      .from('profiles')
      .select('id, full_name, email')
      .ilike('full_name', pattern)
      .limit(12),
  ]);

  if (byNumber.error || byName.error) {
    return { error: 'Failed to search students' };
  }

  const hits = new Map<string, StudentSearchHit>();

  for (const row of (byNumber.data ?? []) as unknown as StudentProfileJoinRow[]) {
    hits.set(row.user_id, toStudentHit(row));
  }

  const nameIds = ((byName.data ?? []) as { id: string }[]).map((p) => p.id);
  if (nameIds.length > 0) {
    const { data: byNameId, error: byNameIdError } = await admin
      .from('student_profiles')
      .select('user_id, student_number, profiles(id, full_name, email)')
      .in('user_id', nameIds)
      .limit(12);

    if (byNameIdError) return { error: 'Failed to search students' };

    for (const row of (byNameId ?? []) as unknown as StudentProfileJoinRow[]) {
      if (hits.has(row.user_id)) continue;
      hits.set(row.user_id, toStudentHit(row));
    }
  }

  const students = await attachEnrollmentContext(supabase, offeringId, sectionId, [...hits.values()]);
  return { students };
}

export interface SectionStudentList {
  error?: string;
  sectionId?: string;
  sectionName?: string;
  students?: StudentSearchHit[];
}

/**
 * Every student assigned to this offering's academic section, with current
 * enrollment status — the roster for bulk multi-select enroll.
 */
export async function listSectionStudents(offeringId: string): Promise<SectionStudentList> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase } = gate;

  const { sectionId, sectionName } = await offeringSectionId(supabase, offeringId);
  if (!sectionId) return { error: 'This offering has no section assigned' };

  const admin = createAdminClient();
  const { data: sectionRows, error: sectionError } = await admin
    .from('student_profiles')
    .select('user_id, student_number, profiles(id, full_name, email)')
    .eq('section_id', sectionId)
    .order('student_number');

  if (sectionError) return { error: 'Failed to load the section roster' };

  const base = ((sectionRows ?? []) as unknown as StudentProfileJoinRow[]).map(toStudentHit);
  const students = await attachEnrollmentContext(supabase, offeringId, sectionId, base);

  return { sectionId, sectionName: sectionName ?? undefined, students };
}

/**
 * Enrolls an explicit set of student user IDs (checkbox selection from the
 * section roster and/or irregular students found via search).
 */
export async function enrollStudentsByIds(
  offeringId: string,
  studentIds: string[]
): Promise<BulkEnrollResult> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase, userId } = gate;

  const ids = [...new Set((studentIds ?? []).map((id) => id?.trim()).filter(Boolean))];
  if (ids.length === 0) return { error: 'Select at least one student to enroll' };

  const summary = await enrollStudents(supabase, offeringId, ids);

  if (summary.added > 0 || summary.reenrolled > 0) {
    await recordAuditLog({
      actorUserId: userId,
      action: 'create',
      entityType: 'enrollment',
      entityId: null,
      metadata: {
        subject_offering_id: offeringId,
        selected: true,
        student_ids: ids,
        summary: describeSummary(summary),
      },
    });
    revalidateEnrollments(offeringId);
  }

  if (
    summary.added === 0 &&
    summary.reenrolled === 0 &&
    summary.alreadyEnrolled === 0 &&
    summary.failed > 0
  ) {
    return { error: 'None of those students could be enrolled' };
  }

  return { summary };
}

export async function addStudentToOffering(
  offeringId: string,
  studentNumber: string
): Promise<{ error?: string; success?: boolean }> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase, userId } = gate;

  const number = studentNumber?.trim();
  if (!number) return { error: 'Enter a student number' };

  // The lookup runs with the service-role client on purpose. Under RLS a
  // faculty member may only read student_profiles for students who are
  // ALREADY enrolled in one of their offerings, so resolving a student to
  // enroll via the session client always failed — the exact case this action
  // exists for. Authorization was already established above, and the
  // enrollment write itself still goes through the session client, so RLS
  // keeps enforcing the write.
  const admin = createAdminClient();
  const { data: studentProfile } = await admin
    .from('student_profiles')
    .select('user_id')
    .eq('student_number', number)
    .maybeSingle();

  if (!studentProfile) return { error: 'Student not found with that student number' };

  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentProfile.user_id)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'enrolled') return { error: 'Student is already enrolled' };

    const { data: reenrolled, error } = await supabase
      .from('enrollments')
      .update({ status: 'enrolled', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();

    if (error) return { error: 'Failed to re-enroll student' };
    if (!reenrolled) return { error: 'That enrollment no longer exists or you cannot modify it' };

    await recordAuditLog({
      actorUserId: userId,
      action: 'update',
      entityType: 'enrollment',
      entityId: existing.id,
      metadata: { subject_offering_id: offeringId, student_number: number, status: 'enrolled' },
    });

    revalidateEnrollments(offeringId);
    return { success: true };
  }

  const { data: enrollment, error } = await supabase
    .from('enrollments')
    .insert({
      subject_offering_id: offeringId,
      student_id: studentProfile.user_id,
      status: 'enrolled',
      enrolled_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: 'Failed to enroll student' };
  if (!enrollment) return { error: 'Failed to enroll student' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'enrollment',
    entityId: enrollment.id,
    metadata: { subject_offering_id: offeringId, student_number: number },
  });

  revalidateEnrollments(offeringId);
  return { success: true };
}

/**
 * Bulk add: pasted/comma-separated student numbers in one call. Partial
 * success is not an error — the summary reports what happened per number so
 * the UI can show "2 added · 1 not found".
 */
export async function addStudentsToOffering(
  offeringId: string,
  inputs: string[]
): Promise<BulkEnrollResult> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase, userId } = gate;

  const numbers = parseStudentNumbers(Array.isArray(inputs) ? inputs : []);
  if (numbers.length === 0) return { error: 'Enter at least one student number' };

  const lookup = createAdminClient();
  const resolved = await resolveStudentIdsByNumbers(lookup, numbers);
  if (resolved.error) return { error: 'Failed to look up students' };

  const summary = await enrollStudents(supabase, offeringId, resolved.ids);
  summary.notFound = resolved.notFound;

  if (summary.added > 0 || summary.reenrolled > 0) {
    await recordAuditLog({
      actorUserId: userId,
      action: 'create',
      entityType: 'enrollment',
      entityId: null,
      metadata: {
        subject_offering_id: offeringId,
        bulk: true,
        numbers,
        summary: describeSummary(summary),
      },
    });
    revalidateEnrollments(offeringId);
  }

  if (summary.added === 0 && summary.reenrolled === 0 && summary.failed > 0) {
    return { error: 'None of those students could be enrolled' };
  }

  return { summary };
}

/**
 * One-click catch-all: enroll every student assigned to this offering's
 * academic section (`student_profiles.section_id = subject_offerings.section_id`).
 * This is the fix for "student is in the section but not in the subject".
 */
export async function enrollSectionStudents(offeringId: string): Promise<BulkEnrollResult & { sectionName?: string }> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase, userId } = gate;

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('id, section_id, section:sections(id, name)')
    .eq('id', offeringId)
    .single();

  const sectionId = (offering as { section_id?: string | null } | null)?.section_id;
  const section = (offering as { section?: { name?: string } | { name?: string }[] | null } | null)?.section;
  const sectionName = Array.isArray(section) ? section[0]?.name : section?.name;

  if (!offering || !sectionId) {
    return { error: 'This offering has no section assigned' };
  }

  const lookup = createAdminClient();
  const resolved = await resolveStudentIdsInSection(lookup, sectionId);
  if (resolved.error) return { error: 'Failed to read the section roster' };
  if (resolved.ids.length === 0) {
    return { error: `No students are assigned to section ${sectionName ?? ''}`.trim() };
  }

  const summary = await enrollStudents(supabase, offeringId, resolved.ids);

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'enrollment',
    entityId: null,
    metadata: {
      subject_offering_id: offeringId,
      section_id: sectionId,
      section_enroll: true,
      summary: describeSummary(summary),
    },
  });
  revalidateEnrollments(offeringId);

  if (summary.failed > 0 && summary.added === 0 && summary.reenrolled === 0 && summary.alreadyEnrolled === 0) {
    return { error: 'Failed to enroll the section students' };
  }

  return { summary, sectionName };
}

export async function removeStudentFromOffering(
  offeringId: string,
  studentId: string
): Promise<{ error?: string; success?: boolean }> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase, userId } = gate;

  // Withdrawing keeps the row (and any submissions attached to it) — the same
  // soft state the enrollment vocabulary already defines.
  const { data: withdrawn, error } = await supabase
    .from('enrollments')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentId)
    .eq('status', 'enrolled')
    .select('id')
    .maybeSingle();

  if (error) return { error: 'Failed to remove student' };
  if (!withdrawn) return { error: 'That student is not actively enrolled in this offering' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'enrollment',
    entityId: withdrawn.id,
    metadata: { subject_offering_id: offeringId, student_id: studentId, status: 'withdrawn' },
  });

  revalidateEnrollments(offeringId);
  return { success: true };
}

/**
 * Restores a withdrawn/dropped/completed enrollment to `enrolled`. The roster
 * shows every status, so this is the inverse of remove — previously the
 * re-enroll branch inside `addStudentToOffering` was unreachable from the UI
 * because withdrawn rows never appeared.
 */
export async function restoreStudentToOffering(
  offeringId: string,
  studentId: string
): Promise<{ error?: string; success?: boolean }> {
  const gate = await requireEnrollmentManager(offeringId);
  if ('error' in gate) return gate;
  const { supabase, userId } = gate;

  const { data: restored, error } = await supabase
    .from('enrollments')
    .update({ status: 'enrolled', updated_at: new Date().toISOString() })
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentId)
    .neq('status', 'enrolled')
    .select('id')
    .maybeSingle();

  if (error) return { error: 'Failed to re-enroll student' };
  if (!restored) return { error: 'That student has no inactive enrollment in this offering' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'enrollment',
    entityId: restored.id,
    metadata: { subject_offering_id: offeringId, student_id: studentId, status: 'enrolled' },
  });

  revalidateEnrollments(offeringId);
  return { success: true };
}
