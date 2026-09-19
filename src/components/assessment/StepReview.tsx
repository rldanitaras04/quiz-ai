'use client';

import { useState, useCallback, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import QuestionNavigator from './QuestionNavigator';
import QuestionEditor from './QuestionEditor';
import type { DraftQuestion } from '@/lib/types';

interface StepReviewProps {
  state: {
    generatedQuestions: DraftQuestion[];
    assessmentId: string | null;
  };
  onUpdate: (updates: {
    generatedQuestions?: DraftQuestion[];
  }) => void;
  offeringId: string;
  errors: Record<string, string>;
}

export default function StepReview({
  state,
  onUpdate,
  errors,
}: StepReviewProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const questions = state.generatedQuestions;
  const currentQuestion = questions[selectedIndex];

  const handleUpdateQuestion = useCallback(
    (index: number, updates: Partial<DraftQuestion>) => {
      const next = questions.map((q, i) =>
        i === index ? { ...q, ...updates } : q
      );
      onUpdate({ generatedQuestions: next });
    },
    [questions, onUpdate]
  );

  const handleDeleteQuestion = useCallback(
    (index: number) => {
      const next = questions.filter((_, i) => i !== index);
      onUpdate({ generatedQuestions: next });
      if (selectedIndex >= next.length) {
        setSelectedIndex(Math.max(0, next.length - 1));
      }
    },
    [questions, selectedIndex, onUpdate]
  );

  const handleAddQuestion = useCallback(() => {
    const newQuestion: DraftQuestion = {
      id: `manual-${Date.now()}`,
      assessment_version_id: '',
      question_type: 'multiple_choice',
      question_text: '',
      difficulty: 'moderate',
      bloom_level: 'remember',
      points: 1,
      position: questions.length + 1,
      status: 'active',
      created_by: '',
      is_ai_generated: false,
      generation_metadata: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      question_choices: [
        { id: `nc-1`, question_id: `manual-${Date.now()}`, choice_key: 'A', choice_text: '', position: 0, created_at: '', updated_at: '' },
        { id: `nc-2`, question_id: `manual-${Date.now()}`, choice_key: 'B', choice_text: '', position: 1, created_at: '', updated_at: '' },
        { id: `nc-3`, question_id: `manual-${Date.now()}`, choice_key: 'C', choice_text: '', position: 2, created_at: '', updated_at: '' },
        { id: `nc-4`, question_id: `manual-${Date.now()}`, choice_key: 'D', choice_text: '', position: 3, created_at: '', updated_at: '' },
      ],
    };
    onUpdate({ generatedQuestions: [...questions, newQuestion] });
    setSelectedIndex(questions.length);
  }, [questions, onUpdate]);

  const getQuestionStatus = (q: DraftQuestion): 'complete' | 'incomplete' => {
    if (!q.question_text.trim()) return 'incomplete';
    if (q.question_type === 'multiple_choice') {
      const filledChoices = q.question_choices.filter((c) => c.choice_text.trim());
      if (filledChoices.length < 2) return 'incomplete';
    }
    return 'complete';
  };

  if (questions.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-1">
            Review & Edit Questions
          </h2>
          <p className="text-sm text-[var(--color-muted)]">
            No questions generated yet. Go back to generate questions.
          </p>
        </div>
        {errors.review && (
          <p className="text-sm text-[var(--color-danger)]">{errors.review}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
            Review & Edit Questions
          </h2>
          <p className="text-sm text-[var(--color-muted)]">
            {questions.length} questions &middot; Review and edit before approving
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="success">
            {questions.filter((q) => getQuestionStatus(q) === 'complete').length} complete
          </Badge>
          <Badge variant="warning">
            {questions.filter((q) => getQuestionStatus(q) === 'incomplete').length} incomplete
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="lg:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
            </svg>
            Questions
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Navigator sidebar - hidden on mobile */}
        <div className="hidden lg:block w-64 shrink-0">
          <QuestionNavigator
            questions={questions}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            onAdd={handleAddQuestion}
            getQuestionStatus={getQuestionStatus}
          />
        </div>

        {/* Mobile drawer overlay */}
        {drawerOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setDrawerOpen(false)}
            />
            <div className="absolute left-0 top-0 bottom-0 w-72 bg-[var(--color-surface)] border-r border-[var(--color-border)] p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-[var(--color-foreground)]">Questions</h3>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1 rounded text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
                >
                  <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>
              <QuestionNavigator
                questions={questions}
                selectedIndex={selectedIndex}
                onSelect={(i) => {
                  setSelectedIndex(i);
                  setDrawerOpen(false);
                }}
                onAdd={() => {
                  handleAddQuestion();
                  setDrawerOpen(false);
                }}
                getQuestionStatus={getQuestionStatus}
              />
            </div>
          </div>
        )}

        {/* Question editor */}
        <div className="flex-1 min-w-0">
          {currentQuestion && (
            <QuestionEditor
              question={currentQuestion}
              index={selectedIndex}
              total={questions.length}
              onUpdate={(updates) => handleUpdateQuestion(selectedIndex, updates)}
              onDelete={() => handleDeleteQuestion(selectedIndex)}
              onNavigate={(dir) => {
                const next = selectedIndex + dir;
                if (next >= 0 && next < questions.length) {
                  setSelectedIndex(next);
                }
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
