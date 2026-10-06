// "View" deep links for notifications (scope §42 among others). Runs in `npm test`.
//
// Enforced invariants:
//  1. A proctor assignment links to the live monitor, using whichever offering
//     key its writer emitted (`subject_offering_id` from `notifyUser`, or the
//     `offering_id` a few callers set directly).
//  2. A proctor notification whose ids are unusable yields NO link rather than
//     falling through to a student URL — a proctor is never a student here.
//  3. Every other writer keeps the exact target it resolved to before the two
//     copies of this helper were unified, so nothing silently moves.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  notificationHref,
  subjectLabelFromData,
} from '../src/lib/notification-links.ts';

test('a proctor assignment links to the live monitor via subject_offering_id', () => {
  // The shape `faculty/proctoring/actions.ts` actually writes.
  assert.equal(
    notificationHref({
      proctor: true,
      subject_offering_id: 'offering-1',
      assessment_id: 'assessment-1',
      deployment_id: 'deployment-1',
      subject_label: 'IT 101',
      section_name: 'BSCS 2-1',
    }),
    '/faculty/subjects/offering-1/assessments/assessment-1/monitor'
  );
});

test('a proctor assignment also links to the monitor via offering_id', () => {
  assert.equal(
    notificationHref({
      proctor: true,
      offering_id: 'offering-1',
      assessment_id: 'assessment-1',
    }),
    '/faculty/subjects/offering-1/assessments/assessment-1/monitor'
  );
});

test('a proctor notification never falls through to a student URL', () => {
  // Missing the offering: the pre-fix helper returned
  // `/student/assessments/...` here, which a proctor cannot open.
  assert.equal(
    notificationHref({ proctor: true, assessment_id: 'assessment-1' }),
    null
  );
  // Missing the assessment: pre-fix this reached the roster link instead.
  assert.equal(
    notificationHref({ proctor: true, subject_offering_id: 'offering-1' }),
    null
  );
  assert.equal(notificationHref({ proctor: true }), null);
});

test('a generation outcome links to the faculty assessment workspace', () => {
  assert.equal(
    notificationHref({
      faculty_assessment: true,
      offering_id: 'offering-1',
      assessment_id: 'assessment-1',
      count: 10,
      flagged: 1,
    }),
    '/faculty/subjects/offering-1/assessments/assessment-1'
  );
  // The same row also carries `subject_offering_id` (context stamp); the
  // explicitly-set `offering_id` must keep winning so the target is stable.
  assert.equal(
    notificationHref({
      faculty_assessment: true,
      offering_id: 'offering-1',
      subject_offering_id: 'other-offering',
      assessment_id: 'assessment-1',
    }),
    '/faculty/subjects/offering-1/assessments/assessment-1'
  );
});

test('a student attempt links to its results page', () => {
  assert.equal(
    notificationHref({ assessment_id: 'a1', attempt_id: 't1' }),
    '/student/assessments/a1/exam/t1/results'
  );
});

test('a student notification without an attempt links to the assessment', () => {
  assert.equal(
    notificationHref({ assessment_id: 'a1' }),
    '/student/assessments/a1'
  );
});

test('a submission notification carrying attempt_id but no assessment still uses the roster', () => {
  // `notifyFacultyOfOffering` rows (e.g. review_required) stamp
  // `subject_offering_id` via context and set `offering_id` directly.
  assert.equal(
    notificationHref({
      deployment_id: 'd1',
      attempt_id: 't1',
      offering_id: 'offering-1',
      subject_offering_id: 'offering-1',
    }),
    '/faculty/subjects/offering-1/students'
  );
});

test('an identity-verification request links to the roster', () => {
  assert.equal(
    notificationHref({
      student_user_id: 'u1',
      student_name: 'Ada',
      offering_id: 'offering-1',
      subject_label: 'IT 101',
    }),
    '/faculty/subjects/offering-1/students'
  );
});

test('rows with no resolvable target render no View link at all', () => {
  assert.equal(notificationHref(null), null);
  assert.equal(notificationHref({}), null);
  assert.equal(notificationHref({ count: 3 }), null);
});

test('subjectLabelFromData surfaces the badge text only when present', () => {
  assert.equal(subjectLabelFromData({ subject_label: 'IT 101' }), 'IT 101');
  assert.equal(subjectLabelFromData({ subject_label: '' }), null);
  assert.equal(subjectLabelFromData({}), null);
  assert.equal(subjectLabelFromData(null), null);
});
