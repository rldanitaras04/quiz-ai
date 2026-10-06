/**
 * Deep links for notification "View" actions.
 *
 * Dependency-free on purpose: the `/notifications` page and the profile card
 * both render a View link and used to carry separate copies of this logic.
 * Those copies drifted, and both read the offering from `data.offering_id`
 * while `notifyUser` writes it as `subject_offering_id` — so a proctor's View
 * link failed its guard and fell through to the student path below. One
 * implementation, covered by `tests/notification-links.test.mjs`, so the two
 * surfaces cannot disagree again.
 *
 * Authorization is still enforced when the target page loads (RLS scopes
 * everything to the signed-in user), so a stale or foreign id simply resolves
 * to nothing.
 */

type NotificationData = Record<string, unknown> | null;

/** Non-empty string, or null — the guard every id below has to pass. */
function id(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * The subject offering a notification belongs to.
 *
 * Writers are inconsistent: `notifyUser` stores `subject_offering_id` (the
 * key `notifyOfferingStudents` / `notifyFacultyOfOffering` also stamp into
 * every bulk row), while a few callers set `offering_id` directly. Accept
 * both, preferring `offering_id` so rows carrying the legacy key keep their
 * current target. Reads `offering_id` first: no row that resolves today can
 * change destination.
 */
function offeringIdFrom(data: Record<string, unknown>): string | null {
  return id(data.offering_id) ?? id(data.subject_offering_id);
}

/**
 * Target for a notification, or null when it has no meaningful destination
 * (in which case the UI omits the View link entirely).
 *
 * Proctor assignment (scope §42) is checked first: a proctor is not faculty
 * of this workspace, so neither the assessment workspace nor the student
 * paths are reachable for them. If its ids are unusable it returns null
 * rather than falling through — degrading to "no link" is safe, degrading to
 * a student URL is not.
 */
export function notificationHref(data: NotificationData): string | null {
  if (!data) return null;

  const assessmentId = id(data.assessment_id);

  if (data.proctor === true) {
    const offeringId = offeringIdFrom(data);
    if (offeringId && assessmentId) {
      return `/faculty/subjects/${offeringId}/assessments/${assessmentId}/monitor`;
    }
    return null;
  }

  // Generation outcomes are explicitly marked and link to the faculty
  // assessment workspace, never the student path below.
  if (data.faculty_assessment === true) {
    const offeringId = offeringIdFrom(data);
    if (offeringId && assessmentId) {
      return `/faculty/subjects/${offeringId}/assessments/${assessmentId}`;
    }
    return null;
  }

  if (assessmentId) {
    const attemptId = id(data.attempt_id);
    if (attemptId) {
      return `/student/assessments/${assessmentId}/exam/${attemptId}/results`;
    }
    return `/student/assessments/${assessmentId}`;
  }

  // Roster link for identity-verification requests, which carry `offering_id`.
  // Deliberately not widened to `subject_offering_id`: every bulk helper that
  // stamps that key also carries an assessment id (handled above), and adding
  // links for the remainder would point students at a faculty route.
  const offeringId = id(data.offering_id);
  if (offeringId) {
    return `/faculty/subjects/${offeringId}/students`;
  }

  return null;
}

/** Subject/section badge text from a notification's `data`, when present. */
export function subjectLabelFromData(data: NotificationData): string | null {
  if (!data) return null;
  return id(data.subject_label);
}
