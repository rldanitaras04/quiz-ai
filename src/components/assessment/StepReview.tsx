'use client';

import { useState, useCallback, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import QuestionNavigator from './QuestionNavigator';
import QuestionEditor from './QuestionEditor';
import StepQuestionBank from './StepQuestionBank';
import type { DraftQuestion, Topic } from '@/lib/types';

interface StepReviewProps {
  state: {
    generatedQuestions: DraftQuestion[];
    assessmentId: string | null;
  };
  onUpdate: (updates: {
    generatedQuestions?: DraftQuestion[];
  }) => void;
  onRegenerate?: () => void;
  onSaveDraft?: () => void;
  onSaveFinal?: () => void;
  offeringId: string;
  errors: Record<string, string>;
  topics?: Topic[];
}

export default function StepReview({
  state,
  onUpdate,
  onRegenerate,
  onSaveDraft,
  onSaveFinal,
  errors,
  offeringId,
  topics,
}: StepReviewProps): JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);

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
            No questions yet. Add manually or import from the question bank.
          </p>
        </div>
        {errors.review && (
          <p className="text-sm text-[var(--color-danger)]">{errors.review}</p>
        )}
        <div className="flex gap-2">
          <Button size="sm" variant="primary" onClick={handleAddQuestion}>Add question manually</Button>
          <Button size="sm" variant="secondary" onClick={() => setBankOpen(true)}>Add from Question Bank</Button>
        </div>
        <Modal open={bankOpen} onClose={() => setBankOpen(false)} title="Import from Question Bank">
          <StepQuestionBank
            offeringId={offeringId}
            topics={topics ?? []}
            existingCount={questions.length}
            onImport={(drafts) => {
              const next = [...questions, ...drafts];
              onUpdate({ generatedQuestions: next.map((q, i) => ({ ...q, position: i + 1 })) });
              setBankOpen(false);
              if (drafts.length > 0) setSelectedIndex(questions.length);
            }}
          />
        </Modal>
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
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">
            {questions.filter((q) => getQuestionStatus(q) === 'complete').length} complete
          </Badge>
          <Badge variant="warning">
            {questions.filter((q) => getQuestionStatus(q) === 'incomplete').length} incomplete
          </Badge>
          <Button variant="secondary" size="sm" onClick={() => setBankOpen(true)}>Add from Bank</Button>
          <Button variant="outline" size="sm" onClick={handleAddQuestion}>Add manually</Button>
          {onRegenerate && (
            <Button variant="outline" size="sm" onClick={onRegenerate}>
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.311-.311h1.68a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-1.34l.311.311a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-8.424a5.5 5.5 0 00-9.201-2.466l-.311.311h1.68a.75.75 0 010 1.5H2.752a.75.75 0 01-.75-.75V4.356a.75.75 0 011.5 0v1.34l.311-.311A7 7 0 0014.263 8.78a.75.75 0 111.449.39z" clipRule="evenodd" />
              </svg>
              Regenerate
            </Button>
          )}
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
        <div className="flex-1 min-w-0 space-y-4">
          {currentQuestion && topics && topics.length > 0 && (
            <div className="flex items-center gap-3 p-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)]">
              <label className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)] whitespace-nowrap">Topic</label>
              <select
                value={(currentQuestion as any).topic_id ?? ''}
                onChange={(e) => handleUpdateQuestion(selectedIndex, { topic_id: e.target.value || null, topic_title: topics.find(t => t.id === e.target.value)?.title } as any)}
                className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm"
              >
                <option value="">— Uncategorized —</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              {(currentQuestion as any).topic_id && (
                <Badge variant="info" className="hidden sm:inline">{topics.find(t => t.id === (currentQuestion as any).topic_id)?.title}</Badge>
              )}
            </div>
          )}
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

      <Modal open={bankOpen} onClose={() => setBankOpen(false)} title="Import from Question Bank">
        <StepQuestionBank
          offeringId={offeringId}
          topics={topics ?? []}
          existingCount={questions.length}
          onImport={(drafts) => {
            const next = [...questions, ...drafts];
            onUpdate({ generatedQuestions: next.map((q, i) => ({ ...q, position: i + 1 })) });
            setBankOpen(false);
            if (drafts.length > 0) setSelectedIndex(questions.length);
          }}
        />
      </Modal>

      {/* Action buttons */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
        <p className="text-sm text-[var(--color-muted)]">
          Save your progress or finalize for approval.
        </p>
        <div className="flex gap-3">
          {onSaveDraft && (
            <Button variant="outline" onClick={onSaveDraft}>
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2.75 14A1.75 1.75 0 011 12.25v-2.5a.75.75 0 011.5 0v2.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-2.5a.75.75 0 011.5 0v2.5A1.75 1.75 0 0115.25 14H2.75z" />
                <path fillRule="evenodd" d="M3.5 6.75a.75.75 0 01.75-.75h8.5a.75.75 0 010 1.5h-8.5a.75.75 0 01-.75-.75zm.75 2.25a.75.75 0 000 1.5h5.5a.75.75 0 000-1.5h-5.5z" clipRule="evenodd" />
              </svg>
              Save as Draft
            </Button>
          )}
          {onSaveFinal && (
            <Button variant="primary" onClick={onSaveFinal}>
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
              </svg>
              Save as Final
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
