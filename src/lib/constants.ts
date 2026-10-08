import type {
  UserRole,
  QuestionType,
  Difficulty,
  BloomLevel,
  AssessmentStatus,
  AttemptStatus,
  ExceptionType,
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
  'true_false',
] as const;

/**
 * Student-facing group order. Items are always clustered by type, and item
 * numbers restart at 1 inside each group (no continuous numbering).
 */
export const QUESTION_TYPE_GROUP_ORDER: readonly QuestionType[] = [
  'multiple_choice',
  'identification',
  'true_false',
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
  true_false: 'True or False',
};

export const QUESTION_TYPE_SHORT_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'MCQ',
  identification: 'ID',
  true_false: 'TF',
};

/** Fixed True/False choice keys used for authoring and AI/bank import. */
export const TRUE_FALSE_CHOICES = [
  { choice_key: 'T', choice_text: 'True', is_correct: true },
  { choice_key: 'F', choice_text: 'False', is_correct: false },
] as const;

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

export const EXCEPTION_TYPE_LABELS: Record<ExceptionType, string> = {
  extended_time: 'Extended Time',
  additional_attempt: 'Additional Attempt',
  schedule_override: 'Schedule Override',
  accessibility: 'Accessibility',
};

// ============================================================================
// Status Colors (design tokens)
//
// These class strings resolve through the semantic tokens declared in
// `globals.css`, so light and dark mode stay coherent without a second
// hand-written `dark:` pair per status. Prefer `statusVariant()` from
// `@/lib/status` when rendering a <Badge>; keep these maps for raw chip markup.
// ============================================================================

export const ASSESSMENT_STATUS_COLORS: Record<AssessmentStatus, string> = {
  draft: 'bg-[var(--color-warning-light)] text-[var(--color-warning)]',
  approved: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
  published: 'bg-[var(--color-success-light)] text-[var(--color-success)]',
  closed: 'bg-[var(--color-surface-hover)] text-[var(--color-muted)]',
};

export const ATTEMPT_STATUS_COLORS: Record<AttemptStatus, string> = {
  created: 'bg-[var(--color-surface-hover)] text-[var(--color-muted)]',
  in_progress: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
  submitted: 'bg-[var(--color-success-light)] text-[var(--color-success)]',
  auto_submitted: 'bg-[var(--color-warning-light)] text-[var(--color-warning)]',
  expired: 'bg-[var(--color-danger-light)] text-[var(--color-danger)]',
  invalidated: 'bg-[var(--color-danger-light)] text-[var(--color-danger)]',
};

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

export const SUPPORTED_QUESTION_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
] as const;

export const MAX_QUESTION_IMAGE_SIZE_MB = 10;

/**
 * Avatar images accepted by `uploadAvatar`. The framework ceiling that backs
 * this is `experimental.serverActions.bodySizeLimit` in `next.config.ts`,
 * which must stay above this value plus multipart overhead.
 */
export const MAX_AVATAR_SIZE_MB = 2;

export const MAX_AVATAR_BYTES = MAX_AVATAR_SIZE_MB * 1024 * 1024;

export const SUPPORTED_QUESTION_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'] as const;

export const EXAM_WARNING_THRESHOLDS_MINUTES = [10, 5, 1] as const;

export const ITEMS_PER_PAGE = 20;

export const MAX_QUESTION_POINTS = 100;

export const MIN_QUESTION_POINTS = 1;

export const APP_NAME = 'SEAMS AI';

export const APP_DESCRIPTION = 'AI-Assisted Secure Examination and Assessment System';

// ============================================================================
// Email link destinations
// ============================================================================

/**
 * Landing paths for the links Supabase Auth emails (signup confirmation,
 * approval notice, password recovery). Each must be a real page AND listed
 * in the project's redirect allowlist (Authentication -> URL Configuration):
 * GoTrue refuses a redirect that is not allowlisted, which reads to the
 * clicker as "the link is broken". Kept as constants so the route test sees
 * the literal and the code cannot drift away from the pages.
 */
export const LOGIN_PATH = '/login';

export const RESET_PASSWORD_PATH = '/reset-password';

/**
 * Origin every emailed link points at. `NEXT_PUBLIC_APP_URL` must be the
 * origin users actually open the app on (localhost while developing, the
 * real domain in production) — a link built from the wrong origin lands
 * outside the allowlist and bounces.
 */
export function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}

// ============================================================================
// Configurable Settings
// ============================================================================

/**
 * Settings a super administrator can change at runtime (/admin/settings). They
 * are stored in `system_settings` and read through `src/lib/settings.ts`; the
 * `default` here is the fallback whenever no row exists or the read fails.
 *
 * This module is client-safe on purpose: the settings form renders its labels
 * and input constraints from the same definitions the server action validates
 * against, so the two cannot drift apart.
 */
export interface SettingDef {
  label: string;
  description: string;
  default: number;
  min: number;
  max: number;
  /** Whole numbers only (megabytes, row counts) versus decimals (thresholds). */
  integer: boolean;
  step: number;
}

export const SETTING_DEFS = {
  max_upload_size_mb: {
    label: 'Maximum upload size (MB)',
    description:
      'Largest source material a faculty member may upload. The `source-materials` storage bucket caps objects at 50 MB, so this cannot be raised above that.',
    default: MAX_FILE_SIZE_MB,
    min: 1,
    max: MAX_FILE_SIZE_MB,
    integer: true,
    step: 1,
  },
  similarity_threshold: {
    label: 'Duplicate similarity threshold',
    description:
      'Cosine similarity at or above which a generated question counts as a duplicate of an existing one. Lower values flag more questions.',
    default: DEFAULT_SIMILARITY_THRESHOLD,
    min: 0.5,
    max: 1,
    integer: false,
    step: 0.01,
  },
  default_page_size: {
    label: 'Items per page',
    description:
      'How many rows a paged admin list loads at once — currently the recent entries on the audit log page.',
    default: ITEMS_PER_PAGE,
    min: 5,
    max: 100,
    integer: true,
    step: 5,
  },
  // --- Item and distractor analysis (scope §29) -----------------------------
  // "Interpretation thresholds must be configurable and treated as analytic
  // guidance, not unquestionable conclusions."
  analysis_group_percent: {
    label: 'Discrimination group size (%)',
    description:
      'Share of the top and bottom scored attempts that form the comparison groups for the discrimination index D = (RU/NU) − (RL/NL). The classic psychometric default is 27%.',
    default: 27,
    min: 5,
    max: 50,
    integer: true,
    step: 1,
  },
  analysis_pass_mark: {
    label: 'Pass mark (%)',
    description:
      'Percentage score at or above which a submitted attempt counts as passing in the analytics pass-rate.',
    default: 60,
    min: 1,
    max: 100,
    integer: true,
    step: 1,
  },
  analysis_easy_p: {
    label: 'Too-easy threshold (P ≥)',
    description:
      'Items whose difficulty index P reaches this value are flagged "too easy" for faculty review.',
    default: 0.9,
    min: 0.5,
    max: 1,
    integer: false,
    step: 0.05,
  },
  analysis_hard_p: {
    label: 'Too-hard threshold (P <)',
    description:
      'Items whose difficulty index P falls below this value are flagged "too hard" for faculty review.',
    default: 0.3,
    min: 0,
    max: 0.5,
    integer: false,
    step: 0.05,
  },
  analysis_min_disc: {
    label: 'Weak discrimination flag (D <)',
    description:
      'Items with a discrimination index below this value (but not negative) are flagged as weakly discriminating.',
    default: 0.1,
    min: 0,
    max: 0.5,
    integer: false,
    step: 0.05,
  },
  analysis_good_d: {
    label: 'Discrimination rating: Good (D ≥)',
    description:
      'Cut-off at or above which an item is rated Good. Should be higher than the Fair cut-off.',
    default: 0.3,
    min: 0,
    max: 1,
    integer: false,
    step: 0.05,
  },
  analysis_fair_d: {
    label: 'Discrimination rating: Fair (D ≥)',
    description:
      'Cut-off at or above which an item is rated Fair (below Good). Should be lower than the Good cut-off.',
    default: 0.2,
    min: 0,
    max: 1,
    integer: false,
    step: 0.05,
  },
  analysis_low_distractor_pct: {
    label: 'Low-use distractor threshold (%)',
    description:
      'Distractors selected by fewer than this share of respondents are flagged for item review.',
    default: 5,
    min: 0,
    max: 50,
    integer: true,
    step: 1,
  },
} as const satisfies Record<string, SettingDef>;

export type SettingKey = keyof typeof SETTING_DEFS;

/** Fully resolved settings: every key present, every value validated. */
export type AppSettings = { [K in SettingKey]: number };

export const SETTING_KEYS = Object.keys(SETTING_DEFS) as SettingKey[];

export const DEFAULT_SETTINGS: AppSettings = {
  max_upload_size_mb: SETTING_DEFS.max_upload_size_mb.default,
  similarity_threshold: SETTING_DEFS.similarity_threshold.default,
  default_page_size: SETTING_DEFS.default_page_size.default,
  analysis_group_percent: SETTING_DEFS.analysis_group_percent.default,
  analysis_pass_mark: SETTING_DEFS.analysis_pass_mark.default,
  analysis_easy_p: SETTING_DEFS.analysis_easy_p.default,
  analysis_hard_p: SETTING_DEFS.analysis_hard_p.default,
  analysis_min_disc: SETTING_DEFS.analysis_min_disc.default,
  analysis_good_d: SETTING_DEFS.analysis_good_d.default,
  analysis_fair_d: SETTING_DEFS.analysis_fair_d.default,
  analysis_low_distractor_pct: SETTING_DEFS.analysis_low_distractor_pct.default,
};
