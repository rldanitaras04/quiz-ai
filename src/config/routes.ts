// Canonical route paths and link builders.
//
// Lives in its own dependency-free module (not `config/navigation.ts`) so that
// server components and server-only code can import `routes`/`ROUTES` without
// dragging in `@phosphor-icons/react` — navigation.ts imports the icon set for
// the sidebar, and its `createContext` calls are illegal in the React Server
// Components graph (see the same note in `config/role-paths.ts`).
// `config/navigation.ts` re-exports both for existing client callers.

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
  adminAcademicYears: '/admin/academic/years',
  adminAcademicSemesters: '/admin/academic/semesters',
  adminAcademicPrograms: '/admin/academic/programs',
  adminAcademicYearLevels: '/admin/academic/year-levels',
  adminAcademicSections: '/admin/academic/sections',
  adminSubjects: '/admin/subjects',
  adminOfferings: '/admin/subjects/offerings',
  adminUsers: '/admin/users',
  adminUsersFaculty: '/admin/users/faculty',
  adminUsersStudents: '/admin/users/students',
  adminAuditLogs: '/admin/audit-logs',
  adminSettings: '/admin/settings',
  adminAiConfig: '/admin/ai-config',
  adminAiUsage: '/admin/ai-usage',

  // Faculty
  facultyDashboard: '/faculty',
  facultySubjects: '/faculty/subjects',
  facultyProctoring: '/faculty/proctoring',

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
    academicYears: () => ROUTES.adminAcademicYears,
    academicSemesters: () => ROUTES.adminAcademicSemesters,
    academicPrograms: () => ROUTES.adminAcademicPrograms,
    academicYearLevels: () => ROUTES.adminAcademicYearLevels,
    academicSections: () => ROUTES.adminAcademicSections,
    subjects: () => ROUTES.adminSubjects,
    offerings: () => ROUTES.adminOfferings,
    users: () => ROUTES.adminUsers,
    usersFaculty: () => ROUTES.adminUsersFaculty,
    usersStudents: () => ROUTES.adminUsersStudents,
    auditLogs: () => ROUTES.adminAuditLogs,
    settings: () => ROUTES.adminSettings,
    aiConfig: () => ROUTES.adminAiConfig,
    aiUsage: () => ROUTES.adminAiUsage,
  },

  // Faculty
  faculty: {
    dashboard: () => ROUTES.facultyDashboard,
    subjects: () => ROUTES.facultySubjects,
    proctoring: () => ROUTES.facultyProctoring,
    subject: (offeringId: string) => `/faculty/subjects/${offeringId}` as const,
    subjectStudents: (offeringId: string) => `/faculty/subjects/${offeringId}/students` as const,
    subjectAssessments: (offeringId: string) => `/faculty/subjects/${offeringId}/assessments` as const,
    subjectSources: (offeringId: string) => `/faculty/subjects/${offeringId}/sources` as const,
    subjectTopics: (offeringId: string) => `/faculty/subjects/${offeringId}/topics` as const,
    subjectQuestionBank: (offeringId: string) => `/faculty/subjects/${offeringId}/question-bank` as const,
    subjectDeployments: (offeringId: string) => `/faculty/subjects/${offeringId}/deployments` as const,
    subjectResults: (offeringId: string) => `/faculty/subjects/${offeringId}/results` as const,
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
    assessmentMonitor: (offeringId: string, assessmentId: string) =>
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}/monitor` as const,
    newAssessment: (offeringId: string) =>
      `/faculty/subjects/${offeringId}/assessments/new` as const,

    // Subject-level workspace: a SECOND, live faculty route family keyed by
    // subject rather than offering. `/faculty/subjects` links into it for a
    // subject taught across several sections, so one assessment is authored
    // once for the whole subject. It was reachable only through hand-written
    // template strings, which meant nothing outside the pages themselves knew
    // these paths existed — route/link tests could drift from them silently.
    subjectWorkspace: (subjectId: string) =>
      `/faculty/subjects/subject/${subjectId}` as const,
    subjectWorkspaceNewAssessment: (subjectId: string) =>
      `/faculty/subjects/subject/${subjectId}/assessments/new` as const,
    subjectWorkspaceAssessment: (subjectId: string, assessmentId: string) =>
      `/faculty/subjects/subject/${subjectId}/assessments/${assessmentId}` as const,
    subjectWorkspaceAssessmentDeploy: (subjectId: string, assessmentId: string) =>
      `/faculty/subjects/subject/${subjectId}/assessments/${assessmentId}/deploy` as const,
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
