'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOfferingOrSubject } from '@/lib/auth';
import type { ExceptionType } from '@/lib/types';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

export interface ExceptionWithStudent {
  id: string;
  deployment_id: string;
  student_id: string;
  exception_type: ExceptionType;
  override_opens_at: string | null;
  override_closes_at: string | null;
  additional_minutes: number | null;
  additional_attempts: number | null;
  reason: string;
  authorized_by: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  student_name?: string;
  student_email?: string;
  authorizer_name?: string;
}

/**
 * List exceptions for a deployment, with student and authorizer names.
 */
export async function listExceptions(
  deploymentId: string
): Promise<{ data: ExceptionWithStudent[] | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id')
    .eq('id', deploymentId)
    .single();

  if (!deployment) return { data: null, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  const admin = createAdminClient();
  const { data: exceptions, error: exErr } = await admin
    .from('assessment_exceptions')
    .select('*')
    .eq('deployment_id', deploymentId)
    .order('created_at', { ascending: false });

  if (exErr) return { data: null, error: exErr.message };

  if (!exceptions || exceptions.length === 0) return { data: [] };

  const studentIds = [...new Set(exceptions.map(e => e.student_id))];
  const authorizerIds = [...new Set(exceptions.map(e => e.authorized_by))];

  const allUserIds = [...new Set([...studentIds, ...authorizerIds])];

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in('id', allUserIds);

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

  const enriched: ExceptionWithStudent[] = exceptions.map(ex => ({
    ...ex,
    student_name: profileMap.get(ex.student_id)?.full_name ?? 'Unknown',
    student_email: profileMap.get(ex.student_id)?.email ?? '',
    authorizer_name: profileMap.get(ex.authorized_by)?.full_name ?? 'Unknown',
  }));

  return { data: enriched };
}

/**
 * Grant an exception to a student for a deployment.
 */
export async function grantException(
  deploymentId: string,
  studentId: string,
  exceptionType: ExceptionType,
  reason: string,
  overrides: {
    override_opens_at?: string;
    override_closes_at?: string;
    additional_minutes?: number;
    additional_attempts?: number;
    expires_at?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  if (!reason?.trim()) return { success: false, error: 'Reason is required' };

  const { supabase, userId } = await requireUser();

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id')
    .eq('id', deploymentId)
    .single();

  if (!deployment) return { success: false, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { success: false, error: 'Not authorized' };
  }

  const admin = createAdminClient();

  const { error: insertErr } = await admin
    .from('assessment_exceptions')
    .insert({
      deployment_id: deploymentId,
      student_id: studentId,
      exception_type: exceptionType,
      override_opens_at: overrides.override_opens_at ?? null,
      override_closes_at: overrides.override_closes_at ?? null,
      additional_minutes: overrides.additional_minutes ?? null,
      additional_attempts: overrides.additional_attempts ?? null,
      reason: reason.trim(),
      authorized_by: userId,
      expires_at: overrides.expires_at ?? null,
    });

  if (insertErr) return { success: false, error: insertErr.message };

  await recordAuditLog({
    actorUserId: userId,
    action: 'create',
    entityType: 'assessment_exception',
    entityId: deploymentId,
    metadata: { student_id: studentId, exception_type: exceptionType, reason: reason.trim() },
  });

  revalidatePath('/faculty');
  return { success: true };
}

/**
 * Remove (revoke) an exception.
 */
export async function revokeException(
  exceptionId: string
): Promise<{ success: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();

  const admin = createAdminClient();
  const { data: exception } = await admin
    .from('assessment_exceptions')
    .select('id, deployment_id, student_id, exception_type')
    .eq('id', exceptionId)
    .single();

  if (!exception) return { success: false, error: 'Exception not found' };

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('subject_offering_id')
    .eq('id', exception.deployment_id)
    .single();

  if (!deployment) return { success: false, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { success: false, error: 'Not authorized' };
  }

  const { error: delErr } = await admin
    .from('assessment_exceptions')
    .delete()
    .eq('id', exceptionId);

  if (delErr) return { success: false, error: delErr.message };

  await recordAuditLog({
    actorUserId: userId,
    action: 'delete',
    entityType: 'assessment_exception',
    entityId: exception.deployment_id,
    metadata: { student_id: exception.student_id, exception_type: exception.exception_type },
  });

  revalidatePath('/faculty');
  return { success: true };
}

/**
 * List students enrolled in a deployment's offering (for the grant form).
 */
export async function listEnrolledStudents(
  deploymentId: string
): Promise<{ data: { id: string; name: string; email: string }[] | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id')
    .eq('id', deploymentId)
    .single();

  if (!deployment) return { data: null, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  const admin = createAdminClient();
  const { data: enrollments } = await admin
    .from('enrollments')
    .select('student_id')
    .eq('subject_offering_id', deployment.subject_offering_id)
    .eq('status', 'enrolled');

  const studentIds = [...new Set((enrollments ?? []).map(e => e.student_id))];
  if (studentIds.length === 0) return { data: [] };

  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in('id', studentIds);

  return {
    data: (profiles ?? []).map(p => ({
      id: p.id,
      name: p.full_name,
      email: p.email,
    })),
  };
}
