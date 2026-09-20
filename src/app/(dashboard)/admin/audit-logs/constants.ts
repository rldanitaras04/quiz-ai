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

/** Every `entity_type` the application writes, so the filter can reach them all. */
export const ENTITY_TYPES = [
  'profile',
  'student_profile',
  'user_role',
  'academic_year',
  'semester',
  'program',
  'year_level',
  'section',
  'subject',
  'subject_offering',
  'faculty_assignment',
  'enrollment',
  'assessment',
  'assessment_version',
  'assessment_deployment',
  'assessment_generation_job',
  'question',
  'source_material',
  'exam_attempt',
  'assessment_result',
  'notification',
  'system_settings',
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
