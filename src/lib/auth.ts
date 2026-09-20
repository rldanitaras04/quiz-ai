import { redirect } from 'next/navigation';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { getPrimaryRole } from '@/lib/constants';
import type { UserRole } from '@/lib/types';

/** Landing route for each role. Used when a user reaches a section they do not own. */
export function homePathForRole(role: UserRole): string {
  if (role === 'super_admin') return '/admin';
  if (role === 'faculty') return '/faculty';
  return '/student';
}

export type RoleGate =
  | { status: 'ok'; user: User; role: UserRole; supabase: SupabaseClient }
  | { status: 'blocked'; reason: 'suspended' | 'inactive' };

/**
 * Server-side role gate for a route group.
 *
 * UI visibility is not a security control — RLS and the server actions remain
 * the enforcement layer — but unauthenticated/unauthorized navigation should
 * never reach a section's pages at all. Unauthorized roles are redirected to
 * their own dashboard instead of being shown an empty shell.
 *
 * Accounts that an administrator has suspended or deactivated are refused
 * outright. ('pending' accounts are still allowed through: approvals are not
 * yet wired up, so treating pending as denied would lock out every account
 * created before an admin review.)
 */
export async function requireRole(allowed: readonly UserRole[]): Promise<RoleGate> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', user.id)
    .single();

  if (profile?.status === 'suspended' || profile?.status === 'inactive') {
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

export interface FacultyAssessment {
  id: string;
  title: string;
  status: string;
  subjectOfferingId: string;
  currentVersionId: string | null;
}

/** The assessment, when the user is faculty on its offering; null otherwise. */
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
    return null;
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
 * The assessment a question belongs to (question → version → assessment), when
 * the user is faculty on its offering; null otherwise.
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
