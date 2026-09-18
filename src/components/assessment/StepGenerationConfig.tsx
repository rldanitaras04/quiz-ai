'use client';

import { type JSX } from 'react';
import { QUESTION_TYPES, QUESTION_TYPE_LABELS, DIFFICULTY_LEVELS, DIFFICULTY_LABELS, BLOOM_LEVELS, BLOOM_LABELS } from '@/lib/constants';
import type { QuestionType, Difficulty, BloomLevel } from '@/lib/types';

interface StepGenerationConfigProps {
  state: {
    questionTypes: QuestionType[];
    countPerType: Record<QuestionType, number>;
    difficultyDistribution: Record<Difficulty, number>;
    bloomDistribution: Record<BloomLevel, number>;
  };
  onUpdate: (updates: {
    questionTypes?: QuestionType[];
    countPerType?: Record<QuestionType, number>;
    difficultyDistribution?: Record<Difficulty, number>;
    bloomDistribution?: Record<BloomLevel, number>;
  }) => void;
  errors: Record<string, string>;
}

export default function StepGenerationConfig({
  state,
  onUpdate,
  errors,
}: StepGenerationConfigProps): JSX.Element {
  const totalQuestions = state.questionTypes.reduce(
    (sum, t) => sum + (state.countPerType[t] || 0),
    0
  );

  const totalDifficulty = Object.values(state.difficultyDistribution).reduce(
    (s, v) => s + v,
    0
  );

  const totalBloom = Object.values(state.bloomDistribution).reduce(
    (s, v) => s + v,
    0
  );

  const toggleType = (type: QuestionType) => {
    const next = state.questionTypes.includes(type)
      ? state.questionTypes.filter((t) => t !== type)
      : [...state.questionTypes, type];
    onUpdate({ questionTypes: next });
  };

  const updateCount = (type: QuestionType, count: number) => {
    onUpdate({
      countPerType: { ...state.countPerType, [type]: Math.max(0, count) },
    });
  };

  const updateDifficulty = (level: Difficulty, count: number) => {
    onUpdate({
      difficultyDistribution: {
        ...state.difficultyDistribution,
        [level]: Math.max(0, count),
      },
    });
  };

  const updateBloom = (level: BloomLevel, count: number) => {
    onUpdate({
      bloomDistribution: {
        ...state.bloomDistribution,
        [level]: Math.max(0, count),
      },
    });
  };

  const autoDistributeDifficulty = () => {
    const each = Math.floor(totalQuestions / 3);
    const remainder = totalQuestions % 3;
    onUpdate({
      difficultyDistribution: {
        easy: each + (remainder > 0 ? 1 : 0),
        moderate: each + (remainder > 1 ? 1 : 0),
        difficult: each,
      },
    });
  };

  const autoDistributeBloom = () => {
    const levels: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
    const each = Math.floor(totalQuestions / levels.length);
    const remainder = totalQuestions % levels.length;
    const dist: Record<BloomLevel, number> = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
    };
    levels.forEach((level, i) => {
      dist[level] = each + (i < remainder ? 1 : 0);
    });
    onUpdate({ bloomDistribution: dist });
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Generation Configuration
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Configure question types, counts, difficulty, and Bloom&apos;s taxonomy distribution.
        </p>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-[var(--color-foreground)] uppercase tracking-wide">
          Question Types
        </h3>
        {errors.types && (
          <p className="text-sm text-[var(--color-danger)]">{errors.types}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {QUESTION_TYPES.map((type) => {
            const isSelected = state.questionTypes.includes(type);
            return (
              <div
                key={type}
                className={`border rounded-[var(--radius-md)] p-4 transition-colors ${
                  isSelected
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                    : 'border-[var(--color-border)]'
                }`}
              >
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleType(type)}
                    className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-focus-ring)]"
                  />
                  <span className="text-sm font-medium text-[var(--color-foreground)]">
                    {QUESTION_TYPE_LABELS[type]}
                  </span>
                </label>
                {isSelected && (
                  <div className="mt-3 ml-7">
                    <label className="text-xs text-[var(--color-muted)] block mb-1">
                      Number of questions
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={state.countPerType[type] || 0}
                      onChange={(e) => updateCount(type, parseInt(e.target.value) || 0)}
                      className="w-20 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-sm text-[var(--color-muted)]">
          Total questions: <span className="font-semibold text-[var(--color-foreground)]">{totalQuestions}</span>
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-foreground)] uppercase tracking-wide">
            Difficulty Distribution
          </h3>
          <button
            type="button"
            onClick={autoDistributeDifficulty}
            disabled={totalQuestions === 0}
            className="text-xs text-[var(--color-primary)] hover:underline disabled:text-[var(--color-muted-light)] disabled:cursor-not-allowed"
          >
            Auto-distribute equally
          </button>
        </div>
        {errors.difficulty && (
          <p className="text-sm text-[var(--color-danger)]">{errors.difficulty}</p>
        )}
        <div className="grid grid-cols-3 gap-4">
          {DIFFICULTY_LEVELS.map((level) => (
            <div key={level}>
              <label className="text-xs text-[var(--color-muted)] block mb-1">
                {DIFFICULTY_LABELS[level]}
              </label>
              <input
                type="number"
                min={0}
                max={totalQuestions}
                value={state.difficultyDistribution[level]}
                onChange={(e) => updateDifficulty(level, parseInt(e.target.value) || 0)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          Difficulty total: <span className={totalDifficulty !== totalQuestions && totalQuestions > 0 ? 'text-[var(--color-danger)] font-semibold' : 'font-semibold text-[var(--color-foreground)]'}>{totalDifficulty}</span>
          {totalQuestions > 0 && ` / ${totalQuestions}`}
        </p>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-foreground)] uppercase tracking-wide">
            Bloom&apos;s Taxonomy Distribution
          </h3>
          <button
            type="button"
            onClick={autoDistributeBloom}
            disabled={totalQuestions === 0}
            className="text-xs text-[var(--color-primary)] hover:underline disabled:text-[var(--color-muted-light)] disabled:cursor-not-allowed"
          >
            Auto-distribute equally
          </button>
        </div>
        {errors.bloom && (
          <p className="text-sm text-[var(--color-danger)]">{errors.bloom}</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {BLOOM_LEVELS.map((level) => (
            <div key={level}>
              <label className="text-xs text-[var(--color-muted)] block mb-1">
                {BLOOM_LABELS[level]}
              </label>
              <input
                type="number"
                min={0}
                max={totalQuestions}
                value={state.bloomDistribution[level]}
                onChange={(e) => updateBloom(level, parseInt(e.target.value) || 0)}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-foreground)] focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-[var(--color-muted)]">
          Bloom&apos;s total: <span className={totalBloom !== totalQuestions && totalQuestions > 0 ? 'text-[var(--color-danger)] font-semibold' : 'font-semibold text-[var(--color-foreground)]'}>{totalBloom}</span>
          {totalQuestions > 0 && ` / ${totalQuestions}`}
        </p>
      </div>
    </div>
  );
}
