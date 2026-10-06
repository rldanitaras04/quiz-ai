import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import { withAuthRetry } from '@/lib/auth-errors';
import { homePathForRole } from '@/config/role-paths';
import type { UserRole } from '@/lib/types';

// Role landing paths are defined once in `config/role-paths` (dependency-free,
// safe from both server and client code). Re-exported here so `requireRole()`
// and any importer of `@/lib/auth` share that single definition instead of
// drifting from a second copy.
export { homePathForRole };

export type RoleGate =
  | { status: 'ok'; user: User; role: UserRole; supabase: SupabaseClient }
  | { status: 'blocked'; reason: 'pending' | 'suspended' | 'inactive' };

/**
 * Server-side role gate for a route group.
 *
 * UI visibility is not a security control — RLS and the server actions remain
 * the enforcement layer — but unauthenticated/unauthorized navigation should
 * never reach a section's pages at all. Unauthorized roles are redirected to
 * their own dashboard instead of being shown an empty shell.
 *
 * Accounts awaiting administrator approval ('pending') and accounts an
 * administrator has suspended or deactivated are refused outright:
 * registration creates accounts as 'pending' with no email verification,
 * so approval at /admin/users is the step that unlocks the app.
 */
export async function requireRole(allowed: readonly UserRole[]): Promise<RoleGate> {
  const supabase = await createClient();

  // Back off briefly on transient Auth failures (rate limit, refresh-token
  // race) rather than bouncing a signed-in user straight to /login. Server
  // context: a same-request refresh-race retry cannot succeed because this
  // request's cookies are frozen, so don't wait for it.
  const {
    data: { user },
    error: authError,
  } = await withAuthRetry(() => supabase.auth.getUser(), { retryRefreshRace: false });

  if (authError || !user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', user.id)
    .single();

  if (
    profile?.status === 'pending' ||
    profile?.status === 'suspended' ||
    profile?.status === 'inactive'
  ) {
    return { status: 'blocked', reason: profile.status };
  }

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const role = getPrimaryRole((roles ?? []).map((r) => r.role as UserRole));

  if (!allowed.includes(role)) {
    redirect(homePathForRole(role));
  }

  return { status: 'ok', user, role, supabase };
}

// ---------------------------------------------------------------------------
// Faculty authorization helpers for server actions
// ---------------------------------------------------------------------------

/**
 * True when the user is assigned to the offering.
 *
 * Server actions call this so an unauthorized write fails with a useful message
 * instead of relying on RLS alone, which turns the same write into a silent
 * no-op that the action would otherwise report as success.
 */
export async function isFacultyOfOffering(
  supabase: SupabaseClient,
  userId: string,
  offeringId: string
): Promise<boolean> {
  if (!offeringId) return false;

  const { data } = await supabase
    .from('faculty_assignments')
    .select('id')
    .eq('subject_offering_id', offeringId)
    .eq('faculty_id', userId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * True when the user is assigned to any offering of the subject.
 * Subject-level assessment access uses this so sibling sections share content.
 */
export async function isFacultyOfSubject(
  supabase: SupabaseClient,
  userId: string,
  subjectId: string
): Promise<boolean> {
  if (!subjectId) return false;

  const { data } = await supabase
    .from('faculty_assignments')
    .select('id, subject_offerings!inner(subject_id)')
    .eq('faculty_id', userId)
    .eq('subject_offerings.subject_id', subjectId)
    .limit(1)
    .maybeSingle();

  return Boolean(data);
}

/**
 * True when the user may add/remove/restore enrollment rows on the offering:
 * the assigned faculty, or any super administrator (RLS already grants
 * `Admin can manage enrollments`; this keeps the action-level error message
 * useful instead of a silent no-op). Assessment *content* ownership stays with
 * `isFacultyOfOffering` — administrators do not inherit the answer-key gate.
 */
export async function canManageEnrollment(
  supabase: SupabaseClient,
  userId: string,
  offeringId: string
): Promise<boolean> {
  if (await isFacultyOfOffering(supabase, userId, offeringId)) return true;

  const { data } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .maybeSingle();

  return Boolean(data);
}

export interface FacultyAssessment {
  id: string;
  title: string;
  status: string;
  subjectOfferingId: string;
  currentVersionId: string | null;
}

/** The assessment, when the user is faculty on its offering or subject; null otherwise. */
export async function getFacultyAssessment(
  supabase: SupabaseClient,
  userId: string,
  assessmentId: string
): Promise<FacultyAssessment | null> {
  if (!assessmentId) return null;

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, title, status, subject_offering_id, current_version_id')
    .eq('id', assessmentId)
    .maybeSingle();

  if (!assessment) return null;

  if (!(await isFacultyOfOffering(supabase, userId, assessment.subject_offering_id))) {
    const { data: offering } = await supabase
      .from('subject_offerings')
      .select('subject_id')
      .eq('id', assessment.subject_offering_id)
      .maybeSingle();

    if (!offering?.subject_id) return null;
    if (!(await isFacultyOfSubject(supabase, userId, offering.subject_id))) return null;
  }

  return {
    id: assessment.id,
    title: assessment.title,
    status: assessment.status,
    subjectOfferingId: assessment.subject_offering_id,
    currentVersionId: assessment.current_version_id,
  };
}

/**
 * True when the assessment's home offering and the given offering belong to
 * the same subject (sibling sections share subject-level assessments).
 */
export async function assessmentSharesSubjectWithOffering(
  supabase: SupabaseClient,
  assessmentOfferingId: string,
  offeringId: string
): Promise<boolean> {
  if (!assessmentOfferingId || !offeringId) return false;
  if (assessmentOfferingId === offeringId) return true;

  const [assessmentOffering, offering] = await Promise.all([
    supabase.from('subject_offerings').select('subject_id').eq('id', assessmentOfferingId).maybeSingle(),
    supabase.from('subject_offerings').select('subject_id').eq('id', offeringId).maybeSingle(),
  ]);

  return Boolean(
    assessmentOffering.data?.subject_id &&
    offering.data?.subject_id &&
    assessmentOffering.data.subject_id === offering.data.subject_id
  );
}

/**
 * True when the user is faculty on the offering, or on any offering of its
 * subject (sibling sections share subject-level assessment deployments and
 * content for faculty of the subject).
 */
export async function isFacultyOfOfferingOrSubject(
  supabase: SupabaseClient,
  userId: string,
  offeringId: string
): Promise<boolean> {
  if (!offeringId) return false;
  if (await isFacultyOfOffering(supabase, userId, offeringId)) return true;

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject_id')
    .eq('id', offeringId)
    .maybeSingle();

  if (!offering?.subject_id) return false;
  return isFacultyOfSubject(supabase, userId, offering.subject_id);
}

// ---------------------------------------------------------------------------
// Proctor authorization helpers (scope §42)
// ---------------------------------------------------------------------------

/** True when the user holds the super_admin role (scope §2.1). */
export async function isSuperAdmin(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  if (!userId) return false;

  const { data } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'super_admin')
    .maybeSingle();

  return Boolean(data);
}

/**
 * True when the user is an assigned proctor of the deployment (scope §42).
 *
 * Reads `exam_proctors` through the caller's session: RLS lets a proctor see
 * their own rows and faculty see rows on their offerings, so a non-proctor
 * simply resolves to false.
 */
export async function isProctorOfDeployment(
  supabase: SupabaseClient,
  userId: string,
  deploymentId: string
): Promise<boolean> {
  if (!deploymentId || !userId) return false;

  const { data } = await supabase
    .from('exam_proctors')
    .select('id')
    .eq('deployment_id', deploymentId)
    .eq('proctor_id', userId)
    .maybeSingle();

  return Boolean(data);
}

/**
 * True when the user is a proctor of ANY deployment of this assessment in
 * this offering — the monitor-page gate for someone who is not faculty of
 * the offering. Proctors only ever see the deployments they are assigned to
 * (RLS + the page's deployment list), never sibling sections' sittings.
 */
export async function isProctorOfWorkspace(
  supabase: SupabaseClient,
  userId: string,
  assessmentId: string,
  offeringId: string
): Promise<boolean> {
  if (!userId || !assessmentId || !offeringId) return false;

  const { data } = await supabase
    .from('exam_proctors')
    .select('id, assessment_deployments!inner(id)')
    .eq('proctor_id', userId)
    .eq('assessment_deployments.assessment_id', assessmentId)
    .eq('assessment_deployments.subject_offering_id', offeringId)
    .limit(1)
    .maybeSingle();

  return Boolean(data);
}

/**
 * True when the user may assign/remove proctors on the offering (scope §42):
 * faculty of the offering or its subject, or a super administrator. Content
 * ownership stays with `isFacultyOfOfferingOrSubject`; proctor assignment is
 * an invigilation setting, not an answer-key capability.
 */
export async function canManageProctors(
  supabase: SupabaseClient,
  userId: string,
  offeringId: string
): Promise<boolean> {
  if (await isFacultyOfOfferingOrSubject(supabase, userId, offeringId)) return true;
  return isSuperAdmin(supabase, userId);
}

/**
 * The assessment a question belongs to (question → version → assessment), when
 * the user is faculty on its offering or subject; null otherwise.
 */
export async function getFacultyAssessmentForQuestion(
  supabase: SupabaseClient,
  userId: string,
  questionId: string
): Promise<FacultyAssessment | null> {
  if (!questionId) return null;

  const { data: question } = await supabase
    .from('questions')
    .select('assessment_version_id')
    .eq('id', questionId)
    .maybeSingle();

  if (!question?.assessment_version_id) return null;

  const { data: version } = await supabase
    .from('assessment_versions')
    .select('assessment_id')
    .eq('id', question.assessment_version_id)
    .maybeSingle();

  if (!version?.assessment_id) return null;

  return getFacultyAssessment(supabase, userId, version.assessment_id);
}
