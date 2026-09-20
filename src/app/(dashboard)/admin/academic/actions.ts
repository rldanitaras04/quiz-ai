'use server';

import { revalidatePath } from 'next/cache';
import { requireAdminUser, type ActionResult } from '../actions';
import { recordAuditLog } from '@/lib/audit';

/**
 * Academic-structure configuration (spec §2.1: the super administrator
 * "configure[s] academic years, semesters, programs, year levels, sections, and
 * subjects").
 *
 * Every action re-derives the caller's identity and admin role from the session
 * (`requireAdminUser`) and writes with the session client, so the
 * `Admin can manage ...` RLS policies remain the enforcement layer. Nothing
 * here trusts a role or user id supplied by the client.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Entities that carry an `is_active` flag (year_levels does not). */
const TOGGLEABLE = {
  academic_year: 'academic_years',
  semester: 'semesters',
  program: 'programs',
  section: 'sections',
} as const;

type ToggleableEntity = keyof typeof TOGGLEABLE;

/** Entities addressable by the delete action. */
const DELETABLE = {
  ...TOGGLEABLE,
  year_level: 'year_levels',
} as const;

type DeletableEntity = keyof typeof DELETABLE;

function isToggleable(entity: string): entity is ToggleableEntity {
  return Object.prototype.hasOwnProperty.call(TOGGLEABLE, entity);
}

function isDeletable(entity: string): entity is DeletableEntity {
  return Object.prototype.hasOwnProperty.call(DELETABLE, entity);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Turns a Postgres error into something safe and useful for the operator. */
function friendlyError(message: string | undefined, fallback: string): string {
  const m = message ?? '';
  if (/duplicate key|unique constraint/i.test(m)) {
    return 'A record with those details already exists.';
  }
  if (/foreign key|violates foreign key/i.test(m)) {
    return 'This record is still referenced by other records and cannot be removed.';
  }
  if (/permission denied|row-level security/i.test(m)) {
    return 'You do not have permission to make this change.';
  }
  if (/relation .* does not exist/i.test(m)) {
    return 'The requested record type does not exist.';
  }
  return fallback;
}

function revalidateAcademic(): void {
  revalidatePath('/admin/academic');
  revalidatePath('/admin');
}

// ---------------------------------------------------------------------------
// Academic years
// ---------------------------------------------------------------------------

export async function createAcademicYear(input: {
  name: string;
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const name = text(input?.name);
  const startsOn = text(input?.startsOn);
  const endsOn = text(input?.endsOn);

  if (name.length < 4 || name.length > 40) {
    return { error: 'Name must be 4-40 characters (for example 2026-2027).' };
  }
  if (!ISO_DATE_RE.test(startsOn) || !ISO_DATE_RE.test(endsOn)) {
    return { error: 'Start and end dates are required.' };
  }
  if (endsOn <= startsOn) {
    return { error: 'The end date must be after the start date.' };
  }

  const { data, error } = await supabase
    .from('academic_years')
    .insert({ name, starts_on: startsOn, ends_on: endsOn, is_active: true })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to create the academic year.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'academic_year',
    entityId: data?.id ?? null,
    metadata: { name },
  });

  revalidateAcademic();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Semesters
// ---------------------------------------------------------------------------

export async function createSemester(input: {
  academicYearId: string;
  name: string;
  startsOn: string;
  endsOn: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const academicYearId = text(input?.academicYearId);
  const name = text(input?.name);
  const startsOn = text(input?.startsOn);
  const endsOn = text(input?.endsOn);

  if (!UUID_RE.test(academicYearId)) return { error: 'Select an academic year.' };
  if (name.length < 2 || name.length > 60) return { error: 'Name must be 2-60 characters.' };
  if (!ISO_DATE_RE.test(startsOn) || !ISO_DATE_RE.test(endsOn)) {
    return { error: 'Start and end dates are required.' };
  }
  if (endsOn <= startsOn) return { error: 'The end date must be after the start date.' };

  const { data, error } = await supabase
    .from('semesters')
    .insert({ academic_year_id: academicYearId, name, starts_on: startsOn, ends_on: endsOn, is_active: true })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to create the semester.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'semester',
    entityId: data?.id ?? null,
    metadata: { name, academic_year_id: academicYearId },
  });

  revalidateAcademic();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export async function createProgram(input: { code: string; name: string }): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const code = text(input?.code).toUpperCase();
  const name = text(input?.name);

  if (!/^[A-Z0-9-]{2,10}$/.test(code)) {
    return { error: 'Code must be 2-10 letters, numbers, or hyphens.' };
  }
  if (name.length < 2 || name.length > 120) return { error: 'Name must be 2-120 characters.' };

  const { data, error } = await supabase
    .from('programs')
    .insert({ code, name, is_active: true })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to create the program.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'program',
    entityId: data?.id ?? null,
    metadata: { code, name },
  });

  revalidateAcademic();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Year levels
// ---------------------------------------------------------------------------

export async function createYearLevel(input: { name: string; sortOrder: number }): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const name = text(input?.name);
  const sortOrder = Number(input?.sortOrder);

  if (name.length < 2 || name.length > 40) return { error: 'Name must be 2-40 characters.' };
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 99) {
    return { error: 'Sort order must be a whole number between 0 and 99.' };
  }

  const { data, error } = await supabase
    .from('year_levels')
    .insert({ name, sort_order: sortOrder })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to create the year level.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'year_level',
    entityId: data?.id ?? null,
    metadata: { name, sort_order: sortOrder },
  });

  revalidateAcademic();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export async function createSection(input: {
  programId: string;
  yearLevelId: string;
  name: string;
}): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  const programId = text(input?.programId);
  const yearLevelId = text(input?.yearLevelId);
  const name = text(input?.name);

  if (!UUID_RE.test(programId)) return { error: 'Select a program.' };
  if (!UUID_RE.test(yearLevelId)) return { error: 'Select a year level.' };
  if (!/^[A-Za-z0-9-]{1,20}$/.test(name)) {
    return { error: 'Section name must be 1-20 letters, numbers, or hyphens.' };
  }

  const { data, error } = await supabase
    .from('sections')
    .insert({ program_id: programId, year_level_id: yearLevelId, name, is_active: true })
    .select('id')
    .single();

  if (error) return { error: friendlyError(error.message, 'Failed to create the section.') };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'section',
    entityId: data?.id ?? null,
    metadata: { name, program_id: programId, year_level_id: yearLevelId },
  });

  revalidateAcademic();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Activate / deactivate
// ---------------------------------------------------------------------------

export async function setAcademicActive(
  entity: string,
  id: string,
  isActive: boolean
): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  if (!isToggleable(entity)) return { error: 'This record type cannot be activated or deactivated.' };
  if (!UUID_RE.test(text(id))) return { error: 'Invalid record id.' };
  if (typeof isActive !== 'boolean') return { error: 'Invalid state.' };

  // RLS makes an unauthorized UPDATE affect 0 rows rather than error, so the
  // affected row is read back to distinguish success from a silent no-op.
  const { data, error } = await supabase
    .from(TOGGLEABLE[entity])
    .update({ is_active: isActive })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) return { error: friendlyError(error.message, 'Failed to update the record.') };
  if (!data) return { error: 'That record no longer exists or you cannot modify it.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'update',
    entityType: entity,
    entityId: id,
    metadata: { is_active: isActive },
  });

  revalidateAcademic();
  return { success: true };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteAcademicEntity(entity: string, id: string): Promise<ActionResult> {
  const { supabase, userId } = await requireAdminUser();

  if (!isDeletable(entity)) return { error: 'This record type cannot be deleted.' };
  if (!UUID_RE.test(text(id))) return { error: 'Invalid record id.' };

  const { data, error } = await supabase
    .from(DELETABLE[entity])
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return {
      error: friendlyError(
        error.message,
        'This record is still in use and cannot be deleted. Deactivate it instead.'
      ),
    };
  }
  if (!data) return { error: 'That record no longer exists or you cannot delete it.' };

  await recordAuditLog({
    actorUserId: userId,
    action: 'delete',
    entityType: entity,
    entityId: id,
  });

  revalidateAcademic();
  return { success: true };
}
