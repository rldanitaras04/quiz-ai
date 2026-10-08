import { createAdminClient } from '@/lib/supabase/admin';
import type { NotificationType } from '@/lib/types';
import { logger } from './logger.ts';

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
    logger.error('Failed to create notifications:', error.message);
    return 0;
  }

  return studentIds.length;
}

export interface NotifyFacultyInput {
  offeringId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Insert one notification per faculty member assigned to an offering
 * (scope §32 faculty events: submission progress, responses needing review,
 * generation completion/failure). Service-role only — notifications INSERT
 * is REVOKE'd from `authenticated`, the same rule `notifyOfferingStudents`
 * follows for the student direction. Always best-effort: returns the number
 * of faculty notified and never throws, so callers can fire it without
 * jeopardizing their primary write.
 */
export async function notifyFacultyOfOffering({
  offeringId,
  type,
  title,
  body,
  data,
}: NotifyFacultyInput): Promise<number> {
  const admin = createAdminClient();

  const [{ data: assignments }, context] = await Promise.all([
    admin
      .from('faculty_assignments')
      .select('faculty_id')
      .eq('subject_offering_id', offeringId),
    getOfferingNotificationContext(offeringId),
  ]);

  const facultyIds = [
    ...new Set((assignments ?? []).map((a) => a.faculty_id as string)),
  ].filter(Boolean);

  if (facultyIds.length === 0) return 0;

  const contextData = {
    subject_id: context.subjectId,
    subject_label: context.subjectLabel,
    section_name: context.sectionName,
    subject_offering_id: offeringId,
  };

  const bodyWithSubject = context.subjectLabel
    ? `${context.subjectLabel} — ${body}`
    : body;

  const { error } = await admin.from('notifications').insert(
    facultyIds.map((userId) => ({
      user_id: userId,
      type,
      title,
      body: bodyWithSubject,
      data: { ...(data ?? {}), ...contextData },
    }))
  );

  if (error) {
    logger.error('Failed to create faculty notifications:', error.message);
    return 0;
  }

  return facultyIds.length;
}

export interface NotifyUserInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/**
 * Insert a notification for one specific user (e.g. `proctor_assigned`,
 * scope §42). Same service-role-only, best-effort rule as the bulk helpers:
 * returns true when the row was created, false otherwise, and never throws —
 * callers fire it after their primary write without jeopardizing it.
 */
export async function notifyUser({
  userId,
  type,
  title,
  body,
  data,
}: NotifyUserInput): Promise<boolean> {
  if (!userId) return false;

  const admin = createAdminClient();
  const { error } = await admin.from('notifications').insert({
    user_id: userId,
    type,
    title,
    body,
    data: data ?? {},
  });

  if (error) {
    logger.error('Failed to create user notification:', error.message);
    return false;
  }

  return true;
}
