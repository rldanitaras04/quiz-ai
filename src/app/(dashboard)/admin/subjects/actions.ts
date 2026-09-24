'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminUser, type ActionResult } from '../actions';
import { recordAuditLog } from '@/lib/audit';
import { enrollStudents } from '@/lib/enrollment';

/**
 * Subject, subject-offering and faculty-assignment configuration.
 *
 * Spec §2.1 gives the super administrator "configure ... subjects" and "manage
 * users and role assignments"; §6 scopes faculty access to authorized
 * assignments, which is what the faculty-assignment controls here produce.
 *
 * All writes use the session client so the `Admin can manage ...` RLS policies
 * remain authoritative, and the caller's role is re-derived from the session on
 * every call.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches the `subject_offerings_status_check` constraint. */
const OFFERING_STATUSES = ['active', 'inactive', 'archived'] as const;
type OfferingStatus = (typeof OFFERING_STATUSES)[number];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function friendlyError(message: string | undefined, fallback: string): string {
  const m = message ?? '';
  if (/duplicate key|unique constraint/i.test(m)) {
    return 'A record with those details already exists.';
  }
  if (/foreign key/i.test(m)) {
    return 'This record is still referenced by other records and cannot be removed.';
  }
  if (/permission denied|row-level security/i.test(m)) {
    return 'You do not have permission to make this change.';
  }
  if (/check constraint/i.test(m)) {
    return 'One of the submitted values is not allowed.';
  }
  return fallback;
}

function revalidateSubjects(): void {
  revalidatePath('/admin/subjects');
  revalidatePath('/admin');
  // Faculty workspaces reflect new/removed offerings and assignments.
  revalidatePath('/faculty/subjects');
  revalidatePath('/faculty');
}

function isOfferingStatus(value: string): value is OfferingStatus {
  return (OFFERING_STATUSES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Overview loader
// ---------------------------------------------------------------------------

export interface OfferingWithFaculty {
  id: string;
  status: string;
  semesterId: string;
  semester: string;
  academicYear: string;
  programId: string;
  program: string;
  yearLevelId: string;
  yearLevel: string;
  sectionId: string;
  section: string;
  enrolledCount: number;
  faculty: Array<{
    assignmentId: string;
    facultyId: string;
    fullName: string;
    isPrimary: boolean;
  }>;
}

export interface SubjectOverview {
  id: string;
  code: string;
  title: string;
  description: string | null;
  isActive: boolean;
  offerings: OfferingWithFaculty[];
}

/**
 * Subjects with their offerings, enrollment counts and faculty assignments.
 *
 * Named relationships in the select return objects (not arrays) in this client
 * version; the defensive `unwrap` handles either shape.
 */
export async function getSubjectsOverview(): Promise<SubjectOverview[]> {
  const { supabase } = await requireAdminUser();

  const [subjectsResult, offeringsResult, enrollmentsResult, assignmentsResult] =
    await Promise.all([
      supabase.from('subjects').select('*').order('code', { ascending: true }),
      supabase.from('subject_offerings').select(`
        id, subject_id, semester_id, program_id, year_level_id, section_id, status,
        semester:semesters(name, academic_year:academic_years(name)),
        program:programs(name),
        year_level:year_levels(name),
        section:sections(name)
      `),
      supabase.from('enrollments').select('subject_offering_id').eq('status', 'enrolled'),
      supabase.from('faculty_assignments').select(`
        id, subject_offering_id, faculty_id, is_primary,
        faculty:faculty_profiles(profiles(full_name))
      `),
    ]);

  const enrollmentsByOffering = new Map<string, number>();
  for (const e of enrollmentsResult.data ?? []) {
    enrollmentsByOffering.set(
      e.subject_offering_id,
      (enrollmentsByOffering.get(e.subject_offering_id) ?? 0) + 1
    );
  }

  const facultyByOffering = new Map<string, OfferingWithFaculty['faculty']>();
  for (const a of assignmentsResult.data ?? []) {
    const faculty = Array.isArray(a.faculty) ? a.faculty[0] : a.faculty;
    const facultyProfileRaw = (faculty as { profiles?: { full_name?: string } | { full_name?: string }[] | null } | null)?.profiles ?? null;
    const facultyProfile = Array.isArray(facultyProfileRaw) ? facultyProfileRaw[0] : facultyProfileRaw;
    const list = facultyByOffering.get(a.subject_offering_id) ?? [];
    list.push({
      assignmentId: a.id,
      facultyId: a.faculty_id,
      fullName: facultyProfile?.full_name ?? '(unknown)',
      isPrimary: Boolean(a.is_primary),
    });
    facultyByOffering.set(a.subject_offering_id, list);
  }

  const offeringsBySubject = new Map<string, OfferingWithFaculty[]>();
  for (const o of offeringsResult.data ?? []) {
    const semester = Array.isArray(o.semester) ? o.semester[0] : o.semester;
    const academicYear = semester
      ? (Array.isArray(semester.academic_year) ? semester.academic_year[0] : semester.academic_year)
      : null;
    const program = Array.isArray(o.program) ? o.program[0] : o.program;
    const yearLevel = Array.isArray(o.year_level) ? o.year_level[0] : o.year_level;
    const section = Array.isArray(o.section) ? o.section[0] : o.section;

    const list = offeringsBySubject.get(o.subject_id) ?? [];
    list.push({
      id: o.id,
      status: o.status,
      semesterId: o.semester_id,
      semester: (semester as { name?: string } | null)?.name ?? '—',
      academicYear: (academicYear as { name?: string } | null)?.name ?? '—',
      programId: o.program_id,
      program: (program as { name?: string } | null)?.name ?? '—',
      yearLevelId: o.year_level_id,
      yearLevel: (yearLevel as { name?: string } | null)?.name ?? '—',
      sectionId: o.section_id,
      section: (section as { name?: string } | null)?.name ?? '—',
      enrolledCount: enrollmentsByOffering.get(o.id) ?? 0,
      faculty: facultyByOffering.get(o.id) ?? [],
    });
    offeringsBySubject.set(o.subject_id, list);
  }

  return (subjectsResult.data ?? []).map((s) => ({
    id: s.id,
    code: s.code,
    title: s.title,
    description: s.description,
    isActive: s.is_active,
    offerings: offeringsBySubject.get(s.id) ?? [],
  }));
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export async function createSubject(input: {
  code: string;
  title: string;
  description?: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const code = text(input?.code).toUpperCase();
  const title = text(input?.title);
  const description = text(input?.description);

  if (!/^[A-Z0-9-]{2,20}$/.test(code)) {
    return { error: 'Subject code must be 2-20 letters, numbers, or hyphens.' };
  }
  if (title.length < 2 || title.length > 160) {
    return { error: 'Title must be 2-160 characters.' };
  }
  if (description.length > 2000) {
    return { error: 'Description must be 2000 characters or fewer.' };
  }

  const { data, error } = await supabase
    .from('subjects')
    .insert({ code, title, description: description || null, is_active: true })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to create the subject.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'subject',
    entityId: data?.id ?? null,
    metadata: { code, title },
  });

  revalidateSubjects();
  return { success: true };
}

export async function updateSubject(input: {
  id: string;
  code: string;
  title: string;
  description?: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const id = text(input?.id);
  const code = text(input?.code).toUpperCase();
  const title = text(input?.title);
  const description = text(input?.description);

  if (!UUID_RE.test(id)) return { error: 'Invalid subject id.' };
  if (!/^[A-Z0-9-]{2,20}$/.test(code)) {
    return { error: 'Subject code must be 2-20 letters, numbers, or hyphens.' };
  }
  if (title.length < 2 || title.length > 160) {
    return { error: 'Title must be 2-160 characters.' };
  }
  if (description.length > 2000) {
    return { error: 'Description must be 2000 characters or fewer.' };
  }

  const { data, error } = await supabase
    .from('subjects')
    .update({ code, title, description: description || null })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update the subject.') };
  if (!data) return { error: 'That subject no longer exists or you cannot modify it.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'subject',
    entityId: id,
    metadata: { code, title },
  });

  revalidateSubjects();
  return { success: true };
}

export async function setSubjectActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  if (!UUID_RE.test(text(id))) return { error: 'Invalid subject id.' };
  if (typeof isActive !== 'boolean') return { error: 'Invalid state.' };

  const { data, error } = await supabase
    .from('subjects')
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update the subject.') };
  if (!data) return { error: 'That subject no longer exists or you cannot modify it.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'subject',
    entityId: id,
    metadata: { is_active: isActive },
  });

  revalidateSubjects();
  return { success: true };
}

export async function deleteSubject(id: string): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  if (!UUID_RE.test(text(id))) return { error: 'Invalid subject id.' };

  const { data, error } = await supabase
    .from('subjects')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: friendlyError(
        error.message,
        'This subject still has offerings or assessments and cannot be deleted. Deactivate it instead.'
      ),
    };
  }
  if (!data) return { error: 'That subject no longer exists or you cannot delete it.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'delete',
    entityType: 'subject',
    entityId: id,
  });

  revalidateSubjects();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Offerings
// ---------------------------------------------------------------------------

export async function createOffering(input: {
  subjectId: string;
  semesterId: string;
  programId: string;
  yearLevelId: string;
  sectionId: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const subjectId = text(input?.subjectId);
  const semesterId = text(input?.semesterId);
  const programId = text(input?.programId);
  const yearLevelId = text(input?.yearLevelId);
  const sectionId = text(input?.sectionId);

  for (const [label, value] of [
    ['subject', subjectId],
    ['semester', semesterId],
    ['program', programId],
    ['year level', yearLevelId],
    ['section', sectionId],
  ] as const) {
    if (!UUID_RE.test(value)) return { error: `Select a valid ${label}.` };
  }

  // Business rule: the section must actually belong to the chosen program and
  // year level. The client filters these lists, but a direct POST must not be
  // able to create a nonsensical combination.
  const { data: section } = await supabase
    .from('sections')
    .select('id, program_id, year_level_id')
    .eq('id', sectionId)
    .single();

  if (!section) return { error: 'That section no longer exists.' };
  if (section.program_id !== programId || section.year_level_id !== yearLevelId) {
    return { error: 'That section does not belong to the selected program and year level.' };
  }

  const { data, error } = await supabase
    .from('subject_offerings')
    .insert({
      subject_id: subjectId,
      semester_id: semesterId,
      program_id: programId,
      year_level_id: yearLevelId,
      section_id: sectionId,
      status: 'active',
    })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to create the offering.') };

  // Sync hook: an offering targets a section, so everyone already assigned to
  // that section starts enrolled — otherwise a student can be "in the section"
  // yet absent from every subject. Re-enrolls withdrawn rows too; faculty can
  // still withdraw individually afterwards.
  let autoEnrolled = 0;
  const { data: sectionStudents } = await supabase
    .from('student_profiles')
    .select('user_id')
    .eq('section_id', sectionId);

  if (sectionStudents && sectionStudents.length > 0 && data?.id) {
    const summary = await enrollStudents(
      supabase,
      data.id,
      sectionStudents.map((s) => s.user_id)
    );
    autoEnrolled = summary.added + summary.reenrolled;
  }

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'subject_offering',
    entityId: data?.id ?? null,
    metadata: {
      subject_id: subjectId,
      semester_id: semesterId,
      section_id: sectionId,
      auto_enrolled: autoEnrolled,
    },
  });

  revalidateSubjects();
  return { success: true };
}

export async function setOfferingStatus(id: string, status: string): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  if (!UUID_RE.test(text(id))) return { error: 'Invalid offering id.' };
  if (!isOfferingStatus(status)) return { error: 'Invalid offering status.' };

  const { data, error } = await supabase
    .from('subject_offerings')
    .update({ status })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update the offering.') };
  if (!data) return { error: 'That offering no longer exists or you cannot modify it.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'subject_offering',
    entityId: id,
    metadata: { status },
  });

  revalidateSubjects();
  return { success: true };
}

export async function deleteOffering(id: string): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  if (!UUID_RE.test(text(id))) return { error: 'Invalid offering id.' };

  const { data, error } = await supabase
    .from('subject_offerings')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: friendlyError(
        error.message,
        'This offering still has enrollments, assessments or deployments and cannot be deleted. Archive it instead.'
      ),
    };
  }
  if (!data) return { error: 'That offering no longer exists or you cannot delete it.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'delete',
    entityType: 'subject_offering',
    entityId: id,
  });

  revalidateSubjects();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Enrollment roster (admin "Manage students" modal)
// ---------------------------------------------------------------------------

export interface OfferingRosterRow {
  enrollmentId: string;
  studentId: string;
  status: string;
  enrolledAt: string;
  fullName: string;
  email: string | null;
  studentNumber: string;
}

export type OfferingRosterResult =
  | { error: string }
  | {
      success: true;
      rows: OfferingRosterRow[];
      subjectLabel: string;
      sectionLabel: string;
      sectionId: string;
    };

/** Enrolled roster for one offering — the admin modal's data source. */
export async function getOfferingRoster(offeringId: string): Promise<OfferingRosterResult> {
  const { supabase } = await requireAdminUser();

  if (!/^[0-9a-f-]{36}$/i.test(offeringId)) return { error: 'Invalid offering id.' };

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('id, section_id, subject:subjects(code, title), section:sections(name)')
    .eq('id', offeringId)
    .single();

  if (!offering) return { error: 'That offering no longer exists.' };

  const { data: enrollments, error } = await supabase
    .from('enrollments')
    .select(`
      id,
      student_id,
      status,
      enrolled_at,
      student:student_profiles(student_number, profiles(full_name, email))
    `)
    .eq('subject_offering_id', offeringId)
    .eq('status', 'enrolled')
    .order('enrolled_at', { ascending: true });

  if (error) return { error: 'Failed to load the roster.' };

  const subject = Array.isArray(offering.subject) ? offering.subject[0] : offering.subject;
  const section = Array.isArray(offering.section) ? offering.section[0] : offering.section;

  interface RawEnrollment {
    id: string;
    student_id: string;
    status: string;
    enrolled_at: string;
    student: {
      student_number: string | null;
      profiles: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null;
    } | null;
  }

  const rows: OfferingRosterRow[] = ((enrollments ?? []) as unknown as RawEnrollment[]).map((e) => {
    const student = e.student ?? null;
    const profileRaw = student?.profiles ?? null;
    const profile = Array.isArray(profileRaw) ? profileRaw[0] : profileRaw;

    return {
      enrollmentId: e.id,
      studentId: e.student_id,
      status: e.status,
      enrolledAt: e.enrolled_at,
      fullName: profile?.full_name ?? '(unknown)',
      email: profile?.email ?? null,
      studentNumber: student?.student_number ?? '',
    };
  });

  const sectionId = (offering as { section_id?: string | null }).section_id ?? '';

  return {
    success: true,
    rows,
    subjectLabel: subject ? `${subject.code} – ${subject.title}` : 'Offering',
    sectionLabel: section?.name ?? '—',
    sectionId,
  };
}

// ---------------------------------------------------------------------------
// Faculty assignments
// ---------------------------------------------------------------------------

export async function assignFaculty(input: {
  offeringId: string;
  facultyId: string;
  isPrimary?: boolean;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const offeringId = text(input?.offeringId);
  const facultyId = text(input?.facultyId);
  const isPrimary = input?.isPrimary !== false;

  if (!UUID_RE.test(offeringId)) return { error: 'Invalid offering id.' };
  if (!UUID_RE.test(facultyId)) return { error: 'Select a faculty member.' };

  // The assignee must actually hold the faculty role — a client-supplied id
  // must not be able to attach an arbitrary user to an offering.
  const { data: role } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', facultyId)
    .eq('role', 'faculty')
    .maybeSingle();

  if (!role) return { error: 'That user is not a faculty member.' };

  const { data, error } = await supabase
    .from('faculty_assignments')
    .insert({ subject_offering_id: offeringId, faculty_id: facultyId, is_primary: isPrimary })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to assign the faculty member.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'faculty_assignment',
    entityId: data?.id ?? null,
    metadata: { subject_offering_id: offeringId, faculty_id: facultyId },
  });

  revalidateSubjects();
  return { success: true };
}

export async function removeFacultyAssignment(assignmentId: string): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  if (!UUID_RE.test(text(assignmentId))) return { error: 'Invalid assignment id.' };

  const { data, error } = await supabase
    .from('faculty_assignments')
    .delete()
    .eq('id', assignmentId)
    .select('id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to remove the assignment.') };
  if (!data) return { error: 'That assignment no longer exists.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: 'faculty_assignment',
    entityId: assignmentId,
  });

  revalidateSubjects();
  return { success: true };
}
