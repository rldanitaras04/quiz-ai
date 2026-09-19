'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { AuditAction } from '@/lib/types';

export interface UserWithRoles {
  id: string;
  email: string;
  full_name: string;
  status: string;
  created_at: string;
  roles: string[];
}

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

export interface SubjectWithOfferings {
  id: string;
  code: string;
  title: string;
  description: string | null;
  is_active: boolean;
  offerings: Array<{
    id: string;
    status: string;
    semester: string;
    academicYear: string;
    program: string;
    yearLevel: string;
    section: string;
    enrolledCount: number;
  }>;
}

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

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const isAdmin = roles?.some((r) => r.role === 'super_admin');
  if (!isAdmin) redirect('/');

  return supabase;
}

export async function getUsers(): Promise<UserWithRoles[]> {
  const supabase = await requireAdmin();

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, email, full_name, status, created_at')
    .order('created_at', { ascending: false });

  if (!profiles) return [];

  const userIds = profiles.map((p) => p.id);

  const { data: userRoles } = await supabase
    .from('user_roles')
    .select('user_id, role')
    .in('user_id', userIds);

  const rolesByUser = new Map<string, string[]>();
  for (const ur of userRoles ?? []) {
    const existing = rolesByUser.get(ur.user_id) ?? [];
    existing.push(ur.role);
    rolesByUser.set(ur.user_id, existing);
  }

  return profiles.map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    status: p.status,
    created_at: p.created_at,
    roles: rolesByUser.get(p.id) ?? [],
  }));
}

export async function getAcademicStructure(): Promise<AcademicStructure> {
  const supabase = await requireAdmin();

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

  const sectionsByProgramYear = new Map<string, Record<string, unknown>[]>();
  for (const sec of sectionsResult.data ?? []) {
    const key = `${sec.program_id}-${sec.year_level_id}`;
    const existing = sectionsByProgramYear.get(key) ?? [];
    existing.push(sec);
    sectionsByProgramYear.set(key, existing);
  }

  const yearLevelsByProgram = new Map<string, Record<string, unknown>[]>();
  for (const yl of yearLevelsResult.data ?? []) {
    const sections = sectionsByProgramYear.get(yl.id) ?? [];
    const existing = yearLevelsByProgram.get(yl.program_id) ?? [];
    existing.push({ ...yl, sections });
    yearLevelsByProgram.set(yl.program_id, existing);
  }

  const academicYears = (yearsResult.data ?? []).map((year) => ({
    id: year.id,
    name: year.name,
    starts_on: year.starts_on,
    ends_on: year.ends_on,
    is_active: year.is_active,
    semesters: semestersByYear.get(year.id) ?? [],
  }));

  const programs = (programsResult.data ?? []).map((program) => ({
    id: program.id,
    code: program.code,
    name: program.name,
    is_active: program.is_active,
    yearLevels: yearLevelsByProgram.get(program.id) ?? [],
  }));

  return { academicYears, programs } as AcademicStructure;
}

export async function getSubjects(): Promise<SubjectWithOfferings[]> {
  const supabase = await requireAdmin();

  const { data: subjects } = await supabase
    .from('subjects')
    .select('*')
    .order('code', { ascending: true });

  if (!subjects) return [];

  const { data: offerings } = await supabase
    .from('subject_offerings')
    .select(`
      id, subject_id, status,
      semester:semesters(name, academic_year:academic_years(name)),
      program:programs(name),
      year_level:year_levels(name),
      section:sections(name)
    `);

  const { data: enrollments } = await supabase
    .from('enrollments')
    .select('subject_offering_id, id')
    .eq('status', 'enrolled');

  const enrollmentsByOffering = new Map<string, number>();
  for (const e of enrollments ?? []) {
    const count = enrollmentsByOffering.get(e.subject_offering_id) ?? 0;
    enrollmentsByOffering.set(e.subject_offering_id, count + 1);
  }

  const offeringsBySubject = new Map<string, Record<string, unknown>[]>();
  for (const o of offerings ?? []) {
    const raw = o as Record<string, unknown>;
    const sem = Array.isArray(raw.semester) ? raw.semester[0] : raw.semester;
    const ay = sem && Array.isArray(sem.academic_year) ? sem.academic_year[0] : sem?.academic_year;
    const prog = Array.isArray(raw.program) ? raw.program[0] : raw.program;
    const yl = Array.isArray(raw.year_level) ? raw.year_level[0] : raw.year_level;
    const sec = Array.isArray(raw.section) ? raw.section[0] : raw.section;

    const existing = offeringsBySubject.get(o.subject_id) ?? [];
    existing.push({
      id: o.id,
      status: o.status,
      semester: sem?.name ?? '—',
      academicYear: ay?.name ?? '—',
      program: prog?.name ?? '—',
      yearLevel: yl?.name ?? '—',
      section: sec?.name ?? '—',
      enrolledCount: enrollmentsByOffering.get(o.id) ?? 0,
    });
    offeringsBySubject.set(o.subject_id, existing);
  }

  return subjects.map((s) => ({
    id: s.id,
    code: s.code,
    title: s.title,
    description: s.description,
    is_active: s.is_active,
    offerings: offeringsBySubject.get(s.id) ?? [],
  })) as SubjectWithOfferings[];
}

export async function getAuditLogs(
  filters?: { action?: AuditAction; entityType?: string }
): Promise<AuditLogsResult> {
  const supabase = await requireAdmin();

  let query = supabase
    .from('audit_logs')
    .select(`
      id, actor_user_id, action, entity_type, entity_id, metadata, created_at,
      actor:profiles!audit_logs_actor_user_id_fkey(email, full_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .limit(100);

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
