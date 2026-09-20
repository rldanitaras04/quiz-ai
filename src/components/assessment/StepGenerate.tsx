'use client';

import { useState, useCallback, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Spinner from '@/components/ui/Spinner';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { createAssessment, updateGenerationConfig, triggerGeneration } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/actions';
import { useSupabase } from '@/lib/hooks';
import type {
  QuestionType,
  Difficulty,
  BloomLevel,
  DraftQuestion,
} from '@/lib/types';

/** A choice as returned by /api/ai/generate (accepts either field naming). */
interface GeneratedChoicePayload {
  key?: string;
  choice_key?: string;
  text?: string;
  choice_text?: string;
  isCorrect?: boolean;
  is_correct?: boolean;
}

/** A question as returned by /api/ai/generate. */
interface GeneratedQuestionPayload {
  questionType?: QuestionType;
  question_type?: QuestionType;
  questionText?: string;
  question_text?: string;
  difficulty?: Difficulty;
  bloomLevel?: BloomLevel;
  bloom_level?: BloomLevel;
  points?: number;
  choices?: GeneratedChoicePayload[];
  canonicalAnswer?: string;
  canonical_answer?: string;
}

/** Convert the AI API's GeneratedQuestion shape to the wizard's DraftQuestion shape. */
function mapGeneratedQuestion(raw: GeneratedQuestionPayload, position: number): DraftQuestion {
  const id = `gen-${Date.now()}-${position}`;
  return {
    id,
    assessment_version_id: '',
    question_type: raw.questionType === 'identification' ? 'identification' : 'multiple_choice',
    question_text: raw.questionText ?? raw.question_text ?? '',
    difficulty: raw.difficulty ?? 'moderate',
    bloom_level: raw.bloomLevel ?? raw.bloom_level ?? 'understand',
    points: raw.points ?? 1,
    position,
    status: 'active',
    created_by: '',
    is_ai_generated: true,
    generation_metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    question_choices: (raw.choices ?? []).map((c, i) => ({
      id: `${id}-c${i}`,
      question_id: id,
      choice_key: c.key ?? c.choice_key ?? String.fromCharCode(65 + i),
      choice_text: c.text ?? c.choice_text ?? '',
      position: i,
      created_at: '',
      updated_at: '',
      is_correct: c.isCorrect ?? c.is_correct ?? false,
    })),
    canonical_answer: raw.canonicalAnswer ?? raw.canonical_answer,
  };
}
import type { WizardState } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/new/page';

interface StepGenerateProps {
  state: WizardState;
  onUpdate: (updates: Partial<WizardState>) => void;
  offeringId: string;
}

interface GenerationPhase {
  label: string;
  status: 'pending' | 'active' | 'done' | 'error';
}

export default function StepGenerate({
  state,
  onUpdate,
  offeringId,
}: StepGenerateProps): JSX.Element {
  const supabase = useSupabase();
  const [phases, setPhases] = useState<GenerationPhase[]>([
    { label: 'Creating assessment record', status: 'pending' },
    { label: 'Saving generation config', status: 'pending' },
    { label: 'Generating questions via AI', status: 'pending' },
  ]);
  const [currentPhase, setCurrentPhase] = useState(-1);
  const [generationError, setGenerationError] = useState<string | null>(null);

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
        assessment_category: state.assessmentCategory,
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
      await triggerGeneration(assessment.id, {        source_material_ids: state.selectedSourceIds,
        question_types: state.questionTypes,
        count_per_type: state.countPerType,
        difficulty_distribution: state.difficultyDistribution,
        bloom_distribution: state.bloomDistribution,
        custom_instructions: state.customInstructions || undefined,
      });
      updatePhase(2, 'done');

      // Phase 4: Call AI generation API
      setCurrentPhase(3);
      updatePhase(3, 'active');

      const totalQ = state.questionTypes.reduce(
        (sum: number, t: QuestionType) => sum + (state.countPerType[t] || 0),
        0
      );

      // Fetch source chunk IDs for the selected source materials
      const { data: sourceChunks } = await supabase
        .from('source_chunks')
        .select('id')
        .in('source_material_id', state.selectedSourceIds);

      const sourceChunkIds = sourceChunks?.map((c) => c.id) || [];

      // Generate questions for each type via the AI API
      const allGeneratedQuestions: DraftQuestion[] = [];
      const errors: string[] = [];

      for (const questionType of state.questionTypes) {
        const count = state.countPerType[questionType] || 0;
        if (count === 0) continue;

        // Determine difficulty and bloom distribution for this batch
        const difficulties: Difficulty[] = ['easy', 'moderate', 'difficult'];
        const blooms: BloomLevel[] = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];

        for (let i = 0; i < count; i++) {
          const difficulty = difficulties[i % difficulties.length];
          const bloomLevel = blooms[i % blooms.length];

          try {
            const response = await fetch('/api/ai/generate', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
              },
              body: JSON.stringify({
                sourceChunkIds,
                topic: state.title,
                questionType,
                count: 1,
                difficulty,
                bloomLevel,
                customInstructions: state.customInstructions,
                assessmentId: assessment.id,
                offeringId,
              }),
            });

            if (!response.ok) {
              const errData = await response.json();
              errors.push(`Failed to generate ${questionType} #${i + 1}: ${errData.error}`);
              continue;
            }

            const data = await response.json();
            if (data.questions && data.questions.length > 0) {
              allGeneratedQuestions.push(
                mapGeneratedQuestion(data.questions[0], allGeneratedQuestions.length + 1)
              );
            }
          } catch (err) {
            errors.push(`Error generating ${questionType} #${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        }
      }

      // If no questions were generated, show error
      if (allGeneratedQuestions.length === 0) {
        throw new Error(errors.length > 0 ? errors[0] : 'No questions were generated');
      }

      updatePhase(3, 'done');

      notifySuccess(
        'Questions generated',
        `${allGeneratedQuestions.length} question${allGeneratedQuestions.length === 1 ? '' : 's'} ready to review.`
      );

      onUpdate({
        generatedQuestions: allGeneratedQuestions,
        generationStats: {
          totalGenerated: allGeneratedQuestions.length,
          duplicatesRemoved: totalQ - allGeneratedQuestions.length,
          errors,
        },
        isGenerating: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed';
      setGenerationError(msg);
      notifyError('Generation failed', msg);
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
    supabase,
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
              .filter((t: QuestionType) => (state.countPerType[t] || 0) > 0)
              .map((t: QuestionType) => `${state.countPerType[t]} ${t === 'multiple_choice' ? 'MCQ' : 'ID'}`)
              .join(', ')}
          </dd>
          <dt className="text-[var(--color-muted)]">Total questions:</dt>
          <dd className="text-[var(--color-foreground)] font-semibold">
            {state.questionTypes.reduce((sum: number, t: QuestionType) => sum + (state.countPerType[t] || 0), 0)}
          </dd>
        </dl>
      </div>

      <div className="space-y-3">
        {phases.map((phase) => (
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
