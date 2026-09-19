'use client';

import { useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import { QUESTION_TYPE_LABELS, DIFFICULTY_LABELS, BLOOM_LABELS } from '@/lib/constants';
import type {
  DraftQuestion,
  QuestionType,
  Difficulty,
  BloomLevel,
} from '@/lib/types';

interface QuestionEditorProps {
  question: DraftQuestion;
  index: number;
  total: number;
  onUpdate: (updates: Partial<DraftQuestion>) => void;
  onDelete: () => void;
  onNavigate: (direction: -1 | 1) => void;
}

export default function QuestionEditor({
  question,
  index,
  total,
  onUpdate,
  onDelete,
  onNavigate,
}: QuestionEditorProps): JSX.Element {
  const [isDirty, setIsDirty] = useState(false);

  const handleTextChange = (value: string) => {
    onUpdate({ question_text: value });
    setIsDirty(true);
  };

  const handleTypeChange = (type: QuestionType) => {
    const updates: Partial<DraftQuestion> = { question_type: type };
    if (type === 'identification') {
      updates.question_choices = [];
    } else if (type === 'multiple_choice' && question.question_choices.length === 0) {
      updates.question_choices = [
        { id: `nc-${Date.now()}-a`, question_id: question.id, choice_key: 'A', choice_text: '', position: 0, created_at: '', updated_at: '' },
        { id: `nc-${Date.now()}-b`, question_id: question.id, choice_key: 'B', choice_text: '', position: 1, created_at: '', updated_at: '' },
        { id: `nc-${Date.now()}-c`, question_id: question.id, choice_key: 'C', choice_text: '', position: 2, created_at: '', updated_at: '' },
        { id: `nc-${Date.now()}-d`, question_id: question.id, choice_key: 'D', choice_text: '', position: 3, created_at: '', updated_at: '' },
      ];
    }
    onUpdate(updates);
    setIsDirty(true);
  };

  const handleChoiceTextChange = (choiceIndex: number, text: string) => {
    const next = question.question_choices.map((c, i) =>
      i === choiceIndex ? { ...c, choice_text: text } : c
    );
    onUpdate({ question_choices: next });
    setIsDirty(true);
  };

  const handleAddChoice = () => {
    const keys = 'ABCDEFGHIJKLMNOP';
    const next = [
      ...question.question_choices,
      {
        id: `nc-${Date.now()}`,
        question_id: question.id,
        choice_key: keys[question.question_choices.length] || String(question.question_choices.length + 1),
        choice_text: '',
        position: question.question_choices.length,
        created_at: '',
        updated_at: '',
      },
    ];
    onUpdate({ question_choices: next });
    setIsDirty(true);
  };

  const handleRemoveChoice = (choiceIndex: number) => {
    const next = question.question_choices.filter((_, i) => i !== choiceIndex);
    onUpdate({ question_choices: next });
    setIsDirty(true);
  };

  const isComplete = () => {
    if (!question.question_text.trim()) return false;
    if (question.question_type === 'multiple_choice') {
      return question.question_choices.filter((c) => c.choice_text.trim()).length >= 2;
    }
    return true;
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant={question.is_ai_generated ? 'info' : 'outline'}>
            {question.is_ai_generated ? 'AI Generated' : 'Manual'}
          </Badge>
          <Badge variant={isComplete() ? 'success' : 'warning'}>
            {isComplete() ? 'Complete' : 'Incomplete'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate(-1)}
            disabled={index === 0}
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </Button>
          <span className="text-sm text-[var(--color-muted)]">
            {index + 1} / {total}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate(1)}
            disabled={index === total - 1}
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </Button>
        </div>
      </div>

      {/* Question Text */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-[var(--color-foreground)]">
          Question Text <span className="text-[var(--color-danger)]">*</span>
        </label>
        <textarea
          rows={3}
          value={question.question_text}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder="Enter the question text..."
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none resize-none"
        />
      </div>

      {/* Type / Difficulty / Bloom / Points */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Select
          label="Question Type"
          value={question.question_type}
          onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
        >
          {(['multiple_choice', 'identification'] as const).map((t) => (
            <option key={t} value={t}>
              {QUESTION_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>

        <Select
          label="Difficulty"
          value={question.difficulty}
          onChange={(e) => {
            onUpdate({ difficulty: e.target.value as Difficulty });
            setIsDirty(true);
          }}
        >
          {(['easy', 'moderate', 'difficult'] as const).map((d) => (
            <option key={d} value={d}>
              {DIFFICULTY_LABELS[d]}
            </option>
          ))}
        </Select>

        <Select
          label="Bloom's Level"
          value={question.bloom_level}
          onChange={(e) => {
            onUpdate({ bloom_level: e.target.value as BloomLevel });
            setIsDirty(true);
          }}
        >
          {(['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const).map((b) => (
            <option key={b} value={b}>
              {BLOOM_LABELS[b]}
            </option>
          ))}
        </Select>

        <Input
          label="Points"
          type="number"
          min={1}
          max={100}
          value={question.points}
          onChange={(e) => {
            onUpdate({ points: parseInt(e.target.value) || 1 });
            setIsDirty(true);
          }}
        />
      </div>

      {/* Choices for MCQ */}
      {question.question_type === 'multiple_choice' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-[var(--color-foreground)]">
              Choices
            </label>
          </div>
          <div className="space-y-2">
            {question.question_choices.map((choice, ci) => (
              <div key={choice.id} className="flex items-center gap-2">
                <span className="shrink-0 w-8 text-center text-sm font-bold text-[var(--color-muted)]">
                  {choice.choice_key}.
                </span>
                <input
                  type="text"
                  value={choice.choice_text}
                  onChange={(e) => handleChoiceTextChange(ci, e.target.value)}
                  placeholder={`Choice ${choice.choice_key}`}
                  className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
                />
                {question.question_choices.length > 2 && (
                  <button
                    type="button"
                    onClick={() => handleRemoveChoice(ci)}
                    className="p-1.5 rounded text-[var(--color-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger-light)] transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={handleAddChoice}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            Add Choice
          </Button>
        </div>
      )}

      {/* Answer for Identification */}
      {question.question_type === 'identification' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[var(--color-foreground)]">
            Canonical Answer
          </label>
          <input
            type="text"
            value={question.canonical_answer || ''}
            onChange={(e) => {
              onUpdate({ canonical_answer: e.target.value });
              setIsDirty(true);
            }}
            placeholder="Enter the expected answer..."
            className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            if (confirm('Delete this question?')) onDelete();
          }}
        >
          <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5z" clipRule="evenodd" />
          </svg>
          Delete
        </Button>
        {isDirty && (
          <Badge variant="info">Unsaved changes</Badge>
        )}
      </div>
    </div>
  );
}
