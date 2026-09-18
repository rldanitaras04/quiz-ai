'use client';

import { useState, useCallback, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { createAssessment, updateGenerationConfig, triggerGeneration } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import type {
  WizardState,
  QuestionType,
  Difficulty,
  BloomLevel,
} from '@/lib/types';

interface StepGenerateProps {
  state: WizardState;
  onUpdate: (updates: Partial<WizardState>) => void;
  offeringId: string;
  errors: Record<string, string>;
}

interface GenerationPhase {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

export default function StepGenerate({
  state,
  onUpdate,
  offeringId,
  errors,
}: StepGenerateProps): JSX.Element {
  const [phases, setPhases] = useState<GenerationPhase[]>([
    { label: 'Creating assessment record', status: 'pending' },
    { label: 'Saving generation config', status: 'pending' },
    { label: 'Triggering AI generation', status: 'pending' },
    { label: 'Validating results', status: 'pending' },
  ]);
  const [currentPhase, setCurrentPhase] = useState(-1);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const updatePhase = useCallback(
    (index: number, status: GenerationPhase['status']) => {
      setPhases((prev) =>
        prev.map((p, i) => (i === index ? { ...p, status } : p))
      );
    },
    []
  );

  const startGeneration = useCallback(async () => {
    onUpdate({ isGenerating: true, generationError: null });
    setGenerationError(null);
    setCurrentPhase(0);

    try {
      // Phase 1: Create assessment
      updatePhase(0, 'active');
      const assessment = await createAssessment(offeringId, {
        title: state.title,
        instructions: state.instructions,
        assessmentCategory: state.assessmentCategory,
      });
      updatePhase(0, 'done');
      onUpdate({ assessmentId: assessment.id });

      // Phase 2: Save generation config
      setCurrentPhase(1);
      updatePhase(1, 'active');
      await updateGenerationConfig(assessment.id, {
        question_types: state.questionTypes,
        count_per_type: state.countPerType,
        difficulty_distribution: state.difficultyDistribution,
        bloom_distribution: state.bloomDistribution,
        source_material_ids: state.selectedSourceIds,
        custom_instructions: state.customInstructions,
      });
      updatePhase(1, 'done');

      // Phase 3: Trigger generation
      setCurrentPhase(2);
      updatePhase(2, 'active');
      const job = await triggerGeneration(assessment.id, {
        source_material_ids: state.selectedSourceIds,
        question_types: state.questionTypes,
        count_per_type: state.countPerType,
        difficulty_distribution: state.difficultyDistribution,
        bloom_distribution: state.bloomDistribution,
        custom_instructions: state.customInstructions || undefined,
      });
      setJobId(job.id);
      updatePhase(2, 'done');

      // Phase 4: Validate
      setCurrentPhase(3);
      updatePhase(3, 'active');

      // Simulate validation delay - in production this would poll the job status
      await new Promise((resolve) => setTimeout(resolve, 1500));
      updatePhase(3, 'done');

      // Simulate generated questions
      const totalQ = state.questionTypes.reduce(
        (sum, t) => sum + (state.countPerType[t] || 0),
        0
      );

      const mockQuestions = Array.from({ length: totalQ }, (_, i) => {
        const type = i < (state.countPerType.multiple_choice || 0)
          ? 'multiple_choice' as QuestionType
          : 'identification' as QuestionType;

        const difficulties: Difficulty[] = ['easy', 'moderate', 'difficult'];
        const diffIndex = i % 3;
        const difficulty = difficulties[diffIndex];

        const blooms: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
        const bloomIndex = i % 6;

        return {
          id: `mock-${i}`,
          assessment_version_id: '',
          question_type: type,
          question_text: `Sample question ${i + 1} (${type === 'multiple_choice' ? 'MCQ' : 'ID'} - ${difficulty})`,
          difficulty,
          bloom_level: blooms[bloomIndex],
          points: 1,
          position: i + 1,
          status: 'active',
          created_by: '',
          is_ai_generated: true,
          generation_metadata: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          question_choices: type === 'multiple_choice'
            ? [
                { id: `c-${i}-a`, question_id: `mock-${i}`, choice_key: 'A', choice_text: 'Option A', position: 0, created_at: '', updated_at: '' },
                { id: `c-${i}-b`, question_id: `mock-${i}`, choice_key: 'B', choice_text: 'Option B', position: 1, created_at: '', updated_at: '' },
                { id: `c-${i}-c`, question_id: `mock-${i}`, choice_key: 'C', choice_text: 'Option C', position: 2, created_at: '', updated_at: '' },
                { id: `c-${i}-d`, question_id: `mock-${i}`, choice_key: 'D', choice_text: 'Option D', position: 3, created_at: '', updated_at: '' },
              ]
            : [],
        };
      });

      onUpdate({
        generatedQuestions: mockQuestions,
        generationStats: {
          totalGenerated: totalQ,
          duplicatesRemoved: 0,
          errors: [],
        },
        isGenerating: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setGenerationError(msg);
      onUpdate({ isGenerating: false, generationError: msg });
      if (currentPhase >= 0) {
        updatePhase(currentPhase, 'error');
      }
    }
  }, [
    state,
    offeringId,
    onUpdate,
    updatePhase,
    currentPhase,
  ]);

  const retry = () => {
    setPhases((prev) => prev.map((p) => ({ ...p, status: 'pending' as const })));
    setCurrentPhase(-1);
    setGenerationError(null);
  };

  const isComplete = phases.every((p) => p.status === 'done');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
          Generate Assessment
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          Review your configuration and trigger AI generation.
        </p>
      </div>

      <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-surface-hover)] border border-[var(--color-border)]">
        <h3 className="text-sm font-semibold text-[var(--color-foreground)] mb-2">
          Configuration Summary
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--color-muted)]">Title:</dt>
          <dd className="text-[var(--color-foreground)] font-medium">{state.title}</dd>
          <dt className="text-[var(--color-muted)]">Sources:</dt>
          <dd className="text-[var(--color-foreground)]">{state.selectedSourceIds.length} selected</dd>
          <dt className="text-[var(--color-muted)]">Question types:</dt>
          <dd className="text-[var(--color-foreground)]">
            {state.questionTypes
              .filter((t) => (state.countPerType[t] || 0) > 0)
              .map((t) => `${state.countPerType[t]} ${t === 'multiple_choice' ? 'MCQ' : 'ID'}`)
              .join(', ')}
          </dd>
          <dt className="text-[var(--color-muted)]">Total questions:</dt>
          <dd className="text-[var(--color-foreground)] font-semibold">
            {state.questionTypes.reduce((sum, t) => sum + (state.countPerType[t] || 0), 0)}
          </dd>
        </dl>
      </div>

      <div className="space-y-3">
        {phases.map((phase, i) => (
          <div key={phase.label} className="flex items-center gap-3">
            <div className="shrink-0">
              {phase.status === 'done' && (
                <svg className="w-5 h-5 text-[var(--color-success)]" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
              )}
              {phase.status === 'active' && (
                <Spinner size="sm" />
              )}
              {phase.status === 'error' && (
                <svg className="w-5 h-5 text-[var(--color-danger)]" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
                </svg>
              )}
              {phase.status === 'pending' && (
                <div className="w-5 h-5 rounded-full border-2 border-[var(--color-border)]" />
              )}
            </div>
            <span
              className={`text-sm ${
                phase.status === 'active'
                  ? 'text-[var(--color-foreground)] font-medium'
                  : phase.status === 'done'
                    ? 'text-[var(--color-success)]'
                    : phase.status === 'error'
                      ? 'text-[var(--color-danger)]'
                      : 'text-[var(--color-muted)]'
              }`}
            >
              {phase.label}
            </span>
          </div>
        ))}
      </div>

      {generationError && (
        <div className="p-4 rounded-[var(--radius-md)] bg-[var(--color-danger-light)] border border-[var(--color-danger)]/20">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-[var(--color-danger)] shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[var(--color-danger)]">Generation Error</p>
              <p className="text-sm text-[var(--color-danger)] mt-1">{generationError}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        {!isComplete && !state.isGenerating && (
          <Button
            variant="primary"
            onClick={startGeneration}
            disabled={state.isGenerating}
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            Generate Assessment
          </Button>
        )}
        {generationError && (
          <Button variant="outline" onClick={retry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
