'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOffering } from '@/lib/auth';

/** Every faculty view whose contents change when an enrollment does. */
function revalidateEnrollments(offeringId: string): void {
  revalidatePath(`/faculty/subjects/${offeringId}/students`);
  revalidatePath(`/faculty/subjects/${offeringId}`);
  revalidatePath('/faculty/subjects');
  revalidatePath('/faculty');
}

export async function addStudentToOffering(
  offeringId: string,
  studentNumber: string
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const number = studentNumber?.trim();
  if (!number) return { error: 'Enter a student number' };

  if (!(await isFacultyOfOffering(supabase, user.id, offeringId))) {
    return { error: 'Not authorized for this offering' };
  }

  // The lookup runs with the service-role client on purpose. Under RLS a
  // faculty member may only read student_profiles for students who are
  // ALREADY enrolled in one of their offerings, so resolving a student to
  // enroll via the session client always failed — the exact case this action
  // exists for. Authorization was already established above (the caller must
  // be assigned to this offering), and the enrollment write itself still goes
  // through the session client, so RLS keeps enforcing the write.
  const admin = createAdminClient();
  const { data: studentProfile } = await admin
    .from('student_profiles')
    .select('user_id')
    .eq('student_number', number)
    .maybeSingle();

  if (!studentProfile) return { error: 'Student not found with that student number' };

  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentProfile.user_id)
    .maybeSingle();

  if (existing) {
    if (existing.status === 'enrolled') return { error: 'Student is already enrolled' };

    const { data: reenrolled, error } = await supabase
      .from('enrollments')
      .update({ status: 'enrolled', updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();

    if (error) return { error: 'Failed to re-enroll student' };
    if (!reenrolled) return { error: 'That enrollment no longer exists or you cannot modify it' };

    await recordAuditLog({
      actorUserId: user.id,
      action: 'update',
      entityType: 'enrollment',
      entityId: existing.id,
      metadata: { subject_offering_id: offeringId, student_number: number, status: 'enrolled' },
    });

    revalidateEnrollments(offeringId);
    return { success: true };
  }

  const { data: enrollment, error } = await supabase
    .from('enrollments')
    .insert({
      subject_offering_id: offeringId,
      student_id: studentProfile.user_id,
      status: 'enrolled',
      enrolled_at: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (error) return { error: 'Failed to enroll student' };
  if (!enrollment) return { error: 'Failed to enroll student' };

  await recordAuditLog({
    actorUserId: user.id,
    action: 'create',
    entityType: 'enrollment',
    entityId: enrollment.id,
    metadata: { subject_offering_id: offeringId, student_number: number },
  });

  revalidateEnrollments(offeringId);
  return { success: true };
}

export async function removeStudentFromOffering(
  offeringId: string,
  studentId: string
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  if (!(await isFacultyOfOffering(supabase, user.id, offeringId))) {
    return { error: 'Not authorized for this offering' };
  }

  // Withdrawing keeps the row (and any submissions attached to it) — the same
  // soft state the enrollment vocabulary already defines.
  const { data: withdrawn, error } = await supabase
    .from('enrollments')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentId)
    .eq('status', 'enrolled')
    .select('id')
    .maybeSingle();

  if (error) return { error: 'Failed to remove student' };
  if (!withdrawn) return { error: 'That student is not actively enrolled in this offering' };

  await recordAuditLog({
    actorUserId: user.id,
    action: 'update',
    entityType: 'enrollment',
    entityId: withdrawn.id,
    metadata: { subject_offering_id: offeringId, student_id: studentId, status: 'withdrawn' },
  });

  revalidateEnrollments(offeringId);
  return { success: true };
}
