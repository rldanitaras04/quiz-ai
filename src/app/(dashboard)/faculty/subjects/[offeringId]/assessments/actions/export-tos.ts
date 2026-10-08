'use server';

// TOS export payload for the docx download.
// Split out of the former single actions.ts; blocks are unchanged.

import { getFacultyAssessment } from '@/lib/auth';
import type { QuestionType, Difficulty, BloomLevel } from '@/lib/types';
import { requireUser } from './shared';

export type TosExportData = import('@/lib/export/tos-doc').TosExportData;

/**
 * Derived Table of Specifications for the assessment's current version:
 * questions grouped by topic × type × difficulty × Bloom level, with summary
 * rollups. Read-only; gated the same way as `getAssessmentDetail`.
 */
export async function getAssessmentTosExport(
  assessmentId: string
): Promise<{ data: TosExportData | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const assessment = await getFacultyAssessment(supabase, userId, assessmentId);
  if (!assessment) return { data: null, error: 'Not authorized' };
  if (!assessment.currentVersionId) {
    return { data: null, error: 'This assessment has no current version yet.' };
  }

  const { data: questions, error: qErr } = await supabase
    .from('questions')
    .select('question_type, difficulty, bloom_level, points, topic:topics(title)')
    .eq('assessment_version_id', assessment.currentVersionId);

  if (qErr) return { data: null, error: qErr.message };

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('subject:subjects(code, title), section:sections(name)')
    .eq('id', assessment.subjectOfferingId)
    .maybeSingle();

  const subject = offering?.subject
    ? Array.isArray(offering.subject)
      ? offering.subject[0]
      : offering.subject
    : null;
  const section = offering?.section
    ? Array.isArray(offering.section)
      ? offering.section[0]
      : offering.section
    : null;
  const subjectLabel = subject
    ? `${subject.code}${section ? ` - ${section.name}` : ''}`
    : null;

  const typeOrder: QuestionType[] = ['multiple_choice', 'identification', 'true_false'];
  const diffOrder: Difficulty[] = ['easy', 'moderate', 'difficult'];
  const bloomOrder: BloomLevel[] = [
    'remember',
    'understand',
    'apply',
    'analyze',
    'evaluate',
    'create',
  ];

  const byType = Object.fromEntries(typeOrder.map((t) => [t, 0])) as Record<QuestionType, number>;
  const byDifficulty = Object.fromEntries(diffOrder.map((d) => [d, 0])) as Record<Difficulty, number>;
  const byBloom = Object.fromEntries(bloomOrder.map((b) => [b, 0])) as Record<BloomLevel, number>;
  const byTopicMap = new Map<string, number>();
  const cellMap = new Map<string, TosExportRow>();

  type TosExportRow = import('@/lib/export/tos-doc').TosExportRow;

  for (const row of (questions ?? []) as Array<{
    question_type: QuestionType;
    difficulty: Difficulty;
    bloom_level: BloomLevel;
    points: number | null;
    topic: { title: string } | { title: string }[] | null;
  }>) {
    const topicTitle =
      (Array.isArray(row.topic) ? row.topic[0]?.title : row.topic?.title) ?? 'General';
    const count = 1;

    byType[row.question_type] = (byType[row.question_type] ?? 0) + count;
    byDifficulty[row.difficulty] = (byDifficulty[row.difficulty] ?? 0) + count;
    byBloom[row.bloom_level] = (byBloom[row.bloom_level] ?? 0) + count;
    byTopicMap.set(topicTitle, (byTopicMap.get(topicTitle) ?? 0) + count);

    const key = [topicTitle, row.question_type, row.difficulty, row.bloom_level].join('|');
    const existing = cellMap.get(key);
    if (existing) existing.count += count;
    else {
      cellMap.set(key, {
        topic: topicTitle,
        question_type: row.question_type,
        difficulty: row.difficulty,
        bloom_level: row.bloom_level,
        count,
      });
    }
  }

  const totalItems = (questions ?? []).length;
  const totalPoints = (questions ?? []).reduce((sum, q) => sum + ((q as { points?: number | null }).points ?? 0), 0);

  const rows = [...cellMap.values()].sort((a, b) => {
    const topicCmp = a.topic.localeCompare(b.topic);
    if (topicCmp !== 0) return topicCmp;
    const typeCmp = typeOrder.indexOf(a.question_type) - typeOrder.indexOf(b.question_type);
    if (typeCmp !== 0) return typeCmp;
    const diffCmp = diffOrder.indexOf(a.difficulty) - diffOrder.indexOf(b.difficulty);
    if (diffCmp !== 0) return diffCmp;
    return bloomOrder.indexOf(a.bloom_level) - bloomOrder.indexOf(b.bloom_level);
  });

  return {
    data: {
      assessmentTitle: assessment.title,
      subjectLabel,
      totalItems,
      totalPoints,
      rows,
      byType,
      byDifficulty,
      byBloom,
      byTopic: [...byTopicMap.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => a.topic.localeCompare(b.topic)),
    },
  };
}

