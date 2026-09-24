'use client';

import { use, useState, useCallback, useEffect, type JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import StepBasicInfo from '@/components/assessment/StepBasicInfo';
import StepSourceMaterials from '@/components/assessment/StepSourceMaterials';
import StepGenerationConfig from '@/components/assessment/StepGenerationConfig';
import StepCustomInstructions from '@/components/assessment/StepCustomInstructions';
import StepGenerate from '@/components/assessment/StepGenerate';
import StepReview from '@/components/assessment/StepReview';
import StepApprove from '@/components/assessment/StepApprove';
import StepCreationMode from '@/components/assessment/StepCreationMode';
import StepManualEntry from '@/components/assessment/StepManualEntry';
import StepQuestionBank from '@/components/assessment/StepQuestionBank';
import type {
  QuestionType,
  Difficulty,
  BloomLevel,
  DraftQuestion,
  SourceMaterial,
  Topic,
  AssessmentCreationMode,
} from '@/lib/types';
import { getTopicsForOffering, createTopic } from '@/app/(dashboard)/faculty/subjects/[offeringId]/topics/actions';

// ---------------------------------------------------------------------------
// Wizard state
// ---------------------------------------------------------------------------
export interface WizardState {
  creationMode: AssessmentCreationMode;
  assessmentId: string | null;
  title: string;
  instructions: string;
  assessmentCategory: string;
  selectedSourceIds: string[];
  sourceMaterials: SourceMaterial[];
  questionTypes: QuestionType[];
  countPerType: Record<QuestionType, number>;
  difficultyDistribution: Record<Difficulty, number>;
  bloomDistribution: Record<BloomLevel, number>;
  customInstructions: string;
  generatedQuestions: DraftQuestion[];
  generationStats: {
    totalGenerated: number;
    duplicatesRemoved: number;
    errors: string[];
  } | null;
  isGenerating: boolean;
  generationError: string | null;
  draftStatus: 'draft' | 'final' | null;
  opensAt: string;
  closesAt: string;
  durationMinutes: number;
  attemptLimit: number;
  // topic context
  defaultTopicId: string | null;
}

const INITIAL_STATE: WizardState = {
  creationMode: 'ai',
  assessmentId: null,
  title: '',
  instructions: '',
  assessmentCategory: 'quiz',
  selectedSourceIds: [],
  sourceMaterials: [],
  questionTypes: ['multiple_choice'],
  countPerType: { multiple_choice: 10, identification: 0, true_false: 0 },
  difficultyDistribution: { easy: 4, moderate: 4, difficult: 2 },
  bloomDistribution: {
    remember: 2,
    understand: 2,
    apply: 2,
    analyze: 2,
    evaluate: 1,
    create: 1,
  },
  customInstructions: '',
  generatedQuestions: [],
  generationStats: null,
  isGenerating: false,
  generationError: null,
  draftStatus: null,
  opensAt: '',
  closesAt: '',
  durationMinutes: 60,
  attemptLimit: 1,
  defaultTopicId: null,
};

type StepId = 'mode' | 'basic' | 'sources' | 'genConfig' | 'custom' | 'generate' | 'manual' | 'bank' | 'review' | 'approve';

const STEP_CONFIG: Record<AssessmentCreationMode, { ids: StepId[]; labels: string[] }> = {
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
};

interface StepProps {
  state: WizardState;
  onUpdate: (updates: Partial<WizardState>) => void;
  offeringId: string;
  errors: Record<string, string>;
}

export default function NewAssessmentPage({
  params,
}: {
  params: Promise<{ offeringId: string }>;
}): JSX.Element {
  const [currentStep, setCurrentStep] = useState(0);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({});
  const [topics, setTopics] = useState<Topic[]>([]);
  const { offeringId } = use(params);

  const updateState = useCallback((updates: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...updates }));
    setStepErrors({});
  }, []);

  // Load topics for this subject/offering
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTopicsForOffering(offeringId);
        if (!cancelled) setTopics(t);
      } catch {
        // topics table may not exist yet if migration hasn't run — ignore
        if (!cancelled) setTopics([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [offeringId]);

  // Keep step index in bounds when switching creation mode
  useEffect(() => {
    const cfg = STEP_CONFIG[state.creationMode];
    if (currentStep >= cfg.ids.length) setCurrentStep(cfg.ids.length - 1);
  }, [state.creationMode, currentStep]);

  const handleCreateTopic = useCallback(
    async (title: string): Promise<Topic | null> => {
      try {
        const nt = await createTopic(offeringId, { title });
        setTopics((prev) => [...prev, nt].sort((a, b) => a.title.localeCompare(b.title)));
        return nt;
      } catch {
        return null;
      }
    },
    [offeringId]
  );

  const cfg = STEP_CONFIG[state.creationMode];
  const stepIds = cfg.ids;
  const labels = cfg.labels;
  const activeStepId = stepIds[currentStep];

  // Auto-advance to Review after AI generation completes
  useEffect(() => {
    if (activeStepId === 'generate' && !state.isGenerating && state.generatedQuestions.length > 0) {
      const reviewIdx = stepIds.indexOf('review');
      if (reviewIdx !== -1) setCurrentStep(reviewIdx);
    }
  }, [activeStepId, state.isGenerating, state.generatedQuestions.length, stepIds]);

  const validateStep = useCallback(
    (step: number): boolean => {
      const errors: Record<string, string> = {};
      const sid = stepIds[step] as StepId;
      switch (sid) {
        case 'mode':
          // always valid — mode has default
          break;
        case 'basic':
          if (!state.title.trim()) errors.title = 'Title is required';
          else if (state.title.trim().length < 3) errors.title = 'Title must be at least 3 characters';
          break;
        case 'sources':
          if (state.selectedSourceIds.length === 0) errors.sources = 'Select at least one source material';
          break;
        case 'genConfig': {
          const hasType = state.questionTypes.some((t) => (state.countPerType[t] || 0) > 0);
          if (!hasType) errors.types = 'Configure at least one question type with count > 0';
          const totalQuestions = state.questionTypes.reduce((sum, t) => sum + (state.countPerType[t] || 0), 0);
          const totalDifficulty = Object.values(state.difficultyDistribution).reduce((s, v) => s + v, 0);
          if (totalQuestions > 0 && totalDifficulty !== totalQuestions)
            errors.difficulty = `Difficulty total (${totalDifficulty}) must equal question count (${totalQuestions})`;
          const totalBloom = Object.values(state.bloomDistribution).reduce((s, v) => s + v, 0);
          if (totalQuestions > 0 && totalBloom !== totalQuestions)
            errors.bloom = `Bloom total (${totalBloom}) must equal question count (${totalQuestions})`;
          break;
        }
        case 'manual':
          // In mixed mode manual is optional — you may add only from bank; Review is the gate.
          if (state.creationMode !== 'mixed' && state.generatedQuestions.length === 0) errors.manual = 'Add at least one question. You can also import from the Question Bank in the next step.';
          break;
        case 'bank':
          // Bank selection is optional here — Review validates that something was chosen
          break;
        case 'review':
          if (state.generatedQuestions.length === 0) errors.review = 'No questions to review. Add some manually or from the bank, or generate with AI.';
          break;
        default:
          break;
      }
      setStepErrors(errors);
      return Object.keys(errors).length === 0;
    },
    [state, stepIds]
  );

  const goNext = useCallback(() => {
    if (!validateStep(currentStep)) return;
    setCurrentStep((prev) => Math.min(prev + 1, labels.length - 1));
  }, [currentStep, validateStep, labels.length]);

  const goBack = useCallback(() => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
    setStepErrors({});
  }, []);

  const goToStep = useCallback(
    (step: number) => {
      if (step > currentStep) {
        for (let i = currentStep; i < step; i++) {
          if (!validateStep(i)) return;
        }
      }
      setCurrentStep(step);
      setStepErrors({});
    },
    [currentStep, validateStep]
  );

  const renderStep = () => {
    const stepProps: StepProps = {
      state,
      onUpdate: updateState,
      offeringId,
      errors: stepErrors,
    };
    switch (activeStepId) {
      case 'mode':
        return <StepCreationMode value={state.creationMode} onChange={(m) => updateState({ creationMode: m as AssessmentCreationMode })} />;
      case 'basic':
        return <StepBasicInfo {...stepProps} />;
      case 'sources':
        return <StepSourceMaterials {...stepProps} />;
      case 'genConfig':
        return <StepGenerationConfig {...stepProps} />;
      case 'custom':
        return <StepCustomInstructions {...stepProps} />;
      case 'generate':
        return <StepGenerate {...stepProps} />;
      case 'manual':
        return (
          <StepManualEntry
            questions={state.generatedQuestions}
            onChange={(next) => updateState({ generatedQuestions: next })}
            topics={topics}
            onCreateTopic={handleCreateTopic}
            offeringId={offeringId}
          />
        );
      case 'bank':
        return (
          <StepQuestionBank
            offeringId={offeringId}
            topics={topics}
            onImport={(drafts) => {
              const merged = [...state.generatedQuestions, ...drafts.map((d, i) => ({ ...d, position: state.generatedQuestions.length + i + 1 }))];
              updateState({ generatedQuestions: merged });
            }}
            existingCount={state.generatedQuestions.length}
          />
        );
      case 'review':
        return (
          <StepReview
            {...stepProps}
            onRegenerate={() => {
              if (state.creationMode === 'ai') {
                updateState({ generatedQuestions: [], generationStats: null, isGenerating: false });
                const genIdx = stepIds.indexOf('generate');
                if (genIdx !== -1) setCurrentStep(genIdx);
              } else {
                // for manual/bank, just stay — they can edit via Review itself
              }
            }}
            onSaveDraft={() => {
              updateState({ draftStatus: 'draft' });
              const approveIdx = stepIds.indexOf('approve');
              if (approveIdx !== -1) setCurrentStep(approveIdx);
            }}
            onSaveFinal={() => {
              updateState({ draftStatus: 'final' });
              const approveIdx = stepIds.indexOf('approve');
              if (approveIdx !== -1) setCurrentStep(approveIdx);
            }}
          />
        );
      case 'approve':
        return <StepApprove {...stepProps} topics={topics} allTopics={topics} />;
      default:
        return null;
    }
  };

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === labels.length - 1;
  const isGenerateStep = activeStepId === 'generate';
  const isReviewStep = activeStepId === 'review';
  const isApproveStep = activeStepId === 'approve';

  return (
    <div className="min-h-screen">
      <PageHeader
        breadcrumbs={[
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: 'Assessments', href: `/faculty/subjects/${offeringId}/assessments` },
          { label: 'New Assessment' },
        ]}
        title="Create Assessment"
        description={
          state.creationMode === 'ai'
            ? 'AI-assisted generation from your source materials'
            : state.creationMode === 'manual'
              ? 'Manually encode each item — categorized by topic, with optional images'
              : state.creationMode === 'bank'
                ? 'Pick reusable items from your question bank — grouped by topic'
                : 'Combine manual encoding and bank imports — no source files needed, with optional images'
        }
      />

      <div className="max-w-5xl mx-auto">
        <nav aria-label="Progress" className="mb-8">
          <ol className="flex items-center">
            {labels.map((label, index) => {
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              const isClickable = index <= currentStep;
              return (
                <li key={label} className="flex items-center flex-1 last:flex-none">
                  <button
                    onClick={() => isClickable && !state.isGenerating && goToStep(index)}
                    disabled={!isClickable || state.isGenerating}
                    className={`flex items-center gap-2 text-sm whitespace-nowrap transition-colors ${
                      isActive
                        ? 'text-[var(--color-primary)] font-semibold'
                        : isCompleted
                          ? 'text-[var(--color-success)] cursor-pointer hover:underline'
                          : 'text-[var(--color-muted-light)] cursor-not-allowed'
                    }`}
                  >
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold border-2 transition-colors ${
                        isActive
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                          : isCompleted
                            ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                            : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-muted)]'
                      }`}
                    >
                      {isCompleted ? (
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span className="hidden lg:inline">{label}</span>
                  </button>
                  {index < labels.length - 1 && (
                    <div className={`flex-1 h-0.5 mx-3 ${isCompleted ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border)]'}`} />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] p-6">
          {renderStep()}
          {stepErrors.manual && <p className="mt-4 text-sm text-[var(--color-danger)]">{stepErrors.manual}</p>}
          {stepErrors.review && <p className="mt-4 text-sm text-[var(--color-danger)]">{stepErrors.review}</p>}
        </div>

        <div className="flex items-center justify-between mt-6">
          <Button variant="secondary" onClick={goBack} disabled={isFirstStep || state.isGenerating}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
            Back
          </Button>

          <div className="text-sm text-[var(--color-muted)]">
            Step {currentStep + 1} of {labels.length} · {state.creationMode === 'ai' ? 'AI' : state.creationMode === 'manual' ? 'Manual' : state.creationMode === 'bank' ? 'Bank' : 'Mixed'} mode
          </div>

          {!isLastStep && !isGenerateStep && !isReviewStep && !isApproveStep && (
            <Button variant="primary" onClick={goNext}>
              Next
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </Button>
          )}
          {/* AI generate hides Next, Manual/Bank next is needed except review/approve handled */}
          {!isLastStep && isReviewStep && (
            <Button variant="primary" onClick={goNext}>
              Continue to Approve
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clipRule="evenodd"
                />
              </svg>
            </Button>
          )}
        </div>

        <div className="mt-3 text-center">
          <p className="text-xs text-[var(--color-muted)]">
            {state.creationMode !== 'ai' && 'You can combine methods — use Review to add the remaining type before approval.'}
          </p>
        </div>
      </div>
    </div>
  );
}
