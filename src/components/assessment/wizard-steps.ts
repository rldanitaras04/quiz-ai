import type { AssessmentCreationMode } from '@/lib/types';

export type StepId =
  | 'mode'
  | 'basic'
  | 'sources'
  | 'genConfig'
  | 'custom'
  | 'generate'
  | 'manual'
  | 'bank'
  | 'importExam'
  | 'review'
  | 'approve';

/**
 * Steps + progress-labels per creation mode. Shared by both wizard routes
 * (offering-scoped and subject-scoped) so the flows cannot drift apart.
 */
export const STEP_CONFIG: Record<AssessmentCreationMode, { ids: StepId[]; labels: string[] }> = {
  ai: {
    ids: ['mode', 'basic', 'sources', 'genConfig', 'custom', 'generate', 'review', 'approve'],
    labels: ['Creation Mode', 'Basic Info', 'Source Materials', 'Generation Config', 'Custom Instructions', 'Generate', 'Review & Edit', 'Approve & Schedule'],
  },
  manual: {
    ids: ['mode', 'basic', 'manual', 'review', 'approve'],
    labels: ['Creation Mode', 'Basic Info', 'Manual Questions', 'Review & Edit', 'Approve & Schedule'],
  },
  bank: {
    ids: ['mode', 'basic', 'bank', 'review', 'approve'],
    labels: ['Creation Mode', 'Basic Info', 'Question Bank', 'Review & Edit', 'Approve & Schedule'],
  },
  mixed: {
    ids: ['mode', 'basic', 'manual', 'bank', 'review', 'approve'],
    labels: ['Creation Mode', 'Basic Info', 'Manual Questions', 'Question Bank', 'Review & Edit', 'Approve & Schedule'],
  },
  upload: {
    ids: ['mode', 'basic', 'importExam', 'review', 'approve'],
    labels: ['Creation Mode', 'Basic Info', 'Upload Exam', 'Review & Edit', 'Approve & Schedule'],
  },
};
