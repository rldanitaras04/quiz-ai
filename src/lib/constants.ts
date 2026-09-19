import type {
  UserRole,
  QuestionType,
  Difficulty,
  BloomLevel,
  AssessmentStatus,
  AttemptStatus,
} from '@/lib/types';

// ============================================================================
// Enum-like Constants
// ============================================================================

export const ROLES: readonly UserRole[] = [
  'super_admin',
  'faculty',
  'student',
] as const;

export const ROLE_PRIORITY: Record<UserRole, number> = {
  super_admin: 0,
  faculty: 1,
  student: 2,
};

export function getPrimaryRole(roles: UserRole[]): UserRole {
  return [...roles].sort((a, b) => ROLE_PRIORITY[a] - ROLE_PRIORITY[b])[0] ?? 'student';
}

export const QUESTION_TYPES: readonly QuestionType[] = [
  'multiple_choice',
  'identification',
] as const;

export const DIFFICULTY_LEVELS: readonly Difficulty[] = [
  'easy',
  'moderate',
  'difficult',
] as const;

export const BLOOM_LEVELS: readonly BloomLevel[] = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
] as const;

export const ASSESSMENT_STATUSES: readonly AssessmentStatus[] = [
  'draft',
  'approved',
  'published',
  'closed',
] as const;

export const ATTEMPT_STATUSES: readonly AttemptStatus[] = [
  'created',
  'in_progress',
  'submitted',
  'auto_submitted',
  'expired',
  'invalidated',
] as const;

// ============================================================================
// Display Labels
// ============================================================================

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Administrator',
  faculty: 'Faculty',
  student: 'Student',
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'Multiple Choice',
  identification: 'Identification',
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy',
  moderate: 'Moderate',
  difficult: 'Difficult',
};

export const BLOOM_LABELS: Record<BloomLevel, string> = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyze',
  evaluate: 'Evaluate',
  create: 'Create',
};

export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  published: 'Published',
  closed: 'Closed',
};

export const ATTEMPT_STATUS_LABELS: Record<AttemptStatus, string> = {
  created: 'Created',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  auto_submitted: 'Auto-Submitted',
  expired: 'Expired',
  invalidated: 'Invalidated',
};

// ============================================================================
// Status Colors (semantic Tailwind classes)
// ============================================================================

export const ASSESSMENT_STATUS_COLORS: Record<AssessmentStatus, string> = {
  draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  published: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  closed: 'bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300',
};

export const ATTEMPT_STATUS_COLORS: Record<AttemptStatus, string> = {
  created: 'bg-gray-100 text-gray-800 dark:bg-gray-800/50 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  submitted: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  auto_submitted: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
  expired: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  invalidated: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

// ============================================================================
// Navigation
// ============================================================================

export interface NavItem {
  label: string;
  href: string;
  icon?: string;
}

export const NAVIGATION: Record<UserRole, readonly NavItem[]> = {
  super_admin: [
    { label: 'Dashboard', href: '/admin', icon: 'home' },
    { label: 'Users', href: '/admin/users', icon: 'users' },
    { label: 'Academic Structure', href: '/admin/academic', icon: 'building' },
    { label: 'Subjects / Offerings', href: '/admin/subjects', icon: 'book' },
    { label: 'System Settings', href: '/admin/settings', icon: 'settings' },
    { label: 'AI Configuration', href: '/admin/ai-config', icon: 'cpu' },
    { label: 'Audit Logs', href: '/admin/audit-logs', icon: 'scroll' },
    { label: 'System Monitoring', href: '/admin/monitoring', icon: 'activity' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Profile', href: '/profile', icon: 'user' },
  ],
  faculty: [
    { label: 'Dashboard', href: '/faculty', icon: 'home' },
    { label: 'My Subjects', href: '/faculty/subjects', icon: 'book' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Profile', href: '/profile', icon: 'user' },
  ],
  student: [
    { label: 'Dashboard', href: '/student', icon: 'home' },
    { label: 'My Subjects', href: '/student/subjects', icon: 'book' },
    { label: 'Assessments', href: '/student/assessments', icon: 'file-text' },
    { label: 'My Results', href: '/student/results', icon: 'bar-chart' },
    { label: 'Notifications', href: '/notifications', icon: 'bell' },
    { label: 'Profile', href: '/profile', icon: 'user' },
  ],
} as const;

// ============================================================================
// Application Constants
// ============================================================================

export const DEFAULT_SIMILARITY_THRESHOLD = 0.90;

export const MAX_FILE_SIZE_MB = 50;

export const SUPPORTED_SOURCE_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
] as const;

export const SUPPORTED_SOURCE_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;

export const EXAM_WARNING_THRESHOLDS_MINUTES = [10, 5, 1] as const;

export const ITEMS_PER_PAGE = 20;

export const MAX_QUESTION_POINTS = 100;

export const MIN_QUESTION_POINTS = 1;

export const APP_NAME = 'MiMo';

export const APP_DESCRIPTION = 'AI-Assisted Secure Assessment System';
