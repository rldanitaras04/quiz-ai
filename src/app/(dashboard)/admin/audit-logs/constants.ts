import type { AuditAction } from '@/lib/types';

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
  create: 'Create',
  update: 'Update',
  delete: 'Delete',
  publish: 'Publish',
  approve: 'Approve',
  submit: 'Submit',
  score: 'Score',
  release: 'Release',
  invalidate: 'Invalidate',
  login: 'Login',
  logout: 'Logout',
};

export const AUDIT_ACTIONS: AuditAction[] = [
  'create',
  'update',
  'delete',
  'publish',
  'approve',
  'submit',
  'score',
  'release',
  'invalidate',
  'login',
  'logout',
];

export const ENTITY_TYPES = [
  'profile',
  'user_role',
  'academic_year',
  'semester',
  'program',
  'section',
  'subject',
  'subject_offering',
  'faculty_assignment',
  'enrollment',
  'assessment',
  'assessment_version',
  'assessment_deployment',
  'question',
  'exam_attempt',
  'assessment_result',
  'notification',
] as const;

export const actionVariant: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
  create: 'success',
  update: 'info',
  delete: 'danger',
  publish: 'success',
  approve: 'success',
  submit: 'info',
  score: 'info',
  release: 'success',
  invalidate: 'warning',
  login: 'default',
  logout: 'default',
};
