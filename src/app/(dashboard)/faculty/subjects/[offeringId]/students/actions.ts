'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function addStudentToOffering(
  offeringId: string,
  studentNumber: string
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const { data: assignment } = await supabase
    .from('faculty_assignments')
    .select('id')
    .eq('subject_offering_id', offeringId)
    .eq('faculty_id', user.id)
    .single();

  if (!assignment) return { error: 'Not authorized for this offering' };

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
    .eq('student_number', studentNumber)
    .single();

  if (!studentProfile) return { error: 'Student not found with that student number' };

  const { data: existing } = await supabase
    .from('enrollments')
    .select('id, status')
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentProfile.user_id)
    .single();

  if (existing) {
    if (existing.status === 'enrolled') return { error: 'Student is already enrolled' };
    const { error } = await supabase
      .from('enrollments')
      .update({ status: 'enrolled', updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return { error: 'Failed to re-enroll student' };
    return { success: true };
  }

  const { error } = await supabase
    .from('enrollments')
    .insert({
      subject_offering_id: offeringId,
      student_id: studentProfile.user_id,
      status: 'enrolled',
      enrolled_at: new Date().toISOString(),
    });

  if (error) return { error: 'Failed to enroll student' };
  return { success: true };
}

export async function removeStudentFromOffering(
  offeringId: string,
  studentId: string
): Promise<{ error?: string; success?: boolean }> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { error: 'Not authenticated' };

  const { data: assignment } = await supabase
    .from('faculty_assignments')
    .select('id')
    .eq('subject_offering_id', offeringId)
    .eq('faculty_id', user.id)
    .single();

  if (!assignment) return { error: 'Not authorized for this offering' };

  const { error } = await supabase
    .from('enrollments')
    .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
    .eq('subject_offering_id', offeringId)
    .eq('student_id', studentId)
    .eq('status', 'enrolled');

  if (error) return { error: 'Failed to remove student' };
  return { success: true };
}
