'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { DIFFICULTY_LABELS, BLOOM_LABELS } from '@/lib/constants';
import { generateAssessmentTOS } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import { tosMarginals, tosPercent, validateTos } from '@/lib/ai/tos';
import type { WizardState } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/new/page';
import type {
  QuestionType,
  Difficulty,
  BloomLevel,
  Topic,
  TosRow,
} from '@/lib/types';

interface StepTosProps {
  state: WizardState;
  onUpdate: (updates: Partial<WizardState>) => void;
  offeringId: string;
  errors: Record<string, string>;
  topics: Topic[];
}

const TYPE_LABELS: Record<QuestionType, string> = {
  multiple_choice: 'MCQ',
  identification: 'ID',
  true_false: 'TF',
};

const ALL_TYPES: QuestionType[] = ['multiple_choice', 'identification', 'true_false'];
const ALL_DIFFICULTIES: Difficulty[] = ['easy', 'moderate', 'difficult'];
const ALL_BLOOM: BloomLevel[] = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
];

/**
 * Table of Specifications step (scope §10): generate a proposed TOS with AI,
 * edit it manually, validate totals and percentages, and approve it — the
 * approval gates entry to the AI generation step and is snapshotted onto the
 * assessment version at approval time (approveAssessment).
 *
 * Approval also syncs the marginals back into the generation config, so what
 * gets generated is exactly what the approved TOS planned. Any later edit to
 * the rows (or to the config the TOS derives from) returns the TOS to draft.
 */
export default function StepTos({
  state,
  onUpdate,
  offeringId,
  errors,
  topics,
}: StepTosProps): JSX.Element {
  const rows = state.tos?.rows ?? [];
  const approved = state.tos?.status === 'approved';

  const [generating, setGenerating] = useState(false);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState('');
  const [newType, setNewType] = useState<QuestionType>('multiple_choice');
  const [newDifficulty, setNewDifficulty] = useState<Difficulty>('moderate');
  const [newBloom, setNewBloom] = useState<BloomLevel>('understand');
  const [newCount, setNewCount] = useState('1');

  const targets = {
    countPerType: state.countPerType,
    difficulty: state.difficultyDistribution,
    bloom: state.bloomDistribution,
  };
  const targetTotal = ALL_TYPES.reduce((sum, t) => sum + (state.countPerType[t] || 0), 0);
  const marginals = tosMarginals(rows);
  const validation = validateTos(rows, targets);

  /** Every row edit drops the TOS back to draft — approval must be explicit. */
  const setRows = (next: TosRow[], notice: string[] = []) => {
    onUpdate({ tos: { rows: next, status: 'draft', approvedAt: null } });
    setAiWarnings(notice);
  };

  const handleGenerate = async () => {
    if (generating) return;
    if (topics.length === 0) {
      notifyError('No topics', 'Add at least one topic for the subject before proposing a TOS.');
      return;
    }

    setGenerating(true);
    const result = await generateAssessmentTOS({
      offeringId,
      topics: topics.map((t) => ({ title: t.title, description: t.description })),
      countPerType: state.countPerType,
      difficultyDistribution: state.difficultyDistribution,
      bloomDistribution: state.bloomDistribution,
      assessmentCategory: state.assessmentCategory,
      sourceTitles: state.sourceMaterials.map((s) => s.title).filter(Boolean),
    });
    setGenerating(false);

    if (!result.success || !result.rows) {
      notifyError('Could not propose a TOS', result.error ?? 'The AI returned nothing usable.');
      return;
    }
    setRows(result.rows, result.validation?.warnings ?? []);
    notifySuccess(
      'Proposed TOS ready',
      `${result.validation?.totalItems ?? 0} items planned — review the totals, then approve.`
    );
  };

  const handleAddRow = () => {
    const topic = newTopic.trim();
    const count = Math.round(Number(newCount));
    if (!topic) {
      notifyError('Topic required', 'Pick an existing topic or type a new one.');
      return;
    }
    if (!Number.isFinite(count) || count < 1) {
      notifyError('Count required', 'Each row needs a whole-number count of at least 1.');
      return;
    }

    // Merge with an identical combination instead of duplicating the row.
    const existing = rows.find(
      (r) =>
        r.topic.toLowerCase() === topic.toLowerCase() &&
        r.question_type === newType &&
        r.difficulty === newDifficulty &&
        r.bloom_level === newBloom
    );
    const next = existing
      ? rows.map((r) => (r === existing ? { ...r, count: r.count + count } : r))
      : [...rows, { topic, question_type: newType, difficulty: newDifficulty, bloom_level: newBloom, count }];
    setRows(next);
    setNewTopic('');
    setNewCount('1');
  };

  const handleCountChange = (index: number, raw: string) => {
    const value = parseInt(raw, 10);
    const next = rows.map((row, i) =>
      i === index ? { ...row, count: Number.isFinite(value) ? Math.max(0, value) : 0 } : row
    );
    setRows(next);
  };

  const handleDelete = (index: number) => {
    setRows(rows.filter((_, i) => i !== index));
  };

  const handleApprove = () => {
    if (validation.problems.length > 0) {
      notifyError('TOS has problems', validation.problems[0]);
      return;
    }
    const typeCounts: Record<QuestionType, number> = {
      multiple_choice: marginals.byType.multiple_choice ?? 0,
      identification: marginals.byType.identification ?? 0,
      true_false: marginals.byType.true_false ?? 0,
    };
    onUpdate({
      tos: { rows, status: 'approved', approvedAt: new Date().toISOString() },
      // The approved TOS becomes the generation config — generation follows
      // exactly what was planned and validated here.
      questionTypes: ALL_TYPES.filter((t) => typeCounts[t] > 0),
      countPerType: typeCounts,
      difficultyDistribution: {
        easy: marginals.byDifficulty.easy ?? 0,
        moderate: marginals.byDifficulty.moderate ?? 0,
        difficult: marginals.byDifficulty.difficult ?? 0,
      },
      bloomDistribution: {
        remember: marginals.byBloom.remember ?? 0,
        understand: marginals.byBloom.understand ?? 0,
        apply: marginals.byBloom.apply ?? 0,
        analyze: marginals.byBloom.analyze ?? 0,
        evaluate: marginals.byBloom.evaluate ?? 0,
        create: marginals.byBloom.create ?? 0,
      },
    });
    setAiWarnings([]);
    notifySuccess('TOS approved', `${marginals.totalItems} items planned — generation will follow this blueprint.`);
  };

  const pctBadge = (label: string, value: number) => (
    <Badge key={label} variant="default">
      {label}: {value} ({tosPercent(value, marginals.totalItems)}%)
    </Badge>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Table of Specifications
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Plan how items are distributed across topics, question types, difficulty, and
          Bloom&apos;s levels. Propose a blueprint with AI or build it manually — validate the
          totals, then approve it before generating questions.
        </p>
      </div>

      {approved && state.tos?.approvedAt && (
        <div
          className="p-4 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[var(--color-success)]/10"
          role="status"
        >
          <p className="text-sm font-medium text-[var(--color-success)]">
            Approved blueprint — {marginals.totalItems} items planned
            {state.tos.approvedAt
              ? ` (approved ${new Date(state.tos.approvedAt).toLocaleString()})`
              : ''}
          </p>
          <p className="text-xs text-[var(--color-muted)] mt-1">
            Editing any row returns the TOS to draft and requires re-approval.
          </p>
        </div>
      )}

      {/* Targets from the generation config */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-foreground">Generation targets</h3>
          <p className="text-sm text-muted">
            What the generation config asks for — approving a TOS updates these to match the plan.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge variant="info">Total: {targetTotal} items</Badge>
            {ALL_TYPES.filter((t) => (state.countPerType[t] || 0) > 0).map((t) => (
              <Badge key={t} variant="default">
                {TYPE_LABELS[t]}: {state.countPerType[t]}
              </Badge>
            ))}
            {ALL_DIFFICULTIES.map((d) => pctBadge(`Target ${DIFFICULTY_LABELS[d]}`, state.difficultyDistribution[d] ?? 0))}
            {ALL_BLOOM.map((b) => pctBadge(BLOOM_LABELS[b], state.bloomDistribution[b] ?? 0))}
          </div>
        </CardContent>
      </Card>

      {/* AI proposal */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-foreground">Propose with AI</h3>
          <p className="text-sm text-muted">
            The AI proposes a full allocation that matches the targets — you review, edit, and
            approve it. Nothing is saved until you approve.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={handleGenerate} loading={generating}>
              Propose TOS with AI
            </Button>
            <span className="text-xs text-[var(--color-muted)]">
              {topics.length === 0
                ? 'No topics yet — add topics for this subject, or build the rows manually below.'
                : `Using ${topics.length} topic${topics.length === 1 ? '' : 's'}.`}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Rows */}
      <Card>
        <CardHeader>
          <h3 className="text-base font-semibold text-foreground">Planned rows</h3>
          <p className="text-sm text-muted">
            One row per topic + type + difficulty + Bloom level. Counts are items.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Add-row form */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs text-muted">
                Topic
                <input
                  list="tos-topic-options"
                  value={newTopic}
                  onChange={(e) => setNewTopic(e.target.value)}
                  placeholder={topics[0]?.title ?? 'Topic name'}
                  className="w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-foreground)]"
                />
                <datalist id="tos-topic-options">
                  {topics.map((t) => (
                    <option key={t.id} value={t.title} />
                  ))}
                </datalist>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Type
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as QuestionType)}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-foreground)]"
                >
                  {ALL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Difficulty
                <select
                  value={newDifficulty}
                  onChange={(e) => setNewDifficulty(e.target.value as Difficulty)}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-foreground)]"
                >
                  {ALL_DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTY_LABELS[d]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Bloom
                <select
                  value={newBloom}
                  onChange={(e) => setNewBloom(e.target.value as BloomLevel)}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-foreground)]"
                >
                  {ALL_BLOOM.map((b) => (
                    <option key={b} value={b}>
                      {BLOOM_LABELS[b]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Items
                <input
                  type="number"
                  min={1}
                  value={newCount}
                  onChange={(e) => setNewCount(e.target.value)}
                  className="w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-center text-[var(--color-foreground)]"
                />
              </label>
              <Button variant="secondary" onClick={handleAddRow}>
                Add row
              </Button>
            </div>

            {/* Totals & percentages */}
            <div className="space-y-2 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
              <div className="flex flex-wrap gap-2">
                <Badge variant={validation.problems.length === 0 ? 'success' : 'danger'}>
                  Total: {marginals.totalItems} items (target {targetTotal})
                </Badge>
                {ALL_TYPES.filter((t) => (marginals.byType[t] ?? 0) > 0).map((t) =>
                  pctBadge(TYPE_LABELS[t], marginals.byType[t] ?? 0)
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {ALL_DIFFICULTIES.filter((d) => (marginals.byDifficulty[d] ?? 0) > 0).map((d) =>
                  pctBadge(DIFFICULTY_LABELS[d], marginals.byDifficulty[d] ?? 0)
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {ALL_BLOOM.filter((b) => (marginals.byBloom[b] ?? 0) > 0).map((b) =>
                  pctBadge(BLOOM_LABELS[b], marginals.byBloom[b] ?? 0)
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.keys(marginals.byTopic).map((topic) =>
                  pctBadge(topic, marginals.byTopic[topic] ?? 0)
                )}
              </div>
            </div>

            {/* Validation */}
            {validation.problems.map((p) => (
              <p key={p} className="text-sm text-[var(--color-danger)]">
                {p}
              </p>
            ))}
            {[...validation.warnings, ...aiWarnings].map((w) => (
              <p key={w} className="text-sm text-[var(--color-warning)]">
                {w}
              </p>
            ))}
            {errors.tos && <p className="text-sm text-[var(--color-danger)]">{errors.tos}</p>}

            {/* Matrix */}
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Topic</TH>
                    <TH>Type</TH>
                    <TH>Difficulty</TH>
                    <TH>Bloom&apos;s level</TH>
                    <TH align="right">Items</TH>
                    <TH align="right">%</TH>
                    <TH aria-label="Actions" />
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row, index) => (
                    <TR key={`${row.topic}|${row.question_type}|${row.difficulty}|${row.bloom_level}|${index}`}>
                      <TD className="text-sm">{row.topic}</TD>
                      <TD className="text-sm">{TYPE_LABELS[row.question_type]}</TD>
                      <TD className="text-sm">{DIFFICULTY_LABELS[row.difficulty]}</TD>
                      <TD className="text-sm">{BLOOM_LABELS[row.bloom_level]}</TD>
                      <TD numeric>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={row.count}
                          onChange={(e) => handleCountChange(index, e.target.value)}
                          aria-label={`Items for ${row.topic}`}
                          className="w-16 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm text-center text-[var(--color-foreground)]"
                        />
                      </TD>
                      <TD numeric className="text-sm">
                        {tosPercent(row.count, marginals.totalItems)}%
                      </TD>
                      <TD numeric>
                        <button
                          type="button"
                          onClick={() => handleDelete(index)}
                          aria-label={`Delete row for ${row.topic}`}
                          className="text-xs text-[var(--color-danger)] hover:underline"
                        >
                          Delete
                        </button>
                      </TD>
                    </TR>
                  ))}
                  {rows.length === 0 && (
                    <TR>
                      <TD className="text-sm text-[var(--color-muted)]" colSpan={7}>
                        No rows yet — propose a TOS with AI or add the first row above.
                      </TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                onClick={handleApprove}
                disabled={generating || validation.problems.length > 0 || rows.length === 0}
              >
                {approved ? 'Re-approve TOS' : 'Approve TOS'}
              </Button>
              <span className="text-xs text-[var(--color-muted)]">
                Approval locks the plan for generation and stores it with the assessment version.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
