'use server';

import { createClient } from '@/lib/supabase/server';
import { getDeploymentStatus, type DeploymentStatusResult } from '@/lib/deployment-status';

const MONTH_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const UPCOMING_LIST_LIMIT = 6;
const UPCOMING_WINDOW_DAYS = 7;
const PERFORMANCE_RESULT_LIMIT = 8;
/** Safety cap for aggregate math; well above any realistic per-student total. */
const RELEASED_RESULTS_LIMIT = 500;

export interface StudentUpcomingItem {
  id: string;
  assessmentId: string;
  title: string;
  subjectCode: string;
  sectionLabel: string | null;
  monthLabel: string;
  dayLabel: string;
  timeLabel: string;
  status: DeploymentStatusResult;
}

export interface StudentSubjectItem {
  offeringId: string;
  code: string;
  title: string;
  sectionLabel: string | null;
}

export interface StudentPerformanceData {
  labels: string[];
  values: number[];
  scopeLabel: string;
}

export interface StudentStatValue {
  value: number | null;
  caption: string;
}

export interface StudentDashboardData {
  firstName: string;
  context: {
    sectionLabel: string | null;
    yearLevelName: string | null;
    semesterLabel: string | null;
  };
  stats: {
    subjects: StudentStatValue;
    upcoming: StudentStatValue;
    completed: StudentStatValue;
    average: StudentStatValue;
  };
  upcoming: StudentUpcomingItem[];
  subjects: StudentSubjectItem[];
  performance: StudentPerformanceData;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Read everything the student dashboard renders. Every number here is derived
 * from real rows: enrollments, deployment windows, and released results only
 * (unreleased scores are never read — RLS would deny them anyway).
 *
 * Returns null when the session is gone (caller redirects to login); query
 * failures throw so the segment's error boundary offers a retry.
 */
export async function getStudentDashboardData(): Promise<StudentDashboardData | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const now = new Date();
  const windowEnd = new Date(now.getTime() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [profileRes, studentProfileRes, enrollmentsRes] = await Promise.all([
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
    supabase
      .from('student_profiles')
      .select('student_number, program:programs(code, name), year_level:year_levels(name), section:sections(name)')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase
      .from('enrollments')
      .select(`
        id,
        enrolled_at,
        subject_offering:subject_offerings(
          id,
          subject:subjects(code, title),
          semester:semesters(id, name, academic_year:academic_years(name)),
          section:sections(name, program:programs(code))
        )
      `)
      .eq('student_id', user.id)
      .eq('status', 'enrolled')
      .order('enrolled_at', { ascending: true }),
  ]);
  if (profileRes.error || studentProfileRes.error || enrollmentsRes.error) {
    throw new Error('Failed to load your academic context.');
  }

  const fullName = (profileRes.data?.full_name as string | null) ?? '';
  const firstName = fullName.trim().split(/\s+/)[0] ?? '';
  const studentProfile = studentProfileRes.data;
  const program = asRecord(asRecord(studentProfile)?.program);
  const yearLevel = asRecord(asRecord(studentProfile)?.year_level);
  const studentSection = asRecord(asRecord(studentProfile)?.section);

  // One row per enrolled offering; also the lookup for deployment rows.
  interface OfferingInfo {
    offeringId: string;
    code: string;
    title: string;
    sectionLabel: string | null;
    semesterId: string | null;
    semesterName: string | null;
    academicYearName: string | null;
  }
  const offerings: OfferingInfo[] = [];
  const semesterCounts = new Map<string, number>();
  for (const row of enrollmentsRes.data ?? []) {
    const offering = asRecord(asRecord(row)?.subject_offering);
    const subject = asRecord(offering?.subject);
    const semester = asRecord(offering?.semester);
    const academicYear = asRecord(semester?.academic_year);
    const section = asRecord(offering?.section);
    const sectionProgram = asRecord(section?.program);
    if (!offering?.id) continue;

    const semesterId = (semester?.id as string | null) ?? null;
    const sectionLabel =
      sectionProgram?.code && section?.name
        ? `${sectionProgram.code} ${section.name}`
        : (section?.name as string | null) ?? null;

    offerings.push({
      offeringId: offering.id as string,
      code: (subject?.code as string) ?? '—',
      title: (subject?.title as string) ?? 'Untitled subject',
      sectionLabel,
      semesterId,
      semesterName: (semester?.name as string | null) ?? null,
      academicYearName: (academicYear?.name as string | null) ?? null,
    });
    if (semesterId) semesterCounts.set(semesterId, (semesterCounts.get(semesterId) ?? 0) + 1);
  }

  // The student's current term: the semester their enrolled offerings sit in.
  const activeSemesterId =
    [...semesterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const activeSemester = activeSemesterId
    ? offerings.find((o) => o.semesterId === activeSemesterId)
    : undefined;
  const semesterLabel = activeSemester?.semesterName
    ? [activeSemester.semesterName, activeSemester.academicYearName].filter(Boolean).join(', ')
    : null;

  const profileSectionLabel =
    program?.code && studentSection?.name
      ? `${program.code} ${studentSection.name}`
      : null;
  const sectionLabel =
    profileSectionLabel ??
    (activeSemesterId
      ? offerings.find((o) => o.semesterId === activeSemesterId)?.sectionLabel ?? null
      : offerings[0]?.sectionLabel ?? null);

  const offeringIds = offerings.map((o) => o.offeringId);
  const infoByOfferingId = new Map(offerings.map((o) => [o.offeringId, o]));

  // Deployment windows for enrolled offerings. status stays 'scheduled' forever
  // (the window is authoritative — see deployment_effective_status), so filter
  // on closes_at, never on status = 'active'.
  let deploymentRows: Array<Record<string, unknown>> = [];
  if (offeringIds.length > 0) {
    const { data, error } = await supabase
      .from('assessment_deployments')
      .select(`
        id,
        opens_at,
        closes_at,
        attempt_limit,
        subject_offering_id,
        assessment_version:assessment_versions(
          id,
          assessment:assessments!assessment_versions_assessment_id_fkey(id, title)
        )
      `)
      .in('subject_offering_id', offeringIds)
      .in('status', ['active', 'scheduled'])
      .gte('closes_at', now.toISOString())
      .order('opens_at', { ascending: true })
      .limit(100);
    if (error) throw new Error('Failed to load upcoming assessments.');
    deploymentRows = data ?? [];
  }

  const deploymentIds = deploymentRows.map((d) => d.id as string);
  const attemptsByDeployment = new Map<string, Array<Record<string, unknown>>>();
  if (deploymentIds.length > 0) {
    const { data, error } = await supabase
      .from('exam_attempts')
      .select('id, deployment_id, status, attempt_number')
      .eq('student_id', user.id)
      .in('deployment_id', deploymentIds);
    if (error) throw new Error('Failed to load your exam attempts.');
    for (const attempt of data ?? []) {
      const key = attempt.deployment_id as string;
      const list = attemptsByDeployment.get(key) ?? [];
      list.push(attempt as unknown as Record<string, unknown>);
      attemptsByDeployment.set(key, list);
    }
  }

  const upcomingItems: StudentUpcomingItem[] = [];
  let openInSevenDays = 0;
  for (const deployment of deploymentRows) {
    const opensAt = new Date(deployment.opens_at as string);
    const closesAt = new Date(deployment.closes_at as string);
    if (opensAt <= windowEnd && closesAt >= now) openInSevenDays += 1;

    if (upcomingItems.length >= UPCOMING_LIST_LIMIT) continue;
    const version = asRecord(deployment.assessment_version);
    const assessment = asRecord(version?.assessment);
    const offering = infoByOfferingId.get(deployment.subject_offering_id as string);
    if (!assessment?.id || !offering) continue;

    upcomingItems.push({
      id: deployment.id as string,
      assessmentId: assessment.id as string,
      title: (assessment.title as string) ?? 'Untitled assessment',
      subjectCode: offering.code,
      sectionLabel: offering.sectionLabel,
      monthLabel: MONTH_SHORT[opensAt.getMonth()],
      dayLabel: String(opensAt.getDate()),
      timeLabel: opensAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: getDeploymentStatus(deployment, attemptsByDeployment, now),
    });
  }

  // Released results only — pending/finalized scores are never surfaced.
  const { data: resultRows, error: resultsError } = await supabase
    .from('assessment_results')
    .select(`
      id,
      percentage,
      released_at,
      deployment:assessment_deployments(
        id,
        subject_offering_id,
        subject_offering:subject_offerings(semester_id),
        assessment_version:assessment_versions(
          id,
          assessment:assessments!assessment_versions_assessment_id_fkey(id, title)
        )
      )
    `)
    .eq('student_id', user.id)
    .eq('status', 'released')
    .order('released_at', { ascending: false })
    .limit(RELEASED_RESULTS_LIMIT);
  if (resultsError) throw new Error('Failed to load your released results.');

  interface ReleasedResult {
    title: string;
    percentage: number;
    semesterId: string | null;
    releasedAt: string;
  }
  const released: ReleasedResult[] = (resultRows ?? []).flatMap((row) => {
    const deployment = asRecord(row.deployment);
    const offering = asRecord(deployment?.subject_offering);
    const version = asRecord(deployment?.assessment_version);
    const assessment = asRecord(version?.assessment);
    return [
      {
        title: (assessment?.title as string) ?? 'Untitled assessment',
        percentage: Number(row.percentage ?? 0),
        semesterId: (offering?.semester_id as string | null) ?? null,
        releasedAt: row.released_at as string,
      },
    ];
  });

  const releasedThisSemester = activeSemesterId
    ? released.filter((r) => r.semesterId === activeSemesterId)
    : released;

  const completedCount = activeSemesterId ? releasedThisSemester.length : released.length;
  const completedCaption = activeSemesterId ? 'This semester' : 'All released results';

  const average =
    released.length > 0
      ? Math.round((released.reduce((sum, r) => sum + r.percentage, 0) / released.length) * 10) / 10
      : null;

  const performanceRows = releasedThisSemester
    .slice(0, PERFORMANCE_RESULT_LIMIT)
    .reverse();

  const enrolledThisSemester = activeSemesterId
    ? offerings.filter((o) => o.semesterId === activeSemesterId).length
    : offerings.length;

  return {
    firstName,
    context: {
      sectionLabel,
      yearLevelName: (yearLevel?.name as string | null) ?? null,
      semesterLabel,
    },
    stats: {
      subjects: {
        value: enrolledThisSemester,
        caption: activeSemesterId ? 'This semester' : 'Enrolled subjects',
      },
      upcoming: {
        value: openInSevenDays,
        caption: `Next ${UPCOMING_WINDOW_DAYS} days`,
      },
      completed: {
        value: completedCount,
        caption: completedCaption,
      },
      average: {
        value: average,
        caption: 'Overall average',
      },
    },
    upcoming: upcomingItems,
    subjects: offerings.slice(0, 8).map((o) => ({
      offeringId: o.offeringId,
      code: o.code,
      title: o.title,
      sectionLabel: o.sectionLabel,
    })),
    performance: {
      labels: performanceRows.map((r) => r.title),
      values: performanceRows.map((r) => Math.round(r.percentage)),
      scopeLabel: activeSemesterId ? 'This semester' : 'All released results',
    },
  };
}
