'use client';

import type { JSX } from 'react';
import Button from '@/components/ui/Button';
import type { QuestionWithChoices } from '@/lib/types';


interface QuestionNavigatorProps {
  questions: QuestionWithChoices[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  getQuestionStatus: (q: QuestionWithChoices) => 'complete' | 'incomplete';
}

export default function QuestionNavigator({
  questions,
  selectedIndex,
  onSelect,
  onAdd,
  getQuestionStatus,
}: QuestionNavigatorProps): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-[var(--color-muted)] uppercase tracking-wide mb-2">
        Questions ({questions.length})
      </div>

      <div className="space-y-1 max-h-[500px] overflow-y-auto pr-1">
        {questions.map((q, index) => {
          const status = getQuestionStatus(q);
          const isSelected = index === selectedIndex;
          const typeIcon = q.question_type === 'multiple_choice' ? 'MC' : 'ID';

          return (
            <button
              key={q.id}
              onClick={() => onSelect(index)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] text-left text-sm transition-colors ${
                isSelected
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'hover:bg-[var(--color-surface-hover)] text-[var(--color-foreground)]'
              }`}
            >
              <span
                className={`shrink-0 w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold ${
                  isSelected
                    ? 'bg-white/20 text-white'
                    : q.question_type === 'multiple_choice'
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                }`}
              >
                {typeIcon}
              </span>

              <span className="flex-1 truncate">
                {q.question_text
                  ? `${index + 1}. ${q.question_text.slice(0, 30)}${q.question_text.length > 30 ? '...' : ''}`
                  : `${index + 1}. (empty)`}
              </span>

              {status === 'complete' ? (
                <svg className={`w-4 h-4 shrink-0 ${isSelected ? 'text-white' : 'text-[var(--color-success)]'}`} viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                </svg>
              ) : (
                <span className={`w-2 h-2 rounded-full shrink-0 ${isSelected ? 'bg-white' : 'bg-[var(--color-warning)]'}`} />
              )}
            </button>
          );
        })}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full mt-2"
        onClick={onAdd}
      >
        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
        </svg>
        Add Question
      </Button>
    </div>
  );
}
