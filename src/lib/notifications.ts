import { createAdminClient } from '@/lib/supabase/admin';
import type { NotificationType } from '@/lib/types';

interface NotifyOfferingInput {
  offeringId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface OfferingNotificationContext {
  subjectId: string | null;
  subjectLabel: string | null;
  sectionName: string | null;
}

/**
 * Resolve subject code/title and section for an offering so notification
 * bodies and `data` can say which subject the message belongs to.
 */
export async function getOfferingNotificationContext(
  offeringId: string
): Promise<OfferingNotificationContext> {
  const admin = createAdminClient();
  const { data: offering } = await admin
    .from('subject_offerings')
    .select('subject:subjects(id, code, title), section:sections(name)')
    .eq('id', offeringId)
    .maybeSingle();

  const subject = (offering?.subject ?? null) as {
    id?: string;
    code?: string;
    title?: string;
  } | null;
  const section = (offering?.section ?? null) as { name?: string } | null;

  const subjectLabel = subject?.code
    ? subject.title
      ? `${subject.code} - ${subject.title}`
      : subject.code
    : subject?.title ?? null;

  return {
    subjectId: subject?.id ?? null,
    subjectLabel,
    sectionName: section?.name ?? null,
  };
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
 * The subject name (and section, when present) is resolved from the offering
 * and stored on each row's `data` plus shown in the body prefix so students
 * can tell which subject a notification belongs to.
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

  const [{ data: enrollments }, context] = await Promise.all([
    admin
      .from('enrollments')
      .select('student_id')
      .eq('subject_offering_id', offeringId)
      .eq('status', 'enrolled'),
    getOfferingNotificationContext(offeringId),
  ]);

  const studentIds = [
    ...new Set((enrollments ?? []).map((e) => e.student_id as string)),
  ].filter(Boolean);

  if (studentIds.length === 0) return 0;

  const contextData = {
    subject_id: context.subjectId,
    subject_label: context.subjectLabel,
    section_name: context.sectionName,
    subject_offering_id: offeringId,
  };

  const bodyWithSubject = context.subjectLabel
    ? context.sectionName
      ? `${context.subjectLabel} (${context.sectionName}) — ${body}`
      : `${context.subjectLabel} — ${body}`
    : body;

  const { error } = await admin.from('notifications').insert(
    studentIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      body: bodyWithSubject,
      data: { ...(data ?? {}), ...contextData },
    }))
  );

  if (error) {
    console.error('Failed to create notifications:', error.message);
    return 0;
  }

  return studentIds.length;
}
