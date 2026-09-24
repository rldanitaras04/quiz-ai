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
  Brain,
  ListMagnifyingGlass,
  Pulse,
  Gear,
  UserCircle,
  SignOut,
  BookOpen,
  ChalkboardTeacher,
  FileText,
  ListChecks,
  GitBranch,
  Clock,
  Warning,
  ChartLineUp,
  Target,
  Gauge,
  Play,
  Lock,
  Eye,
  PencilSimple,
  CheckCircle,
  CalendarBlank,
  CaretRight,
  House,
  Student,
  Clipboard,
  FileDoc,
  Bookmarks,
  FunnelSimple,
  ArrowUUpLeft,
  TreeStructure,
  Certificate,
  TrendUp,
  IdentificationCard,
  Wrench,
  ShieldCheck,
  FolderOpen,
  Stack,
  ChartPieSlice,
  Article,
} from '@phosphor-icons/react';

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
// Route Constants (canonical paths)
// ============================================================================

export const ROUTES = {
  // Public
  login: '/login',
  register: '/register',
  setup: '/setup',
  home: '/',

  // Admin
  adminDashboard: '/admin',
  adminMonitoring: '/admin/monitoring',
  adminAcademic: '/admin/academic',
  adminSubjects: '/admin/subjects',
  adminUsers: '/admin/users',
  adminAuditLogs: '/admin/audit-logs',
  adminSettings: '/admin/settings',
  adminAiConfig: '/admin/ai-config',

  // Faculty
  facultyDashboard: '/faculty',
  facultySubjects: '/faculty/subjects',

  // Student
  studentDashboard: '/student',
  studentSubjects: '/student/subjects',
  studentAssessments: '/student/assessments',
  studentResults: '/student/results',

  // Shared
  notifications: '/notifications',
  profile: '/profile',
} as const;

// ============================================================================
// Route Helpers
// ============================================================================

export const routes = {
  // Public
  login: () => ROUTES.login,
  register: () => ROUTES.register,
  home: () => ROUTES.home,

  // Admin
  admin: {
    dashboard: () => ROUTES.adminDashboard,
    monitoring: () => ROUTES.adminMonitoring,
    academic: () => ROUTES.adminAcademic,
    subjects: () => ROUTES.adminSubjects,
    users: () => ROUTES.adminUsers,
    auditLogs: () => ROUTES.adminAuditLogs,
    settings: () => ROUTES.adminSettings,
    aiConfig: () => ROUTES.adminAiConfig,
  },

  // Faculty
  faculty: {
    dashboard: () => ROUTES.facultyDashboard,
    subjects: () => ROUTES.facultySubjects,
    subject: (offeringId: string) => `/faculty/subjects/${offeringId}` as const,
    subjectStudents: (offeringId: string) => `/faculty/subjects/${offeringId}/students` as const,
    subjectAssessments: (offeringId: string) => `/faculty/subjects/${offeringId}/assessments` as const,
    subjectSources: (offeringId: string) => `/faculty/subjects/${offeringId}/sources` as const,
    subjectTopics: (offeringId: string) => `/faculty/subjects/${offeringId}/topics` as const,
    subjectQuestionBank: (offeringId: string) => `/faculty/subjects/${offeringId}/question-bank` as const,
    subjectDeployments: (offeringId: string) => `/faculty/subjects/${offeringId}/deployments` as const,
    assessment: (offeringId: string, assessmentId: string) =>
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}` as const,
    assessmentReview: (offeringId: string, assessmentId: string) =>
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}/review` as const,
    assessmentExceptions: (offeringId: string, assessmentId: string) =>
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}/exceptions` as const,
    assessmentDeploy: (offeringId: string, assessmentId: string) =>
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}/deploy` as const,
    assessmentAnalytics: (offeringId: string, assessmentId: string) =>
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}/analytics` as const,
    newAssessment: (offeringId: string) =>
      `/faculty/subjects/${offeringId}/assessments/new` as const,
  },

  // Student
  student: {
    dashboard: () => ROUTES.studentDashboard,
    subjects: () => ROUTES.studentSubjects,
    subject: (offeringId: string) => `/student/subjects/${offeringId}` as const,
    assessments: () => ROUTES.studentAssessments,
    assessment: (assessmentId: string) => `/student/assessments/${assessmentId}` as const,
    exam: (assessmentId: string, attemptId: string) =>
      `/student/assessments/${assessmentId}/exam/${attemptId}` as const,
    examResults: (assessmentId: string, attemptId: string) =>
      `/student/assessments/${assessmentId}/exam/${attemptId}/results` as const,
    results: () => ROUTES.studentResults,
  },

  // Shared
  notifications: () => ROUTES.notifications,
  profile: () => ROUTES.profile,
} as const;

// ============================================================================
// Global Navigation Configuration
// ============================================================================

export const GLOBAL_NAVIGATION: Record<UserRole, NavigationGroup[]> = {
  super_admin: [
    {
      label: 'Overview',
      items: [
        { id: 'admin-dashboard', label: 'Dashboard', href: ROUTES.adminDashboard, icon: SquaresFour, exact: true },
        { id: 'admin-monitoring', label: 'System Monitoring', href: ROUTES.adminMonitoring, icon: Pulse },
      ],
    },
    {
      label: 'Academic',
      items: [
        { id: 'admin-academic', label: 'Academic Structure', href: ROUTES.adminAcademic, icon: TreeStructure },
        { id: 'admin-subjects', label: 'Subjects / Offerings', href: ROUTES.adminSubjects, icon: Books },
      ],
    },
    {
      label: 'Access',
      items: [
        { id: 'admin-users', label: 'Users', href: ROUTES.adminUsers, icon: Users },
        { id: 'admin-audit', label: 'Audit Logs', href: ROUTES.adminAuditLogs, icon: ListMagnifyingGlass },
      ],
    },
    {
      label: 'System',
      items: [
        { id: 'admin-settings', label: 'System Settings', href: ROUTES.adminSettings, icon: Gear },
        { id: 'admin-ai', label: 'AI Configuration', href: ROUTES.adminAiConfig, icon: Brain },
      ],
    },
    {
      label: 'Account',
      items: [
        { id: 'notifications', label: 'Notifications', href: ROUTES.notifications, icon: Bell },
        { id: 'profile', label: 'Profile', href: ROUTES.profile, icon: UserCircle },
      ],
    },
  ],

  faculty: [
    {
      label: 'Teaching',
      items: [
        { id: 'faculty-dashboard', label: 'Dashboard', href: ROUTES.facultyDashboard, icon: SquaresFour, exact: true },
        { id: 'faculty-subjects', label: 'My Subjects', href: ROUTES.facultySubjects, icon: Books },
      ],
    },
    {
      label: 'Account',
      items: [
        { id: 'notifications', label: 'Notifications', href: ROUTES.notifications, icon: Bell },
        { id: 'profile', label: 'Profile', href: ROUTES.profile, icon: UserCircle },
      ],
    },
  ],

  student: [
    {
      label: 'Learning',
      items: [
        { id: 'student-dashboard', label: 'Dashboard', href: ROUTES.studentDashboard, icon: SquaresFour, exact: true },
        { id: 'student-subjects', label: 'My Subjects', href: ROUTES.studentSubjects, icon: Books },
        { id: 'student-assessments', label: 'Assessments', href: ROUTES.studentAssessments, icon: ClipboardText },
        { id: 'student-results', label: 'My Results', href: ROUTES.studentResults, icon: ChartBar },
      ],
    },
    {
      label: 'Account',
      items: [
        { id: 'notifications', label: 'Notifications', href: ROUTES.notifications, icon: Bell },
        { id: 'profile', label: 'Profile', href: ROUTES.profile, icon: UserCircle },
      ],
    },
  ],
};

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
    { id: 'assess-analytics', label: 'Analytics', href: routes.faculty.assessmentAnalytics(offeringId, assessmentId), icon: ChartLineUp },
  ];
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

/**
 * Check if a navigation item is active given the current pathname.
 */
export function isNavActive(item: NavigationItem, pathname: string): boolean {
  if (!item.href) return false;
  if (item.exact) return pathname === item.href;
  return pathname.startsWith(item.href);
}

/**
 * Get the role-specific home path.
 */
export function homePathForRole(role: UserRole): string {
  if (role === 'super_admin') return ROUTES.adminDashboard;
  if (role === 'faculty') return ROUTES.facultyDashboard;
  return ROUTES.studentDashboard;
}
