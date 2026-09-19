import { createAdminClient } from '@/lib/supabase/admin';
import type { NotificationType } from '@/lib/types';

interface NotifyOfferingInput {
  offeringId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Insert an in-app notification for every actively enrolled student of a
 * subject offering.
 *
 * Runs with the service-role client on purpose: the security hardening
 * migration REVOKEs INSERT on `notifications` from the authenticated role, so
 * notifications may only be created by trusted server code (the same pattern
 * as audit logging). Callers must have already authorized the action.
 *
 * Returns the number of students notified (0 when nobody is enrolled or the
 * insert fails — a notification must never break the business operation it
 * accompanies).
 */
export async function notifyOfferingStudents({
  offeringId,
  type,
  title,
  body,
  data,
}: NotifyOfferingInput): Promise<number> {
  const admin = createAdminClient();

  const { data: enrollments } = await admin
    .from('enrollments')
    .select('student_id')
    .eq('subject_offering_id', offeringId)
    .eq('status', 'enrolled');

  const studentIds = [
    ...new Set((enrollments ?? []).map((e) => e.student_id as string)),
  ].filter(Boolean);

  if (studentIds.length === 0) return 0;

  const { error } = await admin.from('notifications').insert(
    studentIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      body,
      data: data ?? {},
    }))
  );

  if (error) {
    console.error('Failed to create notifications:', error.message);
    return 0;
  }

  return studentIds.length;
}
