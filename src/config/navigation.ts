import type { ElementType } from 'react';
import type { UserRole } from '@/lib/types';
import {
  SquaresFour,
  Books,
  ClipboardText,
  Database,
  ChartBar,
  Bell,
  Users,
  GraduationCap,
  ListMagnifyingGlass,
  Pulse,
  Gear,
  UserCircle,
  ChalkboardTeacher,
  ListChecks,
  Warning,
  ChartLineUp,
  CalendarBlank,
  CalendarCheck,
  Buildings,
  UsersThree,
  House,
  Student,
  Clipboard,
  TreeStructure,
  Wrench,
  FolderOpen,
  Stack,
  Binoculars,
} from '@phosphor-icons/react';
import { ROUTES, routes } from "./routes.ts";

// ============================================================================
// Types
// ============================================================================

export interface NavigationItem {
  id: string;
  label: string;
  href?: string;
  icon: ElementType;
  /** Roles that can see this item. Empty = all roles. */
  roles?: UserRole[];
  /** Whether this is a contextual item (shown inside a workspace, not global sidebar). */
  contextual?: boolean;
  /** Nested children for dropdown/accordion rendering. */
  children?: NavigationItem[];
  /** Exact match for active state (instead of prefix match). */
  exact?: boolean;
  /** Whether this item is disabled. */
  disabled?: boolean;
  /** Badge count or label (e.g., notification count). */
  badge?: string | number;
  /** Compact label for the mobile bottom bar (falls back to `label`). */
  shortLabel?: string;
  /** Kept off the mobile bottom bar; surfaced through the "More" sheet instead. */
  hideOnBottom?: boolean;
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export interface ContextualNavigationConfig {
  /** Global sidebar items for this context (replaces or augments the global nav). */
  sidebar?: NavigationItem[];
  /** Breadcrumb items for this context. */
  breadcrumbs: BreadcrumbItem[];
  /** Page title. */
  title: string;
  /** Page description. */
  description?: string;
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

// ============================================================================
// Routes
// ============================================================================
//
// Re-exported from `config/routes.ts` so existing client callers keep working.
// Server components must import from `@/config/routes` directly: importing
// THIS module pulls in the phosphor icon set below, whose `createContext`
// calls are illegal in the React Server Components graph (see the same note
// in `config/role-paths.ts`).

export { ROUTES, routes } from "./routes.ts";

// ============================================================================
// Global Navigation Configuration
// ============================================================================

export const GLOBAL_NAVIGATION: Record<UserRole, NavigationGroup[]> = {
  super_admin: [
    {
      // "What is happening right now" leads: system health sits beside the
      // dashboard rather than buried under System.
      label: 'Overview',
      items: [
        { id: 'admin-dashboard', label: 'Dashboard', href: ROUTES.adminDashboard, icon: SquaresFour, exact: true },
        { id: 'admin-monitoring', label: 'System Monitoring', href: ROUTES.adminMonitoring, icon: Pulse, exact: true },
        // Assignment administration for a role that has no faculty workspace:
        // admins reach proctoring through this shared page (scope §42).
        { id: 'admin-proctoring', label: 'Proctoring', href: ROUTES.facultyProctoring, icon: Binoculars },
      ],
    },
    {
      // Flat rather than a nested accordion: three related lists read faster
      // when visible at once, and the collapsed rail no longer has to expand
      // itself just to reveal a child.
      label: 'People',
      items: [
        { id: 'admin-users', label: 'All Users', href: ROUTES.adminUsers, icon: Users, exact: true },
        { id: 'admin-users-faculty', label: 'Faculty', href: ROUTES.adminUsersFaculty, icon: ChalkboardTeacher },
        { id: 'admin-users-students', label: 'Students', href: ROUTES.adminUsersStudents, icon: Student },
      ],
    },
    {
      // The five academic-type pages live behind the Academic Structure hub
      // (contextual rail via getAcademicWorkspaceNav), so the global sidebar
      // stays one line instead of a permanent six-item accordion.
      label: 'Academics',
      items: [
        { id: 'admin-academic', label: 'Academic Structure', href: ROUTES.adminAcademic, icon: GraduationCap, exact: true },
        { id: 'admin-subjects', label: 'Subjects', href: ROUTES.adminSubjects, icon: Books, exact: true },
        { id: 'admin-offerings', label: 'Subject Offerings', href: ROUTES.adminOfferings, icon: ClipboardText, exact: true },
      ],
    },
    {
      // AI is configuration, not a product area of its own, so its parent
      // accordion is gone and the two pages sit with the rest of System.
      label: 'System',
      items: [
        { id: 'admin-ai-config', label: 'AI Configuration', href: ROUTES.adminAiConfig, icon: Wrench },
        { id: 'admin-ai-usage', label: 'AI Usage', href: ROUTES.adminAiUsage, icon: ChartLineUp },
        { id: 'admin-audit', label: 'Audit Logs', href: ROUTES.adminAuditLogs, icon: ListMagnifyingGlass, exact: true },
        { id: 'admin-settings', label: 'Settings', href: ROUTES.adminSettings, icon: Gear, exact: true },
      ],
    },
    {
      label: 'Account',
      items: [
        { id: 'notifications', label: 'Notifications', href: ROUTES.notifications, icon: Bell },
        { id: 'profile', label: 'Profile', href: ROUTES.profile, icon: UserCircle, hideOnBottom: true },
      ],
    },
  ],

  faculty: [
    {
      label: 'Overview',
      items: [
        { id: 'faculty-dashboard', label: 'Dashboard', href: ROUTES.facultyDashboard, icon: SquaresFour, exact: true },
        { id: 'faculty-proctoring', label: 'Proctoring', href: ROUTES.facultyProctoring, icon: Binoculars },
      ],
    },
    {
      label: 'Assessments',
      items: [
        { id: 'faculty-subjects', label: 'My Subjects', href: ROUTES.facultySubjects, icon: Books, shortLabel: 'Subjects' },
      ],
    },
    {
      label: 'Account',
      items: [
        { id: 'notifications', label: 'Notifications', href: ROUTES.notifications, icon: Bell },
        { id: 'profile', label: 'Profile', href: ROUTES.profile, icon: UserCircle, hideOnBottom: true },
      ],
    },
  ],

  student: [
    {
      label: 'Overview',
      items: [
        { id: 'student-dashboard', label: 'Dashboard', href: ROUTES.studentDashboard, icon: SquaresFour, exact: true },
      ],
    },
    {
      label: 'Academic',
      items: [
        { id: 'student-subjects', label: 'My Subjects', href: ROUTES.studentSubjects, icon: Books, shortLabel: 'Subjects' },
        { id: 'student-assessments', label: 'My Assessments', href: ROUTES.studentAssessments, icon: ClipboardText, shortLabel: 'Assessments' },
        { id: 'student-results', label: 'My Results', href: ROUTES.studentResults, icon: ChartBar, shortLabel: 'Results' },
      ],
    },
    {
      label: 'Account',
      items: [
        { id: 'notifications', label: 'Notifications', href: ROUTES.notifications, icon: Bell, hideOnBottom: false },
        { id: 'profile', label: 'Profile', href: ROUTES.profile, icon: UserCircle, hideOnBottom: true },
      ],
    },
  ],
};

// ============================================================================
// Admin Academic Structure Workspace Navigation
// ============================================================================

/**
 * Contextual rail for `/admin/academic/**`: the global sidebar carries a
 * single "Academic Structure" entry, and these six views (hub + one per
 * academic type) surface inside the workspace rail while you are there.
 */
export function getAcademicWorkspaceNav(): NavigationItem[] {
  return [
    { id: 'academic-overview', label: 'Overview', href: ROUTES.adminAcademic, icon: SquaresFour, exact: true },
    { id: 'academic-years', label: 'Academic Years', href: ROUTES.adminAcademicYears, icon: CalendarBlank, exact: true },
    { id: 'academic-semesters', label: 'Semesters', href: ROUTES.adminAcademicSemesters, icon: CalendarCheck, exact: true },
    { id: 'academic-programs', label: 'Programs', href: ROUTES.adminAcademicPrograms, icon: Buildings, exact: true },
    { id: 'academic-year-levels', label: 'Year Levels', href: ROUTES.adminAcademicYearLevels, icon: TreeStructure, exact: true },
    { id: 'academic-sections', label: 'Sections', href: ROUTES.adminAcademicSections, icon: UsersThree, exact: true },
  ];
}

// ============================================================================
// Faculty Subject Workspace Navigation
// ============================================================================

export function getSubjectWorkspaceNav(offeringId: string): NavigationItem[] {
  return [
    { id: 'subject-overview', label: 'Overview', href: routes.faculty.subject(offeringId), icon: House, exact: true },
    { id: 'subject-students', label: 'Students', href: routes.faculty.subjectStudents(offeringId), icon: Student },
    { id: 'subject-assessments', label: 'Assessments', href: routes.faculty.subjectAssessments(offeringId), icon: Clipboard },
    { id: 'subject-sources', label: 'Source Materials', href: routes.faculty.subjectSources(offeringId), icon: FolderOpen },
    { id: 'subject-topics', label: 'Topics', href: `/faculty/subjects/${offeringId}/topics` as const, icon: Stack },
    { id: 'subject-bank', label: 'Question Bank', href: `/faculty/subjects/${offeringId}/question-bank` as const, icon: Database },
    { id: 'subject-deployments', label: 'Deployments', href: routes.faculty.subjectDeployments(offeringId), icon: CalendarBlank },
    { id: 'subject-results', label: 'Results', href: routes.faculty.subjectResults(offeringId), icon: ChartBar },
  ];
}

// ============================================================================
// Faculty Assessment Workspace Navigation
// ============================================================================

export function getAssessmentWorkspaceNav(offeringId: string, assessmentId: string): NavigationItem[] {
  return [
    { id: 'assess-overview', label: 'Overview', href: routes.faculty.assessment(offeringId, assessmentId), icon: House },
    { id: 'assess-review', label: 'Questions', href: routes.faculty.assessmentReview(offeringId, assessmentId), icon: ListChecks },
    { id: 'assess-exceptions', label: 'Student Exceptions', href: routes.faculty.assessmentExceptions(offeringId, assessmentId), icon: Warning },
    { id: 'assess-deploy', label: 'Deployment & Schedule', href: routes.faculty.assessmentDeploy(offeringId, assessmentId), icon: CalendarBlank },
    { id: 'assess-monitor', label: 'Live Monitor', href: routes.faculty.assessmentMonitor(offeringId, assessmentId), icon: Pulse },
    { id: 'assess-analytics', label: 'Analytics', href: routes.faculty.assessmentAnalytics(offeringId, assessmentId), icon: ChartLineUp },
  ];
}

/**
 * Narrow the assessment workspace tabs to what a proctor-only viewer may open
 * (scope §42): the Live Monitor. Every other tab lives behind a faculty guard
 * this viewer is not part of, so leaving them visible would only bounce them
 * out of the page they are allowed to use.
 */
export function proctorOnlyWorkspaceNav(items: NavigationItem[]): NavigationItem[] {
  return items.filter((item) => item.id === 'assess-monitor');
}

// ============================================================================
// Student Subject Workspace Navigation
// ============================================================================

export function getStudentSubjectNav(offeringId: string): NavigationItem[] {
  return [
    { id: 'student-subject-overview', label: 'Overview', href: routes.student.subject(offeringId), icon: House, exact: true },
    { id: 'student-subject-assessments', label: 'Assessments', href: `/student/subjects/${offeringId}#assessments`, icon: Clipboard },
    { id: 'student-subject-results', label: 'Results', href: `/student/subjects/${offeringId}#results`, icon: ChartBar },
  ];
}

// ============================================================================
// Navigation Resolver Functions
// ============================================================================

/**
 * Get global navigation for a role.
 * This is the single source of truth for sidebar navigation.
 */
export function getNavigationForRole(role: UserRole): NavigationGroup[] {
  return GLOBAL_NAVIGATION[role] ?? [];
}

/**
 * Get all navigation items (flattened) for a role.
 */
export function getFlatNavigation(role: UserRole): NavigationItem[] {
  return GLOBAL_NAVIGATION[role]?.flatMap((group) => group.items) ?? [];
}

// ============================================================================
// Mobile Bottom Navigation
// ============================================================================

/**
 * Ids that sit on the mobile bottom bar, in order. Referenced from
 * `GLOBAL_NAVIGATION` by id so the bottom bar can never define a second route:
 * resolving an unknown id simply drops the slot.
 */
const BOTTOM_NAV_IDS: Partial<Record<UserRole, string[]>> = {
  student: ['student-dashboard', 'student-subjects', 'student-assessments', 'student-results'],
  faculty: ['faculty-dashboard', 'faculty-subjects', 'notifications'],
};

export interface BottomNavigation {
  /** Primary slots pinned to the bottom bar (may be fewer than requested). */
  primary: NavigationItem[];
  /** Everything else, surfaced inside the "More" sheet. */
  overflow: NavigationItem[];
}

/**
 * Resolve the mobile bottom navigation for a role from the one centralized
 * configuration. Desktop sidebar, mobile drawer, and bottom bar all read the
 * same `GLOBAL_NAVIGATION` rows.
 */
export function getBottomNavigationForRole(role: UserRole): BottomNavigation {
  const ids = BOTTOM_NAV_IDS[role];
  const flat = getFlatNavigation(role);
  if (!ids || ids.length === 0) return { primary: [], overflow: flat };

  const byId = new Map(flat.map((item) => [item.id, item]));
  const primary = ids
    .map((id) => byId.get(id))
    .filter((item): item is NavigationItem => Boolean(item) && !item!.disabled);

  const primaryIds = new Set(primary.map((item) => item.id));
  const overflow = flat.filter((item) => !primaryIds.has(item.id) && !item.hideOnBottom);

  return { primary, overflow };
}

/** Slot count for the bar: primary entries plus the trailing "More" control. */
export function hasBottomNavigation(role: UserRole): boolean {
  return (BOTTOM_NAV_IDS[role]?.length ?? 0) > 0;
}

// ============================================================================
// Full-screen routes (navigation chrome is suppressed here)
// ============================================================================

// The secure exam ATTEMPT screen only. Its `/results` sub-route is a normal
// dashboard page — it keeps the top bar and bottom navigation (the student is
// done taking the exam by then).
const SECURE_EXAM_ROUTE = /^\/student\/assessments\/[^/]+\/exam\/[^/]+\/?$/;

/**
 * Routes that must render without any application chrome: no sidebar, no top
 * bar, no bottom navigation. Matches the route segment, never a bare substring.
 */
export function isFullScreenRoute(pathname: string): boolean {
  return SECURE_EXAM_ROUTE.test(pathname);
}

/**
 * Check if a navigation item is active given the current pathname.
 * Items with children are active when any descendant matches, so nested
 * routes light up both the child and its parent group context.
 *
 * Prefix matches are segment-aware: `/student/assessments` matches
 * `/student/assessments/abc` but not `/student/assessments-archive`.
 */
export function isNavActive(item: NavigationItem, pathname: string): boolean {
  if (item.children && item.children.length > 0) {
    return item.children.some((child) => isNavActive(child, pathname));
  }
  if (!item.href) return false;
  const [target] = item.href.split('#');
  if (item.exact) return pathname === target || pathname === `${target}/`;
  if (pathname === target) return true;
  return pathname.startsWith(`${target.replace(/\/$/, '')}/`);
}

// Role-specific home path lives in `./role-paths` so that server-only modules
// (lib/auth.ts) can share the same definition without pulling this file's
// client-only icon imports into the React Server Components graph.
