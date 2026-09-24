'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { DIFFICULTY_LABELS, BLOOM_LABELS } from '@/lib/constants';
import type { Difficulty, BloomLevel, QuestionType } from '@/lib/types';

interface TOSRow {
  topic: string;
  question_type: QuestionType;
  difficulty: Difficulty;
  bloom_level: BloomLevel;
  count: number;
}

interface TOSBuilderProps {
  assessmentTitle: string;
  topics: string[];
  onSave: (tos: TOSRow[], totalItems: number) => void;
  onCancel: () => void;
}

const QUESTION_TYPES: QuestionType[] = ['multiple_choice', 'identification', 'true_false'];
const DIFFICULTIES: Difficulty[] = ['easy', 'moderate', 'difficult'];
const BLOOM_LEVELS: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

export default function TOSBuilder({
  assessmentTitle,
  topics,
  onSave,
  onCancel,
}: TOSBuilderProps) {
  const [rows, setRows] = useState<TOSRow[]>(() => {
    const initial: TOSRow[] = [];
    for (const topic of topics) {
      for (const qType of QUESTION_TYPES) {
        for (const diff of DIFFICULTIES) {
          for (const bloom of BLOOM_LEVELS) {
            initial.push({
              topic,
              question_type: qType,
              difficulty: diff,
              bloom_level: bloom,
              count: 0,
            });
          }
        }
      }
    }
    return initial;
  });

  const updateCount = (index: number, count: number) => {
    setRows(prev => prev.map((row, i) => i === index ? { ...row, count: Math.max(0, count) } : row));
  };

  const totalItems = rows.reduce((sum, row) => sum + row.count, 0);

  const totalByType = (type: QuestionType) =>
    rows.filter(r => r.question_type === type).reduce((sum, r) => sum + r.count, 0);

  const totalByDifficulty = (diff: Difficulty) =>
    rows.filter(r => r.difficulty === diff).reduce((sum, r) => sum + r.count, 0);

  const totalByBloom = (bloom: BloomLevel) =>
    rows.filter(r => r.bloom_level === bloom).reduce((sum, r) => sum + r.count, 0);

  const totalByTopic = (topic: string) =>
    rows.filter(r => r.topic === topic).reduce((sum, r) => sum + r.count, 0);

  const handleSave = () => {
    if (totalItems === 0) {
      notifyError('TOS is empty', 'Add at least one question to the TOS.');
      return;
    }
    onSave(rows, totalItems);
    notifySuccess('TOS saved', `${totalItems} questions planned.`);
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold text-foreground">Table of Specifications</h3>
        <p className="text-sm text-muted">Plan the distribution of questions across topics, types, difficulty, and Bloom&apos;s levels</p>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Summary */}
          <div className="flex flex-wrap gap-3">
            <Badge variant="info">Total: {totalItems} items</Badge>
            <Badge variant="default">MCQ: {totalByType('multiple_choice')}</Badge>
            <Badge variant="default">ID: {totalByType('identification')}</Badge>
            <Badge variant="success">Easy: {totalByDifficulty('easy')}</Badge>
            <Badge variant="warning">Moderate: {totalByDifficulty('moderate')}</Badge>
            <Badge variant="danger">Difficult: {totalByDifficulty('difficult')}</Badge>
          </div>

          {/* Bloom's Distribution */}
          <div>
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Bloom&apos;s Distribution</h4>
            <div className="flex flex-wrap gap-2">
              {BLOOM_LEVELS.map(bloom => (
                <Badge key={bloom} variant="default">
                  {BLOOM_LABELS[bloom]}: {totalByBloom(bloom)}
                </Badge>
              ))}
            </div>
          </div>

          {/* Topic Summary */}
          <div>
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">Topic Distribution</h4>
            <div className="flex flex-wrap gap-2">
              {topics.map(topic => (
                <Badge key={topic} variant="info">
                  {topic}: {totalByTopic(topic)}
                </Badge>
              ))}
            </div>
          </div>

          {/* TOS Matrix */}
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Topic</TH>
                  <TH>Type</TH>
                  <TH>Difficulty</TH>
                  <TH>Bloom&apos;s Level</TH>
                  <TH align="right">Count</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row, index) => (
                  <TR key={index}>
                    <TD className="text-sm">{row.topic}</TD>
                    <TD className="text-sm">
                      {row.question_type === 'multiple_choice'
                        ? 'MCQ'
                        : row.question_type === 'true_false'
                          ? 'TF'
                          : 'ID'}
                    </TD>
                    <TD className="text-sm">
                      {DIFFICULTY_LABELS[row.difficulty]}
                    </TD>
                    <TD className="text-sm">
                      {BLOOM_LABELS[row.bloom_level]}
                    </TD>
                    <TD numeric>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={row.count}
                        onChange={(e) => updateCount(index, parseInt(e.target.value, 10) || 0)}
                        className="w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-center text-[var(--color-foreground)]"
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="primary" onClick={handleSave}>
              Save TOS ({totalItems} items)
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
