import type { BadgeVariant } from '@/components/ui/Badge';

/**
 * Single source of truth for rendering a status enum as a badge.
 *
 * Every screen used to hand-roll its own label/variant map (admin dashboard,
 * monitor, analytics, enrollment tables, assessments table...), so the same
 * enum rendered in three different colors depending on the page. Key on the
 * raw enum token instead: one label, one variant, everywhere.
 *
 * Conventions:
 *   - sentence case labels ("In progress", not "In Progress");
 *   - amber = waiting on someone/something, red = failed or voided,
 *     green = live or done, gray = ended/neutral, blue = in flight;
 *   - unknown tokens fall back to humanized text + neutral badge rather than
 *     crashing or showing raw_snake_case.
 */

interface StatusPresentation {
  label: string;
  variant: BadgeVariant;
}

const PRESENTATION: Record<string, StatusPresentation> = {
  // --- lifecycle: waiting / needs work ---------------------------------
  pending: { label: 'Pending', variant: 'warning' },
  processing: { label: 'Processing', variant: 'warning' },
  draft: { label: 'Draft', variant: 'warning' },
  manual_review: { label: 'Needs review', variant: 'warning' },
  queued: { label: 'Queued', variant: 'info' },

  // --- lifecycle: in flight --------------------------------------------
  in_progress: { label: 'In progress', variant: 'info' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  approved: { label: 'Approved', variant: 'info' },
  final: { label: 'Final', variant: 'info' },
  syncing: { label: 'Syncing', variant: 'info' },
  auto_scored: { label: 'Auto-scored', variant: 'info' },

  // --- lifecycle: live / good ------------------------------------------
  active: { label: 'Active', variant: 'success' },
  published: { label: 'Published', variant: 'success' },
  released: { label: 'Released', variant: 'success' },
  ready: { label: 'Ready', variant: 'success' },
  verified: { label: 'Verified', variant: 'success' },
  completed: { label: 'Completed', variant: 'success' },
  scored: { label: 'Scored', variant: 'success' },
  enrolled: { label: 'Enrolled', variant: 'success' },
  submitted: { label: 'Submitted', variant: 'success' },
  auto_submitted: { label: 'Auto-submitted', variant: 'success' },
  success: { label: 'Success', variant: 'success' },
  synced: { label: 'Synced', variant: 'success' },
  online: { label: 'Online', variant: 'success' },

  // --- lifecycle: ended / neutral --------------------------------------
  created: { label: 'Not started', variant: 'default' },
  closed: { label: 'Closed', variant: 'default' },
  inactive: { label: 'Inactive', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'default' },
  'not_required': { label: 'Not required', variant: 'outline' },
  archived: { label: 'Archived', variant: 'outline' },

  // --- attention (time/consent) ----------------------------------------
  expired: { label: 'Expired', variant: 'warning' },
  timed_out: { label: 'Timed out', variant: 'warning' },
  offline: { label: 'Offline', variant: 'warning' },
  withdrawn: { label: 'Withdrawn', variant: 'warning' },
  warning: { label: 'Warning', variant: 'warning' },

  // --- failed / voided --------------------------------------------------
  suspended: { label: 'Suspended', variant: 'danger' },
  failed: { label: 'Failed', variant: 'danger' },
  error: { label: 'Error', variant: 'danger' },
  timeout: { label: 'Timed out', variant: 'danger' },
  invalidated: { label: 'Invalidated', variant: 'danger' },
  dropped: { label: 'Dropped', variant: 'danger' },
  critical: { label: 'Critical', variant: 'danger' },

  // --- connectivity / info ---------------------------------------------
  info: { label: 'Info', variant: 'info' },

  // --- audit actions (rendered as badges in audit logs) -----------------
  create: { label: 'Create', variant: 'info' },
  update: { label: 'Update', variant: 'default' },
  delete: { label: 'Delete', variant: 'danger' },
  publish: { label: 'Publish', variant: 'success' },
  approve: { label: 'Approve', variant: 'success' },
  submit: { label: 'Submit', variant: 'info' },
  score: { label: 'Score', variant: 'info' },
  release: { label: 'Release', variant: 'success' },
  invalidate: { label: 'Invalidate', variant: 'danger' },
  login: { label: 'Sign in', variant: 'default' },
  logout: { label: 'Sign out', variant: 'default' },
};

/** Turn an unknown enum token into readable copy: "extended_time" → "Extended time". */
function humanize(value: string): string {
  const text = value.replace(/[_-]+/g, ' ').trim();
  if (!text) return value;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Badge label for a status token (humanized fallback for unknown tokens). */
export function statusLabel(value: string): string {
  return PRESENTATION[value]?.label ?? humanize(value);
}

/** Badge variant for a status token (neutral fallback for unknown tokens). */
export function statusVariant(value: string): BadgeVariant {
  return PRESENTATION[value]?.variant ?? 'default';
}

/** Label + variant in one call, e.g. `<Badge variant={statusBadge(s).variant}>`. */
export function statusBadge(value: string): StatusPresentation {
  return PRESENTATION[value] ?? { label: humanize(value), variant: 'default' };
}

/** "super_admin" → "Super admin"; used for role columns/badges. */
export function roleLabel(role: string): string {
  return humanize(role.replace(/[_-]+/g, '_'));
}
