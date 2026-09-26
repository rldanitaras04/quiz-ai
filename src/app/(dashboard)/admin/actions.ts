'use server';

import { redirect } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
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
  /** Rows per page (admin-configurable) so the client can render pagination. */
  pageSize: number;
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
  filters?: { action?: AuditAction; entityType?: string; page?: number }
): Promise<AuditLogsResult> {
  const { supabase } = await requireAdminUser();

  // The row cap is administrator-configurable (/admin/settings): a busy log must
  // not ship every entry to the browser, but the operator decides how many of
  // the most recent ones they want. `totalCount` still reports the full match.
  const { default_page_size } = await getSettings();
  const pageSize = default_page_size;
  const page = Math.max(1, Math.floor(filters?.page ?? 1));

  let query = supabase
    .from('audit_logs')
    .select(`
      id, actor_user_id, action, entity_type, entity_id, metadata, created_at,
      actor:profiles!audit_logs_actor_user_id_fkey(email, full_name)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

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

  return { logs, totalCount: count ?? 0, pageSize };
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

// ============================================================================
// Dashboard
// ============================================================================

/** Real counts behind the dashboard summary cards; null = unavailable. */
export interface AdminStatCard {
  key: 'totalUsers' | 'totalSubjects' | 'totalAssessments' | 'completedExams';
  label: string;
  value: number | null;
  /** Change vs. last month in percent; null when last month had no data. */
  deltaPct: number | null;
  /** Honest fallback note (e.g. "+3 this month") when deltaPct is null. */
  deltaNote: string | null;
  /** One entry per month for the last 6 months (oldest first); null = unavailable. */
  series: number[] | null;
}

export interface AdminRoleSegment {
  label: string;
  value: number;
}

export interface AdminTrendsData {
  labels: string[];
  assessmentsCreated: number[];
  examsConducted: number[];
  averageScore: Array<number | null>;
}

export interface AdminTopSubject {
  code: string;
  title: string;
  assessmentCount: number;
}

export interface AdminRecentExam {
  id: string;
  title: string;
  subject: string;
  status: string;
  opensAt: string;
}

export interface AdminRecentActivity {
  id: string;
  action: string;
  entityType: string;
  actorName: string | null;
  createdAt: string;
}

export interface AdminPlatformUsage {
  questionsInBank: number | null;
  activeSections: number | null;
  activeOfferings: number | null;
  aiCalls: number | null;
}

export interface AdminSystemHealth {
  database: 'operational' | 'unavailable';
  authentication: 'operational' | 'unavailable';
  aiConfigured: boolean;
}

export interface AdminDashboardData {
  statCards: AdminStatCard[];
  totalUsers: number | null;
  userDistribution: AdminRoleSegment[];
  trends: AdminTrendsData | null;
  topSubjects: AdminTopSubject[] | null;
  recentExams: AdminRecentExam[] | null;
  recentActivity: AdminRecentActivity[] | null;
  platformUsage: AdminPlatformUsage;
  health: AdminSystemHealth;
}

const ROLE_PRIORITY: Record<string, number> = { super_admin: 0, faculty: 1, student: 2 };

const ROLE_DISTRIBUTION_LABELS: Record<string, string> = {
  student: 'Students',
  faculty: 'Faculty',
  super_admin: 'Super Admins',
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function countOr(
  supabase: SupabaseClient,
  table: string,
  options?: { column?: string; value?: string; gte?: string }
): Promise<number | null> {
  let query = supabase.from(table).select('id', { count: 'exact', head: true });
  if (options?.column && options.value !== undefined) {
    query = query.eq(options.column, options.value);
  }
  if (options?.gte) {
    query = query.gte('created_at', options.gte);
  }
  const { count, error } = await query;
  return error ? null : count ?? 0;
}

/**
 * One aggregated read for the Super Admin dashboard. Every figure is derived
 * from real tables; a section whose query fails comes back null so the UI can
 * show an unavailable state instead of a fabricated number.
 *
 * `assessments`, `assessment_deployments`, `exam_attempts` and
 * `assessment_results` carry only faculty/student RLS policies, so a super
 * admin would silently read zero rows through the session client — those four
 * reads run on the service-role client AFTER requireAdminUser() has verified
 * the caller. Server-side only; never shipped to the browser.
 */
export async function getAdminDashboardData(): Promise<AdminDashboardData> {
  const { supabase } = await requireAdminUser();
  const examDb = createAdminClient();

  const now = new Date();
  const sixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const trendsStartIso = sixMonthsStart.toISOString();

  const labels: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(sixMonthsStart.getFullYear(), sixMonthsStart.getMonth() + i, 1);
    labels.push(MONTH_SHORT[d.getMonth()]);
  }

  const [
    totalUsers,
    usersSeriesResult,
    totalSubjects,
    subjectsSeriesResult,
    totalAssessments,
    assessmentsSeriesResult,
    completedExams,
    resultsSeriesResult,
    deploymentsSeriesResult,
    rolesResult,
    topSubjectsResult,
    deploymentsResult,
    activityResult,
    questionsCount,
    activeSections,
    activeOfferings,
    aiCalls,
  ] = await Promise.all([
    countOr(supabase, 'profiles'),
    supabase.from('profiles').select('created_at').gte('created_at', trendsStartIso).limit(20000),
    countOr(supabase, 'subjects'),
    supabase.from('subjects').select('created_at').gte('created_at', trendsStartIso).limit(20000),
    countOr(examDb, 'assessments'),
    examDb.from('assessments').select('created_at').gte('created_at', trendsStartIso).limit(20000),
    countOr(examDb, 'assessment_results'),
    examDb
      .from('assessment_results')
      .select('percentage, created_at')
      .gte('created_at', trendsStartIso)
      .limit(20000),
    examDb
      .from('assessment_deployments')
      .select('opens_at')
      .gte('opens_at', trendsStartIso)
      .limit(20000),
    supabase.from('user_roles').select('user_id, role'),
    examDb
      .from('assessments')
      .select('subject_offering_id, subject_offerings(subject_id, subjects(code, title))'),
    examDb
      .from('assessment_deployments')
      .select('id, status, opens_at, assessments(title), subject_offerings(subjects(code))')
      .order('opens_at', { ascending: false })
      .limit(5),
    supabase
      .from('audit_logs')
      .select('id, action, entity_type, created_at, actor:profiles!audit_logs_actor_user_id_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(6),
    countOr(supabase, 'question_bank'),
    countOr(supabase, 'sections', { column: 'is_active', value: 'true' }),
    countOr(supabase, 'subject_offerings', { column: 'status', value: 'active' }),
    countOr(supabase, 'ai_usage_logs'),
  ]);

  // --- Month bucketing helpers ---------------------------------------------
  const bucketFor = (iso: string): number => {
    const d = new Date(iso);
    return (d.getFullYear() - sixMonthsStart.getFullYear()) * 12 + (d.getMonth() - sixMonthsStart.getMonth());
  };

  const countSeries = (
    result: { data: Array<Record<string, unknown>> | null; error: unknown },
    field: string
  ): number[] | null => {
    if (result.error) return null;
    const buckets = new Array(6).fill(0) as number[];
    for (const row of result.data ?? []) {
      const iso = row[field];
      if (typeof iso !== 'string') continue;
      const index = bucketFor(iso);
      if (index >= 0 && index < 6) buckets[index] += 1;
    }
    return buckets;
  };

  const monthDelta = (
    series: number[] | null
  ): { deltaPct: number | null; deltaNote: string | null } => {
    if (!series) return { deltaPct: null, deltaNote: null };
    const lastMonth = series[4];
    const thisMonth = series[5];
    if (lastMonth > 0) {
      return { deltaPct: Math.round(((thisMonth - lastMonth) / lastMonth) * 100), deltaNote: null };
    }
    if (thisMonth > 0) return { deltaPct: null, deltaNote: `+${thisMonth} this month` };
    return { deltaPct: 0, deltaNote: null };
  };

  // --- Summary cards -------------------------------------------------------
  const usersSeries = countSeries(usersSeriesResult, 'created_at');
  const subjectsSeries = countSeries(subjectsSeriesResult, 'created_at');
  const assessmentsSeries = countSeries(assessmentsSeriesResult, 'created_at');
  const completedExamsSeries = countSeries(resultsSeriesResult, 'created_at');

  const statCards: AdminStatCard[] = [
    {
      key: 'totalUsers',
      label: 'Total Users',
      value: totalUsers,
      series: usersSeries,
      ...monthDelta(usersSeries),
    },
    {
      key: 'totalSubjects',
      label: 'Total Subjects',
      value: totalSubjects,
      series: subjectsSeries,
      ...monthDelta(subjectsSeries),
    },
    {
      key: 'totalAssessments',
      label: 'Total Assessments',
      value: totalAssessments,
      series: assessmentsSeries,
      ...monthDelta(assessmentsSeries),
    },
    {
      key: 'completedExams',
      label: 'Completed Exams',
      value: completedExams,
      series: completedExamsSeries,
      ...monthDelta(completedExamsSeries),
    },
  ];

  // --- User distribution (one primary role per user) -----------------------
  const primaryRoleByUser = new Map<string, string>();
  if (!rolesResult.error && rolesResult.data) {
    for (const row of rolesResult.data) {
      const current = primaryRoleByUser.get(row.user_id);
      if (!current || (ROLE_PRIORITY[row.role] ?? 9) < (ROLE_PRIORITY[current] ?? 9)) {
        primaryRoleByUser.set(row.user_id, row.role);
      }
    }
  }
  const roleCounts = new Map<string, number>();
  for (const role of primaryRoleByUser.values()) {
    roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
  }
  const countedUsers = primaryRoleByUser.size;
  const roleless = totalUsers != null ? Math.max(totalUsers - countedUsers, 0) : 0;

  const userDistribution: AdminRoleSegment[] = [];
  if (!rolesResult.error) {
    for (const [role, count] of roleCounts) {
      userDistribution.push({ label: ROLE_DISTRIBUTION_LABELS[role] ?? role, value: count });
    }
    if (roleless > 0) {
      userDistribution.push({ label: 'No Role Assigned', value: roleless });
    }
    userDistribution.sort((a, b) => b.value - a.value);
  }

  // --- Six-month trends ----------------------------------------------------
  let trends: AdminTrendsData | null = null;
  if (
    !assessmentsSeriesResult.error &&
    !deploymentsSeriesResult.error &&
    !resultsSeriesResult.error
  ) {
    const assessmentsCreated = countSeries(assessmentsSeriesResult, 'created_at') ?? [];
    const examsConducted = countSeries(deploymentsSeriesResult, 'opens_at') ?? [];

    const scoreSums = new Array(6).fill(0) as number[];
    const scoreCounts = new Array(6).fill(0) as number[];
    for (const row of resultsSeriesResult.data ?? []) {
      const index = bucketFor(String(row.created_at ?? ''));
      const pct = Number(row.percentage);
      if (index >= 0 && index < 6 && Number.isFinite(pct)) {
        scoreSums[index] += pct;
        scoreCounts[index] += 1;
      }
    }
    const averageScore = scoreCounts.map((count, i) =>
      count > 0 ? Math.round((scoreSums[i] / count) * 10) / 10 : null
    );

    trends = {
      labels,
      assessmentsCreated,
      examsConducted,
      averageScore,
    };
  }

  // --- Top subjects by assessment count ------------------------------------
  let topSubjects: AdminTopSubject[] | null = null;
  if (!topSubjectsResult.error) {
    const bySubject = new Map<string, AdminTopSubject>();
    for (const row of topSubjectsResult.data ?? []) {
      const rawOffering = row.subject_offerings as
        | { subject_id?: string; subjects?: { code?: string; title?: string } | Array<{ code?: string; title?: string }> }
        | Array<{ subject_id?: string; subjects?: { code?: string; title?: string } | Array<{ code?: string; title?: string }> }>
        | null;
      const offering = Array.isArray(rawOffering) ? rawOffering[0] : rawOffering;
      if (!offering) continue;
      const rawSubject = offering.subjects as { code?: string; title?: string } | Array<{ code?: string; title?: string }> | undefined;
      const subject = Array.isArray(rawSubject) ? rawSubject[0] : rawSubject;
      if (!subject) continue;
      const key = offering.subject_id ?? `${subject.code ?? ''}`;
      const entry = bySubject.get(key) ?? {
        code: subject.code ?? '—',
        title: subject.title ?? 'Untitled subject',
        assessmentCount: 0,
      };
      entry.assessmentCount += 1;
      bySubject.set(key, entry);
    }
    topSubjects = [...bySubject.values()]
      .sort((a, b) => b.assessmentCount - a.assessmentCount)
      .slice(0, 5);
  }

  // --- Recent exams (deployments) ------------------------------------------
  let recentExams: AdminRecentExam[] | null = null;
  if (!deploymentsResult.error) {
    recentExams = (deploymentsResult.data ?? []).map((row) => {
      const rawAssessment = row.assessments as { title?: string } | Array<{ title?: string }> | null;
      const assessment = Array.isArray(rawAssessment) ? rawAssessment[0] : rawAssessment;
      const rawOffering = row.subject_offerings as
        | { subjects?: { code?: string } | Array<{ code?: string }> }
        | Array<{ subjects?: { code?: string } | Array<{ code?: string }> }>
        | null;
      const offering = Array.isArray(rawOffering) ? rawOffering[0] : rawOffering;
      const rawSubject = offering?.subjects as { code?: string } | Array<{ code?: string }> | undefined;
      const subject = Array.isArray(rawSubject) ? rawSubject[0] : rawSubject;
      return {
        id: row.id,
        title: assessment?.title ?? 'Untitled assessment',
        subject: subject?.code ?? '—',
        status: row.status,
        opensAt: row.opens_at,
      };
    });
  }

  // --- Recent administrative activity --------------------------------------
  let recentActivity: AdminRecentActivity[] | null = null;
  if (!activityResult.error) {
    recentActivity = (activityResult.data ?? []).map((row) => {
      const actor = Array.isArray(row.actor) ? row.actor[0] : row.actor;
      return {
        id: row.id,
        action: row.action,
        entityType: row.entity_type,
        actorName: actor?.full_name ?? null,
        createdAt: row.created_at,
      };
    });
  }

  const platformUsage: AdminPlatformUsage = {
    questionsInBank: questionsCount,
    activeSections,
    activeOfferings,
    aiCalls,
  };

  const health: AdminSystemHealth = {
    // requireAdminUser() only returns after session + role checks succeed.
    authentication: 'operational',
    database: totalUsers != null ? 'operational' : 'unavailable',
    aiConfigured: Boolean(
      process.env.OPENAI_API_KEY || process.env.GROQ_API_KEY || process.env.HUGGINGFACE_API_KEY
    ),
  };

  return {
    statCards,
    totalUsers,
    userDistribution,
    trends,
    topSubjects,
    recentExams,
    recentActivity,
    platformUsage,
    health,
  };
}

// ============================================================================
// AI usage telemetry
// ============================================================================

export interface AiUsageSummary {
  totalCalls: number | null;
  success: number | null;
  errors: number | null;
  timeouts: number | null;
  totalTokens: number | null;
  avgDurationMs: number | null;
  /** True when aggregates were computed from the capped row window. */
  windowLimited: boolean;
}

export interface AiUsageBreakdownRow {
  key: string;
  calls: number;
  success: number;
  tokens: number;
  avgDurationMs: number | null;
}

export interface AiUsageRecentRow {
  id: string;
  createdAt: string;
  provider: string;
  model: string;
  operation: string;
  status: string;
  durationMs: number | null;
  errorCode: string | null;
  tokens: number;
  email: string | null;
}

export interface AiUsageTelemetry {
  summary: AiUsageSummary;
  byProvider: AiUsageBreakdownRow[];
  byOperation: AiUsageBreakdownRow[];
  recent: AiUsageRecentRow[] | null;
}

const AI_USAGE_WINDOW = 20000;

interface AiUsageAggRow {
  provider: string | null;
  model: string | null;
  operation: string | null;
  status: string;
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * Real AI usage telemetry from `ai_usage_logs` (the admin has a read policy).
 * Totals come from exact count queries; token/duration aggregates are computed
 * over the most recent window of rows and flagged when that window was hit.
 */
export async function getAiUsageTelemetry(): Promise<AiUsageTelemetry> {
  const { supabase } = await requireAdminUser();

  const [totalResult, successResult, errorResult, timeoutResult, rowsResult, recentResult] =
    await Promise.all([
      countOr(supabase, 'ai_usage_logs'),
      countOr(supabase, 'ai_usage_logs', { column: 'status', value: 'success' }),
      countOr(supabase, 'ai_usage_logs', { column: 'status', value: 'error' }),
      countOr(supabase, 'ai_usage_logs', { column: 'status', value: 'timeout' }),
      supabase
        .from('ai_usage_logs')
        .select('provider, model, operation, status, input_tokens, output_tokens, duration_ms, created_at')
        .order('created_at', { ascending: false })
        .limit(AI_USAGE_WINDOW),
      supabase
        .from('ai_usage_logs')
        .select(
          'id, created_at, provider, model, operation, status, duration_ms, error_code, input_tokens, output_tokens, profiles(email)'
        )
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

  const rows: AiUsageAggRow[] | null = rowsResult.error
    ? null
    : ((rowsResult.data ?? []) as AiUsageAggRow[]);
  const windowLimited = rows !== null && rows.length >= AI_USAGE_WINDOW;

  let totalTokens: number | null = null;
  let avgDurationMs: number | null = null;
  let byProvider: AiUsageBreakdownRow[] = [];
  let byOperation: AiUsageBreakdownRow[] = [];

  if (rows) {
    const group = (keyOf: (row: AiUsageAggRow) => string): AiUsageBreakdownRow[] => {
      const groups = new Map<
        string,
        { calls: number; success: number; tokens: number; durationSum: number; durationCount: number }
      >();
      let tokenSum = 0;
      let durationSum = 0;
      let durationCount = 0;

      for (const row of rows) {
        const key = keyOf(row);
        const entry = groups.get(key) ?? { calls: 0, success: 0, tokens: 0, durationSum: 0, durationCount: 0 };
        const tokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
        entry.calls += 1;
        if (row.status === 'success') entry.success += 1;
        entry.tokens += tokens;
        if (typeof row.duration_ms === 'number') {
          entry.durationSum += row.duration_ms;
          entry.durationCount += 1;
        }
        groups.set(key, entry);
        tokenSum += tokens;
        if (typeof row.duration_ms === 'number') {
          durationSum += row.duration_ms;
          durationCount += 1;
        }
      }

      totalTokens = tokenSum;
      avgDurationMs = durationCount > 0 ? Math.round(durationSum / durationCount) : null;

      return [...groups.entries()]
        .map(([key, entry]) => ({
          key,
          calls: entry.calls,
          success: entry.success,
          tokens: entry.tokens,
          avgDurationMs:
            entry.durationCount > 0 ? Math.round(entry.durationSum / entry.durationCount) : null,
        }))
        .sort((a, b) => b.calls - a.calls);
    };

    byProvider = group((row) => row.provider ?? 'unknown');
    byOperation = group((row) => row.operation ?? 'unknown');
  }

  let recent: AiUsageRecentRow[] | null = null;
  if (!recentResult.error) {
    recent = (recentResult.data ?? []).map((row) => {
      const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return {
        id: row.id,
        createdAt: row.created_at,
        provider: row.provider,
        model: row.model,
        operation: row.operation,
        status: row.status,
        durationMs: row.duration_ms,
        errorCode: row.error_code,
        tokens: (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
        email: (profile as { email?: string } | null)?.email ?? null,
      };
    });
  }

  return {
    summary: {
      totalCalls: totalResult,
      success: successResult,
      errors: errorResult,
      timeouts: timeoutResult,
      totalTokens,
      avgDurationMs,
      windowLimited,
    },
    byProvider,
    byOperation,
    recent,
  };
}

