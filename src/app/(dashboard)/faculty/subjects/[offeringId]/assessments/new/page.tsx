'use client';

import { use, useState, useCallback, type JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import StepBasicInfo from '@/components/assessment/StepBasicInfo';
import StepSourceMaterials from '@/components/assessment/StepSourceMaterials';
import StepGenerationConfig from '@/components/assessment/StepGenerationConfig';
import StepCustomInstructions from '@/components/assessment/StepCustomInstructions';
import StepGenerate from '@/components/assessment/StepGenerate';
import StepReview from '@/components/assessment/StepReview';
import StepApprove from '@/components/assessment/StepApprove';
import type {
  QuestionType,
  Difficulty,
  BloomLevel,
  DraftQuestion,
  SourceMaterial,
} from '@/lib/types';

const STEP_LABELS = [
  'Basic Info',
  'Source Materials',
  'Generation Config',
  'Custom Instructions',
  'Generate',
  'Review & Edit',
  'Approve & Publish',
];

export interface WizardState {
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
}

const INITIAL_STATE: WizardState = {
  assessmentId: null,
  title: '',
  instructions: '',
  assessmentCategory: 'quiz',
  selectedSourceIds: [],
  sourceMaterials: [],
  questionTypes: ['multiple_choice'],
  countPerType: { multiple_choice: 10, identification: 0 },
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

  // Next 16 delivers params as a Promise; unwrap synchronously with use().
  const { offeringId } = use(params);

  const updateState = useCallback((updates: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...updates }));
    setStepErrors({});
  }, []);

  const validateStep = useCallback(
    (step: number): boolean => {
      const errors: Record<string, string> = {};

      switch (step) {
        case 0:
          if (!state.title.trim()) errors.title = 'Title is required';
          if (state.title.trim().length < 3) errors.title = 'Title must be at least 3 characters';
          break;
        case 1:
          if (state.selectedSourceIds.length === 0)
            errors.sources = 'Select at least one source material';
          break;
        case 2: {
          const hasType = state.questionTypes.some(
            (t) => (state.countPerType[t] || 0) > 0
          );
          if (!hasType) errors.types = 'Configure at least one question type with count > 0';
          const totalQuestions = state.questionTypes.reduce(
            (sum, t) => sum + (state.countPerType[t] || 0),
            0
          );
          const totalDifficulty = Object.values(state.difficultyDistribution).reduce(
            (s, v) => s + v,
            0
          );
          if (totalQuestions > 0 && totalDifficulty !== totalQuestions)
            errors.difficulty = `Difficulty total (${totalDifficulty}) must equal question count (${totalQuestions})`;
          const totalBloom = Object.values(state.bloomDistribution).reduce(
            (s, v) => s + v,
            0
          );
          if (totalQuestions > 0 && totalBloom !== totalQuestions)
            errors.bloom = `Bloom's total (${totalBloom}) must equal question count (${totalQuestions})`;
          break;
        }
        case 5:
          if (state.generatedQuestions.length === 0)
            errors.review = 'No questions to review. Go back and generate.';
          break;
      }

      setStepErrors(errors);
      return Object.keys(errors).length === 0;
    },
    [state]
  );

  const goNext = useCallback(() => {
    if (!validateStep(currentStep)) return;
    setCurrentStep((prev) => Math.min(prev + 1, STEP_LABELS.length - 1));
  }, [currentStep, validateStep]);

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

    switch (currentStep) {
      case 0:
        return <StepBasicInfo {...stepProps} />;
      case 1:
        return <StepSourceMaterials {...stepProps} />;
      case 2:
        return <StepGenerationConfig {...stepProps} />;
      case 3:
        return <StepCustomInstructions {...stepProps} />;
      case 4:
        return <StepGenerate {...stepProps} />;
      case 5:
        return <StepReview {...stepProps} />;
      case 6:
        return <StepApprove {...stepProps} />;
      default:
        return null;
    }
  };

  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === STEP_LABELS.length - 1;

  return (
    <div className="min-h-screen">
      <PageHeader
        breadcrumbs={[
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: 'Assessments', href: `/faculty/subjects/${offeringId}/assessments` },
          { label: 'New Assessment' },
        ]}
        title="Create Assessment"
        description="Build a new assessment with AI-assisted question generation"
      />

      <div className="max-w-5xl mx-auto">
        <nav aria-label="Progress" className="mb-8">
          <ol className="flex items-center">
            {STEP_LABELS.map((label, index) => {
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              const isClickable = index <= currentStep;

              return (
                <li key={label} className="flex items-center flex-1 last:flex-none">
                  <button
                    onClick={() => isClickable && goToStep(index)}
                    disabled={!isClickable}
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
                  {index < STEP_LABELS.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-3 ${
                        isCompleted ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border)]'
                      }`}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] p-6">
          {renderStep()}
        </div>

        <div className="flex items-center justify-between mt-6">
          <Button
            variant="secondary"
            onClick={goBack}
            disabled={isFirstStep}
          >
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
            Step {currentStep + 1} of {STEP_LABELS.length}
          </div>

          {!isLastStep && currentStep !== 4 && currentStep !== 5 && currentStep !== 6 && (
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
        </div>
      </div>
    </div>
  );
}
