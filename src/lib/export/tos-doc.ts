import { HeadingLevel } from 'docx';
import {
  BLOOM_LABELS,
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
} from '@/lib/constants';
import type { BloomLevel, Difficulty, QuestionType } from '@/lib/types';
import {
  buildDocument,
  heading,
  paragraph,
  simpleTable,
} from '@/lib/export/docx';

export interface TosExportRow {
  topic: string;
  question_type: QuestionType;
  difficulty: Difficulty;
  bloom_level: BloomLevel;
  count: number;
}

export interface TosExportData {
  assessmentTitle: string;
  subjectLabel: string | null;
  totalItems: number;
  totalPoints: number;
  rows: TosExportRow[];
  byType: Record<QuestionType, number>;
  byDifficulty: Record<Difficulty, number>;
  byBloom: Record<BloomLevel, number>;
  byTopic: { topic: string; count: number }[];
}

export function buildTosDocument(data: TosExportData): ReturnType<typeof buildDocument> {
  const children = [
    heading('Table of Specifications', HeadingLevel.HEADING_1),
    paragraph(data.assessmentTitle, { bold: true, spacing: { after: 60 } }),
    paragraph(
      [
        data.subjectLabel ? `Subject: ${data.subjectLabel}` : null,
        `Total items: ${data.totalItems}`,
        `Total points: ${data.totalPoints}`,
      ]
        .filter(Boolean)
        .join('  ·  ')
    ),
    heading('Summary by question type'),
    simpleTable(
      ['Type', 'Items'],
      (Object.keys(data.byType) as QuestionType[]).map((type) => [
        QUESTION_TYPE_LABELS[type],
        data.byType[type],
      ])
    ),
    heading('Summary by difficulty'),
    simpleTable(
      ['Difficulty', 'Items'],
      (Object.keys(data.byDifficulty) as Difficulty[]).map((level) => [
        DIFFICULTY_LABELS[level],
        data.byDifficulty[level],
      ])
    ),
    heading("Summary by Bloom's level"),
    simpleTable(
      ['Bloom\u2019s level', 'Items'],
      (Object.keys(data.byBloom) as BloomLevel[]).map((level) => [
        BLOOM_LABELS[level],
        data.byBloom[level],
      ])
    ),
    heading('Topic distribution'),
    simpleTable(
      ['Topic', 'Items'],
      data.byTopic.map((row) => [row.topic, row.count])
    ),
    heading('Specification matrix'),
    simpleTable(
      ['Topic', 'Type', 'Difficulty', 'Bloom\u2019s level', 'Items'],
      data.rows.map((row) => [
        row.topic,
        QUESTION_TYPE_LABELS[row.question_type],
        DIFFICULTY_LABELS[row.difficulty],
        BLOOM_LABELS[row.bloom_level],
        row.count,
      ])
    ),
  ];

  return buildDocument(children);
}
