'use server';

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getSettings } from '@/lib/settings';
import type { AuditAction } from '@/lib/types';

export interface AcademicStructure {
  academicYears: Array<{
    id: string;
    name: string;
    starts_on: string;
    ends_on: string;
    is_active: boolean;
    semesters: Array<{
      id: string;
      name: string;
      starts_on: string;
      ends_on: string;
      is_active: boolean;
    }>;
  }>;
  programs: Array<{
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    yearLevels: Array<{
      id: string;
      name: string;
      sections: Array<{
        id: string;
        name: string;
        is_active: boolean;
      }>;
    }>;
  }>;
}

/** Shared result shape for the admin CRUD server actions. */
export type ActionResult = { success: true } | { error: string };

export interface AuditLogEntry {
  id: string;
  actor_email: string | null;
  actor_name: string | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogsResult {
  logs: AuditLogEntry[];
  totalCount: number;
}

/**
 * Authorizes the caller as a super_admin from trusted session state — never
 * from client input — and hands back the session-scoped client plus the actor
 * id. The returned client is deliberately NOT service-role: every admin write
 * still has to satisfy the `Admin can manage ...` RLS policies.
 */
export async function requireAdminUser(): Promise<{
  supabase: SupabaseClient;
  userId: string;
}> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const isAdmin = roles?.some((r) => r.role === 'super_admin');
  if (!isAdmin) redirect('/');

  return { supabase, userId: user.id };
}

export async function getAcademicStructure(): Promise<AcademicStructure> {
  const { supabase } = await requireAdminUser();

  const [yearsResult, semestersResult, programsResult, yearLevelsResult, sectionsResult] =
    await Promise.all([
      supabase
        .from('academic_years')
        .select('*')
        .order('starts_on', { ascending: false }),
      supabase.from('semesters').select('*'),
      supabase
        .from('programs')
        .select('*')
        .order('code', { ascending: true }),
      supabase.from('year_levels').select('*').order('sort_order', { ascending: true }),
      supabase.from('sections').select('*'),
    ]);

  const semestersByYear = new Map<string, Record<string, unknown>[]>();
  for (const s of semestersResult.data ?? []) {
    const existing = semestersByYear.get(s.academic_year_id) ?? [];
    existing.push(s);
    semestersByYear.set(s.academic_year_id, existing);
  }

  // sections are keyed (program_id, year_level_id) — a section always belongs
  // to one program *and* one year level.
  const sectionsByProgramYear = new Map<string, Record<string, unknown>[]>();
  for (const sec of sectionsResult.data ?? []) {
    const key = `${sec.program_id}-${sec.year_level_id}`;
    const existing = sectionsByProgramYear.get(key) ?? [];
    existing.push(sec);
    sectionsByProgramYear.set(key, existing);
  }

  // year_levels are GLOBAL (the table has no program_id) — '1st Year' is not
  // owned by a program. So every program is listed against every year level,
  // and each pairing carries whichever sections exist for that combination.
  const allYearLevels = yearLevelsResult.data ?? [];

  const academicYears = (yearsResult.data ?? []).map((year) => ({
    id: year.id,
    name: year.name,
    starts_on: year.starts_on,
    ends_on: year.ends_on,
    is_active: year.is_active,
    semesters: (semestersByYear.get(year.id) ?? []).sort(
      (a, b) => String(a.starts_on).localeCompare(String(b.starts_on))
    ),
  }));

  const programs = (programsResult.data ?? []).map((program) => ({
    id: program.id,
    code: program.code,
    name: program.name,
    is_active: program.is_active,
    yearLevels: allYearLevels.map((yl) => ({
      id: yl.id,
      name: yl.name,
      sections: (sectionsByProgramYear.get(`${program.id}-${yl.id}`) ?? []).sort(
        (a, b) => String(a.name).localeCompare(String(b.name))
      ),
    })),
  }));

  return { academicYears, programs } as AcademicStructure;
}

export async function getAuditLogs(
  filters?: { action?: AuditAction; entityType?: string }
): Promise<AuditLogsResult> {
  const { supabase } = await requireAdminUser();

  // The row cap is administrator-configurable (/admin/settings): a busy log must
  // not ship every entry to the browser, but the operator decides how many of
  // the most recent ones they want. `totalCount` still reports the full match.
  const { default_page_size } = await getSettings();

  let query = supabase
    .from('audit_logs')
    .select(`
      id, actor_user_id, action, entity_type, entity_id, metadata, created_at,
      actor:profiles!audit_logs_actor_user_id_fkey(email, full_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(default_page_size);

  if (filters?.action) {
    query = query.eq('action', filters.action);
  }
  if (filters?.entityType) {
    query = query.eq('entity_type', filters.entityType);
  }

  const { data, count } = await query;

  const logs: AuditLogEntry[] = (data ?? []).map((log) => {
    const actor = Array.isArray(log.actor) ? log.actor[0] as Record<string, unknown> | undefined : log.actor as Record<string, unknown> | undefined;
    return {
      id: log.id,
      actor_email: (actor?.email as string) ?? null,
      actor_name: (actor?.full_name as string) ?? null,
      action: log.action,
      entity_type: log.entity_type,
      entity_id: log.entity_id,
      metadata: log.metadata,
      created_at: log.created_at,
    };
  });

  return { logs, totalCount: count ?? 0 };
}

/**
 * Every option list the admin CRUD forms need, in one round trip.
 *
 * `faculty` is the set of users holding the faculty role — the candidates for
 * a faculty assignment on an offering.
 */
export interface AdminReferenceData {
  academicYears: Array<{ id: string; name: string; isActive: boolean }>;
  semesters: Array<{ id: string; name: string; academicYearName: string }>;
  programs: Array<{ id: string; code: string; name: string }>;
  yearLevels: Array<{ id: string; name: string }>;
  sections: Array<{ id: string; name: string; programId: string; yearLevelId: string }>;
  faculty: Array<{ id: string; fullName: string; email: string }>;
}

export async function getAdminReferenceData(): Promise<AdminReferenceData> {
  const { supabase } = await requireAdminUser();

  const [yearsResult, semestersResult, programsResult, yearLevelsResult, sectionsResult, rolesResult, profilesResult] =
    await Promise.all([
      supabase.from('academic_years').select('id, name, is_active').order('starts_on', { ascending: false }),
      supabase.from('semesters').select('id, name, starts_on, academic_year_id').order('starts_on', { ascending: true }),
      supabase.from('programs').select('id, code, name').order('code', { ascending: true }),
      supabase.from('year_levels').select('id, name, sort_order').order('sort_order', { ascending: true }),
      supabase.from('sections').select('id, name, program_id, year_level_id').order('name', { ascending: true }),
      supabase.from('user_roles').select('user_id, role').eq('role', 'faculty'),
      supabase.from('profiles').select('id, full_name, email, status'),
    ]);

  const yearNameById = new Map(
    (yearsResult.data ?? []).map((y) => [y.id, y.name] as const)
  );
  const profileById = new Map(
    (profilesResult.data ?? []).map((p) => [p.id, p] as const)
  );

  const faculty = (rolesResult.data ?? [])
    .map((r) => profileById.get(r.user_id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      id: p.id,
      fullName: p.full_name ?? '(no name)',
      email: p.email ?? '',
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return {
    academicYears: (yearsResult.data ?? []).map((y) => ({
      id: y.id,
      name: y.name,
      isActive: y.is_active,
    })),
    semesters: (semestersResult.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      academicYearName: yearNameById.get(s.academic_year_id) ?? '—',
    })),
    programs: (programsResult.data ?? []).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
    })),
    yearLevels: (yearLevelsResult.data ?? []).map((y) => ({ id: y.id, name: y.name })),
    sections: (sectionsResult.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      programId: s.program_id,
      yearLevelId: s.year_level_id,
    })),
    faculty,
  };
}

