import type { QuestionType } from '@/lib/types';
import { QUESTION_TYPE_GROUP_ORDER, QUESTION_TYPE_LABELS } from '@/lib/constants';

/**
 * Display numbering for the student exam: questions stay clustered by type
 * (MCQ → Identification → True/False), and the item number restarts at 1
 * inside each type group. Within a group, items are shuffled per student when
 * the deployment uses a shuffled order; the group boundaries never break.
 */
export interface TypedExamItem<T = { id: string; question_type: QuestionType; position?: number | null }> {
  question: T;
  displayNumber: number;
  /** 0-based index of the type group in QUESTION_TYPE_GROUP_ORDER. */
  groupIndex: number;
  /** True only on the first item of each type group (for section headers). */
  isFirstInGroup: boolean;
  groupLabel: string;
}

function typeRank(type: QuestionType): number {
  const idx = QUESTION_TYPE_GROUP_ORDER.indexOf(type);
  return idx === -1 ? QUESTION_TYPE_GROUP_ORDER.length : idx;
}

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Group questions by type (stable group order), optionally shuffle inside each
 * group, then assign display numbers that restart at 1 per type.
 */
export function buildTypedExamOrder<T extends { id: string; question_type: QuestionType; position?: number | null }>(
  questions: T[],
  options: { shuffleWithinGroups?: boolean } = {}
): TypedExamItem<T>[] {
  const { shuffleWithinGroups = false } = options;

  const groups = new Map<QuestionType, T[]>();
  for (const q of questions) {
    const list = groups.get(q.question_type) ?? [];
    list.push(q);
    groups.set(q.question_type, list);
  }

  const orderedGroups: T[][] = [];
  for (const type of QUESTION_TYPE_GROUP_ORDER) {
    const list = groups.get(type);
    if (!list || list.length === 0) continue;
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    orderedGroups.push(shuffleWithinGroups ? shuffleArray(list) : list);
  }

  // Any unknown types (defensive) go last in insertion order.
  for (const [type, list] of groups) {
    if (QUESTION_TYPE_GROUP_ORDER.includes(type)) continue;
    if (!list || list.length === 0) continue;
    list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    orderedGroups.push(shuffleWithinGroups ? shuffleArray(list) : list);
  }

  const items: TypedExamItem<T>[] = [];
  for (const group of orderedGroups) {
    group.forEach((question, idx) => {
      items.push({
        question,
        displayNumber: idx + 1,
        groupIndex: typeRank(question.question_type),
        isFirstInGroup: idx === 0,
        groupLabel: QUESTION_TYPE_LABELS[question.question_type] ?? question.question_type,
      });
    });
  }
  return items;
}

/** Flat id order for the exam manifest (grouped + optionally shuffled). */
export function buildQuestionIdOrder(
  questions: { id: string; question_type: QuestionType; position?: number | null }[],
  options: { shuffleWithinGroups?: boolean } = {}
): string[] {
  return buildTypedExamOrder(questions, options).map((item) => item.question.id);
}
