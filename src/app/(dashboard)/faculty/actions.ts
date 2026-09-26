'use server';

import { requireRole } from '@/lib/auth';
import type { AdminTrendsData } from '@/app/(dashboard)/admin/actions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FacultySemesterOption {
  id: string;
  label: string;
  isActive: boolean;
}

export interface FacultyStatCard {
  key: 'subjects' | 'assessments' | 'students' | 'toCheck';
  label: string;
  value: number | null;
  caption: string | null;
  deltaPct: number | null;
  deltaNote: string | null;
  series: number[] | null;
}

export interface FacultyUpcomingItem {
  id: string;
  title: string;
  subjectLabel: string;
  offeringId: string;
  assessmentId: string;
  opensAt: string;
  closesAt: string;
  /** Derived from the window: 'active' (ongoing now) | 'scheduled'. */
  status: 'active' | 'scheduled';
}

export interface FacultyActivityItem {
  id: string;
  action: string;
  detail: string | null;
  createdAt: string;
}

export interface FacultyActionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
}

export interface FacultyDashboardData {
  hasAssignments: boolean;
  firstName: string | null;
  semesterOptions: FacultySemesterOption[];
  selectedSemesterId: string | null;
  rangeMonths: number;
  statCards: FacultyStatCard[];
  trends: AdminTrendsData | null;
  upcoming: FacultyUpcomingItem[] | null;
  recentActivity: FacultyActivityItem[] | null;
  actionItems: FacultyActionItem[];
}

interface OfferingRow {
  id: string;
  semester_id: string | null;
  section_id: string | null;
  status: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
  semester: {
    id: string;
    name: string;
    is_active: boolean | null;
    academic_year: { id: string; name: string } | null;
  } | null;
}

interface AssignmentRow {
  id: string;
  subject_offering: OfferingRow | null;
}

type QueryResult<T> = { data: T[] | null; error: unknown };
type CountResult = { data: null; error: unknown; count: number | null };
type QueryLike = { data: unknown; error: unknown };

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const VALID_RANGES = [3, 6, 12];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyStatCards(): FacultyStatCard[] {
  return [
    { key: 'subjects', label: 'My Subjects', value: null, caption: 'This semester', deltaPct: null, deltaNote: null, series: null },
    { key: 'assessments', label: 'Assessments Created', value: null, caption: null, deltaPct: null, deltaNote: null, series: null },
    { key: 'students', label: 'Total Students', value: null, caption: null, deltaPct: null, deltaNote: null, series: null },
    { key: 'toCheck', label: 'To Be Checked', value: null, caption: 'Awaiting release', deltaPct: null, deltaNote: null, series: null },
  ];
}

function emptyData(
  rangeMonths: number,
  hasAssignments: boolean,
  firstName: string | null
): FacultyDashboardData {
  return {
    hasAssignments,
    firstName,
    semesterOptions: [],
    selectedSemesterId: null,
    rangeMonths,
    statCards: emptyStatCards(),
    trends: null,
    upcoming: null,
    recentActivity: null,
    actionItems: [],
  };
}

function unwrap<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * One aggregated read for the Faculty dashboard. Every figure is derived from
 * real tables scoped to the signed-in faculty member's own subjects; a section
 * whose query fails comes back null so the UI shows an unavailable state
 * instead of a fabricated number. All reads run on the session client under
 * RLS — `assessment_results` included since 20260930000001 fixed its faculty
 * policy (which previously compared a deployment id against an offering id
 * and therefore matched nothing).
 */
export async function getFacultyDashboardData(params?: {
  semesterId?: string | null;
  rangeMonths?: number;
}): Promise<FacultyDashboardData> {
  const rangeMonths =
    params?.rangeMonths && VALID_RANGES.includes(params.rangeMonths) ? params.rangeMonths : 6;

  const gate = await requireRole(['faculty', 'super_admin']);
  if (gate.status === 'blocked') return emptyData(rangeMonths, false, null);

  const supabase = gate.supabase;

  // --- Caller profile + assignments ---------------------------------------
  const [profileResult, assignmentsResult] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', gate.user.id).single(),
    supabase
      .from('faculty_assignments')
      .select(
        `id, subject_offering:subject_offerings(
           id, semester_id, section_id, status,
           subject:subjects(id, code, title),
           section:sections(id, name),
           semester:semesters(id, name, is_active, academic_year:academic_years(id, name))
         )`
      )
      .eq('faculty_id', gate.user.id),
  ]);

  const fullName = String(
    (profileResult.data as { full_name?: string | null } | null)?.full_name ?? ''
  ).trim();
  const firstName = fullName ? fullName.split(/\s+/)[0] : (gate.user.email?.split('@')[0] ?? null);

  if (assignmentsResult.error) {
    // Unavailable, not empty: keep the dashboard shell and surface "—".
    return emptyData(rangeMonths, true, firstName);
  }

  const allRows = (assignmentsResult.data ?? []) as unknown as AssignmentRow[];
  const rows = allRows.filter((row) => row.subject_offering != null);
  if (rows.length === 0) return emptyData(rangeMonths, false, firstName);

  // --- Semester options + selection ---------------------------------------
  const optionMap = new Map<string, FacultySemesterOption>();
  for (const row of rows) {
    const semester = row.subject_offering!.semester;
    if (semester && !optionMap.has(semester.id)) {
      optionMap.set(semester.id, {
        id: semester.id,
        label: semester.academic_year
          ? `${semester.name} ${semester.academic_year.name}`
          : semester.name,
        isActive: Boolean(semester.is_active),
      });
    }
  }
  const semesterOptions = [...optionMap.values()].sort(
    (a, b) => Number(b.isActive) - Number(a.isActive) || a.label.localeCompare(b.label)
  );

  const requested = params?.semesterId;
  const selectedSemesterId =
    requested && optionMap.has(requested)
      ? requested
      : (semesterOptions.find((option) => option.isActive)?.id ??
        semesterOptions[0]?.id ??
        null);

  const ownOfferings = rows
    .map((row) => row.subject_offering!)
    .filter((offering) => selectedSemesterId == null || offering.semester_id === selectedSemesterId);

  const ownOfferingIds = [...new Set(ownOfferings.map((offering) => offering.id))];
  const subjectIds = [
    ...new Set(
      ownOfferings.map((offering) => offering.subject?.id).filter((id): id is string => Boolean(id))
    ),
  ];

  // Subject-level scope: every section of the caller's subjects in the
  // selected semester (assessments became subject-level in 20260929).
  let scopeOfferingIds = ownOfferingIds;
  let scopeSectionIds = ownOfferings
    .map((offering) => offering.section_id)
    .filter((id): id is string => Boolean(id));
  if (subjectIds.length > 0) {
    let scopeQuery = supabase
      .from('subject_offerings')
      .select('id, section_id')
      .in('subject_id', subjectIds);
    if (selectedSemesterId) scopeQuery = scopeQuery.eq('semester_id', selectedSemesterId);
    const { data: scopeRows, error: scopeError } = await scopeQuery;
    if (!scopeError && scopeRows) {
      const rowsTyped = scopeRows as unknown as Array<{ id: string; section_id: string | null }>;
      scopeOfferingIds = rowsTyped.map((row) => row.id);
      scopeSectionIds = rowsTyped
        .map((row) => row.section_id)
        .filter((id): id is string => Boolean(id));
    }
  }
  const sectionCount = new Set(scopeSectionIds).size;
  const hasScope = scopeOfferingIds.length > 0;

  // --- Trend window ---------------------------------------------------------
  const now = new Date();
  const nowIso = now.toISOString();
  const startMonth = new Date(now.getFullYear(), now.getMonth() - (rangeMonths - 1), 1);
  const startIso = startMonth.toISOString();

  const labels: string[] = [];
  for (let i = 0; i < rangeMonths; i += 1) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    labels.push(MONTH_SHORT[d.getMonth()]);
  }

  const bucketFor = (iso: string): number => {
    const d = new Date(iso);
    return (
      (d.getFullYear() - startMonth.getFullYear()) * 12 + (d.getMonth() - startMonth.getMonth())
    );
  };

  const countSeries = (result: QueryLike, field: string): number[] | null => {
    if (result.error) return null;
    const rows = (result.data as Array<Record<string, unknown>> | null) ?? [];
    const buckets = new Array(rangeMonths).fill(0) as number[];
    for (const row of rows) {
      const iso = row[field];
      if (typeof iso !== 'string') continue;
      const index = bucketFor(iso);
      if (index >= 0 && index < rangeMonths) buckets[index] += 1;
    }
    return buckets;
  };

  const monthDelta = (
    series: number[] | null
  ): { deltaPct: number | null; deltaNote: string | null } => {
    if (!series || series.length < 2) return { deltaPct: null, deltaNote: null };
    const previous = series[series.length - 2];
    const current = series[series.length - 1];
    if (previous > 0) {
      return { deltaPct: Math.round(((current - previous) / previous) * 100), deltaNote: null };
    }
    if (current > 0) return { deltaPct: null, deltaNote: `+${current} this month` };
    return { deltaPct: 0, deltaNote: null };
  };

  // --- Session-client reads (RLS-scoped to the caller's subjects) ----------
  const [
    enrollmentsRes,
    assessmentsCountRes,
    assessmentsSeriesRes,
    draftsRes,
    upcomingRes,
    deploymentsSeriesRes,
    deploymentIdsRes,
    attemptsRes,
    versionsRes,
    sourcesRes,
    jobsRes,
    failedJobsRes,
  ] = (await Promise.all([
    hasScope
      ? supabase
          .from('enrollments')
          .select('student_id')
          .in('subject_offering_id', scopeOfferingIds)
          .eq('status', 'enrolled')
          .limit(10000)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessments')
          .select('id', { count: 'exact', head: true })
          .in('subject_offering_id', scopeOfferingIds)
      : { data: null, error: null, count: 0 },
    hasScope
      ? supabase
          .from('assessments')
          .select('created_at')
          .in('subject_offering_id', scopeOfferingIds)
          .gte('created_at', startIso)
          .limit(5000)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessments')
          .select('id, subject_offering_id, title, created_at')
          .in('subject_offering_id', scopeOfferingIds)
          .eq('status', 'draft')
          .order('created_at', { ascending: false })
          .limit(500)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessment_deployments')
          .select(
            `id, assessment_id, subject_offering_id, opens_at, closes_at, status,
             assessments(title, subject_offerings(subject:subjects(code), section:sections(name)))`
          )
          .in('subject_offering_id', scopeOfferingIds)
          .in('status', ['scheduled', 'active'])
          .gte('closes_at', nowIso)
          .order('opens_at', { ascending: true })
          .limit(5)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessment_deployments')
          .select('opens_at')
          .in('subject_offering_id', scopeOfferingIds)
          .gte('opens_at', startIso)
          .limit(5000)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessment_deployments')
          .select('id')
          .in('subject_offering_id', scopeOfferingIds)
          .limit(5000)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('exam_attempts')
          .select(
            'id, submitted_at, assessment_deployments(assessment_id, subject_offering_id, assessments(title))'
          )
          .in('assessment_deployments.subject_offering_id', scopeOfferingIds)
          .not('submitted_at', 'is', null)
          .gte('submitted_at', startIso)
          .order('submitted_at', { ascending: false })
          .limit(10)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessment_versions')
          .select('id, published_at, assessments(title, subject_offering_id)')
          .in('assessments.subject_offering_id', scopeOfferingIds)
          .not('published_at', 'is', null)
          .gte('published_at', startIso)
          .eq('status', 'published')
          .order('published_at', { ascending: false })
          .limit(10)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('source_materials')
          .select('id, created_at, title')
          .in('subject_offering_id', scopeOfferingIds)
          .gte('created_at', startIso)
          .order('created_at', { ascending: false })
          .limit(10)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessment_generation_jobs')
          .select('id, created_at, status, assessments(title, subject_offering_id)')
          .in('assessments.subject_offering_id', scopeOfferingIds)
          .gte('created_at', startIso)
          .order('created_at', { ascending: false })
          .limit(20)
      : { data: [], error: null },
    hasScope
      ? supabase
          .from('assessment_generation_jobs')
          .select('id, created_at, assessments(id, subject_offering_id, title)')
          .in('assessments.subject_offering_id', scopeOfferingIds)
          .eq('status', 'failed')
          .order('created_at', { ascending: false })
          .limit(500)
      : { data: [], error: null },
  ])) as [
    QueryResult<{ student_id: string }>,
    CountResult,
    QueryResult<{ created_at: string }>,
    QueryResult<{ id: string; subject_offering_id: string; title: string; created_at: string }>,
    QueryResult<{
      id: string;
      assessment_id: string;
      subject_offering_id: string;
      opens_at: string;
      closes_at: string;
      status: string;
      assessments: unknown;
    }>,
    QueryResult<{ opens_at: string }>,
    QueryResult<{ id: string }>,
    QueryResult<{ id: string; submitted_at: string; assessment_deployments: unknown }>,
    QueryResult<{ id: string; published_at: string; assessments: unknown }>,
    QueryResult<{ id: string; created_at: string; title: string }>,
    QueryResult<{ id: string; created_at: string; status: string; assessments: unknown }>,
    QueryResult<{ id: string; created_at: string; assessments: unknown }>,
  ];

  const scopeDeploymentIds = (deploymentIdsRes.data ?? []).map((row) => row.id);

  // --- Results reads (RLS-scoped; deployment filter = semester scoping) -----
  let pendingCount: number | null = scopeDeploymentIds.length === 0 ? 0 : null;
  let pendingRows: Array<{ deployment_id: string; assessment_deployments: unknown }> = [];
  let releasedRows: Array<{ id: string; released_at: string; assessment_deployments: unknown }> =
    [];
  let scoreRows: Array<{ percentage: number | string; created_at: string }> = [];
  let scoreSeriesError = false;
  let releasedFeedError = false;

  if (scopeDeploymentIds.length > 0) {
    const idChunks = chunk(scopeDeploymentIds, 100);
    const perChunk = await Promise.all(
      idChunks.map(async (ids) => {
        // Chunked at 100 ids to keep the query string well under URL limits.
        const [countRes, pendingRes, releasedRes, scoreRes] = (await Promise.all([
          supabase
            .from('assessment_results')
            .select('id', { count: 'exact', head: true })
            .in('deployment_id', ids)
            .neq('status', 'released'),
          supabase
            .from('assessment_results')
            .select(
              'deployment_id, assessment_deployments(subject_offering_id, assessments(title))'
            )
            .in('deployment_id', ids)
            .neq('status', 'released')
            .limit(50),
          supabase
            .from('assessment_results')
            .select(
              'id, released_at, assessment_deployments(subject_offering_id, assessments(title))'
            )
            .in('deployment_id', ids)
            .not('released_at', 'is', null)
            .gte('released_at', startIso)
            .order('released_at', { ascending: false })
            .limit(10),
          supabase
            .from('assessment_results')
            .select('percentage, created_at')
            .in('deployment_id', ids)
            .gte('created_at', startIso)
            .limit(5000),
        ])) as [
          CountResult,
          QueryResult<(typeof pendingRows)[number]>,
          QueryResult<(typeof releasedRows)[number]>,
          QueryResult<(typeof scoreRows)[number]>,
        ];
        return { countRes, pendingRes, releasedRes, scoreRes };
      })
    );

    let countSum = 0;
    let countError = false;
    for (const part of perChunk) {
      if (part.countRes.error) countError = true;
      else countSum += part.countRes.count ?? 0;
      pendingRows = pendingRows.concat(part.pendingRes.data ?? []);
      releasedRows = releasedRows.concat(part.releasedRes.data ?? []);
      if (part.scoreRes.error) scoreSeriesError = true;
      else scoreRows = scoreRows.concat(part.scoreRes.data ?? []);
      if (part.releasedRes.error) releasedFeedError = true;
    }
    pendingCount = countError ? null : countSum;
    releasedRows.sort((a, b) => String(b.released_at).localeCompare(String(a.released_at)));
    releasedRows = releasedRows.slice(0, 10);
  }

  // --- Stat cards -----------------------------------------------------------
  const enrollmentRows = enrollmentsRes.error ? null : (enrollmentsRes.data ?? []);
  const distinctStudents = enrollmentRows
    ? new Set(enrollmentRows.map((row) => row.student_id)).size
    : null;

  const assessmentsCount = assessmentsCountRes.error ? null : (assessmentsCountRes.count ?? 0);
  const assessmentsSeries = countSeries(assessmentsSeriesRes, 'created_at');
  const assessmentsDelta = monthDelta(assessmentsSeries);

  const statCards: FacultyStatCard[] = [
    {
      key: 'subjects',
      label: 'My Subjects',
      value: ownOfferings.length,
      caption: 'This semester',
      deltaPct: null,
      deltaNote: null,
      series: null,
    },
    {
      key: 'assessments',
      label: 'Assessments Created',
      value: assessmentsCount,
      caption: null,
      deltaPct: assessmentsDelta.deltaPct,
      deltaNote: assessmentsDelta.deltaNote,
      series: assessmentsSeries,
    },
    {
      key: 'students',
      label: 'Total Students',
      value: distinctStudents,
      caption: sectionCount > 0 ? `${sectionCount} section${sectionCount === 1 ? '' : 's'}` : null,
      deltaPct: null,
      deltaNote: null,
      series: null,
    },
    {
      key: 'toCheck',
      label: 'To Be Checked',
      value: pendingCount,
      caption: 'Awaiting release',
      deltaPct: null,
      deltaNote: null,
      series: null,
    },
  ];

  // --- Trends ---------------------------------------------------------------
  const deploymentsSeries = countSeries(deploymentsSeriesRes, 'opens_at');
  let trends: AdminTrendsData | null = null;
  if (assessmentsSeries && deploymentsSeries && !scoreSeriesError) {
    const sums = new Array(rangeMonths).fill(0) as number[];
    const counts = new Array(rangeMonths).fill(0) as number[];
    for (const row of scoreRows) {
      const index = bucketFor(String(row.created_at ?? ''));
      const pct = Number(row.percentage);
      if (index >= 0 && index < rangeMonths && Number.isFinite(pct)) {
        sums[index] += pct;
        counts[index] += 1;
      }
    }
    const averageScore = counts.map((count, i) =>
      count > 0 ? Math.round((sums[i] / count) * 10) / 10 : null
    );
    trends = {
      labels,
      assessmentsCreated: assessmentsSeries,
      examsConducted: deploymentsSeries,
      averageScore,
    };
  }

  // --- Upcoming assessments -------------------------------------------------
  let upcoming: FacultyUpcomingItem[] | null = null;
  if (upcomingRes.error) {
    upcoming = null;
  } else {
    upcoming = (upcomingRes.data ?? []).map((row) => {
      const assessment = unwrap(row.assessments) as {
        title?: string;
        subject_offerings?: unknown;
      } | null;
      const offering = assessment ? unwrap(assessment.subject_offerings) : null;
      const subject = offering
        ? unwrap((offering as { subject?: unknown }).subject)
        : null;
      const section = offering
        ? unwrap((offering as { section?: unknown }).section)
        : null;
      const code = (subject as { code?: string } | null)?.code ?? null;
      const sectionName = (section as { name?: string } | null)?.name ?? null;
      return {
        id: row.id,
        title: assessment?.title ?? 'Untitled assessment',
        subjectLabel:
          code && sectionName ? `${code} · ${sectionName}` : (code ?? '—'),
        offeringId: row.subject_offering_id,
        assessmentId: row.assessment_id,
        opensAt: row.opens_at,
        closesAt: row.closes_at,
        status:
          new Date(row.opens_at).getTime() <= now.getTime()
            ? ('active' as const)
            : ('scheduled' as const),
      };
    });
  }

  // --- Recent activity (merged, newest first) -------------------------------
  const activity: FacultyActivityItem[] = [];
  let feedsErrored = 0;

  const pushFeed = <T>(
    ok: boolean,
    rows: T[],
    map: (row: T) => FacultyActivityItem | null
  ): void => {
    if (!ok) {
      feedsErrored += 1;
      return;
    }
    for (const row of rows) {
      const item = map(row);
      if (item) activity.push(item);
    }
  };

  pushFeed(!attemptsRes.error, attemptsRes.data ?? [], (row) => {
    const deployment = unwrap(row.assessment_deployments) as { assessments?: unknown } | null;
    const assessment = deployment ? unwrap(deployment.assessments) : null;
    return {
      id: `attempt-${row.id}`,
      action: 'Exam submitted',
      detail: (assessment as { title?: string } | null)?.title ?? null,
      createdAt: row.submitted_at,
    };
  });

  pushFeed(!versionsRes.error, versionsRes.data ?? [], (row) => {
    const assessment = unwrap(row.assessments) as { title?: string } | null;
    return {
      id: `version-${row.id}`,
      action: 'Assessment published',
      detail: assessment?.title ?? null,
      createdAt: row.published_at,
    };
  });

  pushFeed(!sourcesRes.error, sourcesRes.data ?? [], (row) => ({
    id: `source-${row.id}`,
    action: 'Source material uploaded',
    detail: row.title,
    createdAt: row.created_at,
  }));

  pushFeed(!jobsRes.error, jobsRes.data ?? [], (row) => {
    if (row.status !== 'completed' && row.status !== 'failed') return null;
    const assessment = unwrap(row.assessments) as { title?: string } | null;
    return {
      id: `job-${row.id}`,
      action: row.status === 'completed' ? 'AI generation completed' : 'AI generation failed',
      detail: assessment?.title ?? null,
      createdAt: row.created_at,
    };
  });

  pushFeed(!releasedFeedError, releasedRows, (row) => {
    const deployment = unwrap(row.assessment_deployments) as { assessments?: unknown } | null;
    const assessment = deployment ? unwrap(deployment.assessments) : null;
    return {
      id: `released-${row.id}`,
      action: 'Results released',
      detail: (assessment as { title?: string } | null)?.title ?? null,
      createdAt: row.released_at,
    };
  });

  activity.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  // Partial data still beats none: the panel only reports "unavailable" when
  // every feed failed and nothing at all could be shown.
  const recentActivity =
    activity.length > 0
      ? activity.slice(0, 7)
      : feedsErrored > 0
        ? null
        : [];

  // --- Action required (constitution §13 priority #1) -----------------------
  const actionItems: FacultyActionItem[] = [];

  if (pendingCount != null && pendingCount > 0) {
    const byOffering = new Map<string, { count: number; title: string }>();
    for (const row of pendingRows) {
      const deployment = unwrap(row.assessment_deployments) as {
        subject_offering_id?: string;
        assessments?: unknown;
      } | null;
      const offeringId = deployment?.subject_offering_id;
      if (!offeringId) continue;
      const assessment = deployment ? unwrap(deployment.assessments) : null;
      const title = (assessment as { title?: string } | null)?.title ?? 'Assessment';
      const entry = byOffering.get(offeringId) ?? { count: 0, title };
      entry.count += 1;
      byOffering.set(offeringId, entry);
    }
    let top: { offeringId: string; count: number; title: string } | null = null;
    for (const [offeringId, entry] of byOffering) {
      if (!top || entry.count > top.count) {
        top = { offeringId, count: entry.count, title: entry.title };
      }
    }
    actionItems.push({
      id: 'unreleased-results',
      title: `${pendingCount} result${pendingCount === 1 ? '' : 's'} awaiting release`,
      detail: top ? top.title : 'Release scores from the deployments page',
      href: top ? `/faculty/subjects/${top.offeringId}/deployments` : '/faculty/subjects',
    });
  }

  // Draft/job counts come from queries capped at 500 rows — plenty for the
  // "needs attention" signal; an errored query simply contributes no item.
  const drafts = draftsRes.error ? [] : (draftsRes.data ?? []);
  if (drafts.length > 0) {
    const latest = drafts[0];
    actionItems.push({
      id: 'draft-assessments',
      title: `${drafts.length} draft assessment${drafts.length === 1 ? '' : 's'} awaiting completion`,
      detail: latest.title,
      href: `/faculty/subjects/${latest.subject_offering_id}/assessments/${latest.id}`,
    });
  }

  const failedJobs = failedJobsRes.error ? [] : (failedJobsRes.data ?? []);
  if (failedJobs.length > 0) {
    const assessment = unwrap(failedJobs[0].assessments) as {
      id?: string;
      subject_offering_id?: string;
      title?: string;
    } | null;
    if (assessment?.id && assessment.subject_offering_id) {
      actionItems.push({
        id: 'failed-generation',
        title: `${failedJobs.length} AI generation job${failedJobs.length === 1 ? '' : 's'} failed`,
        detail: assessment.title ?? 'Review the failed generation job',
        href: `/faculty/subjects/${assessment.subject_offering_id}/assessments/${assessment.id}/review`,
      });
    }
  }

  return {
    hasAssignments: true,
    firstName,
    semesterOptions,
    selectedSemesterId,
    rangeMonths,
    statCards,
    trends,
    upcoming,
    recentActivity,
    actionItems,
  };
}
