'use client';

import { useState, useRef, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { confirmAction, notifyError } from '@/components/ui/alerts';
import { QUESTION_TYPE_LABELS, DIFFICULTY_LABELS, BLOOM_LABELS, SUPPORTED_QUESTION_IMAGE_TYPES, MAX_QUESTION_IMAGE_SIZE_MB, TRUE_FALSE_CHOICES } from '@/lib/constants';
import { createClient } from '@/lib/supabase/client';
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
  /**
   * Confirm copy for the delete button. Defaults to the wizard wording; the
   * saved-question editor overrides it because nothing there is a draft.
   */
  deleteTitle?: string;
  deleteText?: string;
  /** Offering id for image upload scoping (optional — falls back to user folder). */
  offeringId?: string;
}

export default function QuestionEditor({
  question,
  index,
  total,
  onUpdate,
  onDelete,
  onNavigate,
  deleteTitle = 'Delete this question?',
  deleteText = 'The question and its choices are removed from this draft.',
  offeringId,
}: QuestionEditorProps): JSX.Element {
  const [isDirty, setIsDirty] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const handleTextChange = (value: string) => {
    onUpdate({ question_text: value });
    setIsDirty(true);
  };

  const handleTypeChange = (type: QuestionType) => {
    const updates: Partial<DraftQuestion> = { question_type: type };
    if (type === 'identification') {
      updates.question_choices = [];
    } else if (type === 'true_false') {
      updates.canonical_answer = '';
      updates.question_choices = TRUE_FALSE_CHOICES.map((c, idx) => ({
        id: `tf-${question.id}-${c.choice_key}`,
        question_id: question.id,
        choice_key: c.choice_key,
        choice_text: c.choice_text,
        position: idx,
        created_at: '',
        updated_at: '',
        is_correct: c.is_correct,
      }));
    } else if (type === 'multiple_choice' && question.question_choices.length === 0) {
      updates.question_choices = [
        { id: `nc-${Date.now()}-a`, question_id: question.id, choice_key: 'A', choice_text: '', position: 0, created_at: '', updated_at: '' },
        { id: `nc-${Date.now()}-b`, question_id: question.id, choice_key: 'B', choice_text: '', position: 1, created_at: '', updated_at: '' },
        { id: `nc-${Date.now()}-c`, question_id: question.id, choice_key: 'C', choice_text: '', position: 2, created_at: '', updated_at: '' },
        { id: `nc-${Date.now()}-d`, question_id: question.id, choice_key: 'D', choice_text: '', position: 3, created_at: '', updated_at: '' },
      ];
    } else if (type === 'multiple_choice' && question.question_type === 'true_false') {
      // Leaving True/False: reset to a blank 4-choice MCQ.
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

  const handleDelete = async () => {
    const confirmed = await confirmAction({
      title: deleteTitle,
      text: deleteText,
      confirmText: 'Delete',
      destructive: true,
    });
    if (confirmed) onDelete();
  };

  const handleImageFile = async (file: File) => {
    setImageError(null);
    if (!SUPPORTED_QUESTION_IMAGE_TYPES.includes(file.type as typeof SUPPORTED_QUESTION_IMAGE_TYPES[number])) {
      setImageError('Unsupported image type. Use JPEG, PNG, WebP, GIF or SVG.');
      return;
    }
    if (file.size > MAX_QUESTION_IMAGE_SIZE_MB * 1024 * 1024) {
      setImageError(`Image too large. Maximum size: ${MAX_QUESTION_IMAGE_SIZE_MB} MB`);
      return;
    }
    setUploadingImage(true);
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Session expired. Please sign in again.');
      const form = new FormData();
      form.append('file', file);
      if (offeringId) form.append('offeringId', offeringId);
      const res = await fetch('/api/questions/upload-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      onUpdate({ image_url: data.url, image_storage_path: data.storagePath } as Partial<DraftQuestion>);
      setIsDirty(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      setImageError(msg);
      notifyError('Image upload failed', msg);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleImageFile(f);
  };

  const removeImage = () => {
    onUpdate({ image_url: null, image_storage_path: null } as Partial<DraftQuestion>);
    setIsDirty(true);
    setImageError(null);
  };

  const isComplete = () => {
    if (!question.question_text.trim()) return false;
    if (question.question_type === 'multiple_choice') {
      return (
        question.question_choices.filter((c) => c.choice_text.trim()).length >= 2 &&
        question.question_choices.some((c) => c.is_correct)
      );
    }
    if (question.question_type === 'true_false') {
      return question.question_choices.some((c) => c.is_correct);
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

      {/* Question Image (optional) */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-[var(--color-foreground)]">
          Question Image <span className="text-[var(--color-muted)] font-normal">(optional — diagram, figure, or illustration)</span>
        </label>
        {(question as any).image_url ? (
          <div className="relative rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-hover)] p-2">
            <img
              src={(question as any).image_url as string}
              alt="Question illustration"
              className="max-h-64 w-auto mx-auto rounded object-contain"
              loading="lazy"
            />
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-[var(--color-muted)] truncate max-w-[60%]">{(question as any).image_url}</span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => imageInputRef.current?.click()} disabled={uploadingImage}>Replace</Button>
                <Button variant="danger" size="sm" onClick={removeImage}>Remove</Button>
              </div>
            </div>
          </div>
        ) : (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
            onDrop={handleImageDrop}
            onClick={() => imageInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border-2 border-dashed p-6 text-center cursor-pointer transition-colors ${
              dragActive ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] hover:border-[var(--color-primary)]/40 bg-[var(--color-surface)]'
            }`}
          >
            <svg className="w-8 h-8 text-[var(--color-muted-light)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[var(--color-foreground)]">{uploadingImage ? 'Uploading…' : 'Click to upload or drag & drop'}</p>
              <p className="text-xs text-[var(--color-muted)] mt-1">PNG, JPG, WebP, GIF, SVG • max {MAX_QUESTION_IMAGE_SIZE_MB} MB</p>
            </div>
            {uploadingImage && <Spinner size="sm" />}
          </div>
        )}
        <input
          ref={imageInputRef}
          type="file"
          accept={SUPPORTED_QUESTION_IMAGE_TYPES.join(',')}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleImageFile(f);
            e.target.value = '';
          }}
        />
        {imageError && <p className="text-xs text-[var(--color-danger)]">{imageError}</p>}
        <p className="text-xs text-[var(--color-muted)]">Images are stored per question and shown to students during the exam. They are also saved to the Question Bank when you save items there.</p>
      </div>

      {/* Type / Difficulty / Bloom / Points */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Select
          label="Question Type"
          value={question.question_type}
          onChange={(e) => handleTypeChange(e.target.value as QuestionType)}
        >
          {(['multiple_choice', 'identification', 'true_false'] as const).map((t) => (
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
              Choices <span className="text-[var(--color-muted)] font-normal">(click checkmark to mark correct answer)</span>
            </label>
          </div>
          <div className="space-y-2">
            {question.question_choices.map((choice, ci) => {
              const isCorrect = choice.is_correct;
              return (
                <div
                  key={choice.id}
                  className={`flex items-center gap-2 p-2 rounded-[var(--radius-md)] border transition-colors ${
                    isCorrect
                      ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      const next = question.question_choices.map((c, i) => ({
                        ...c,
                        is_correct: i === ci,
                      }));
                      onUpdate({ question_choices: next });
                      setIsDirty(true);
                    }}
                    className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      isCorrect
                        ? 'border-[var(--color-success)] bg-[var(--color-success)] text-white'
                        : 'border-[var(--color-border)] hover:border-[var(--color-muted)]'
                    }`}
                    title={isCorrect ? 'Correct answer' : 'Mark as correct'}
                  >
                    {isCorrect && (
                      <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                  <span className="shrink-0 w-8 text-center text-sm font-bold text-[var(--color-muted)]">
                    {choice.choice_key}.
                  </span>
                  <textarea
                    rows={2}
                    value={choice.choice_text}
                    onChange={(e) => handleChoiceTextChange(ci, e.target.value)}
                    placeholder={`Choice ${choice.choice_key}`}
                    className="flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none resize-none"
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
              );
            })}
          </div>
          <Button variant="ghost" size="sm" onClick={handleAddChoice}>
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            Add Choice
          </Button>
        </div>
      )}

      {/* True / False (incl. Modified True or False statements) */}
      {question.question_type === 'true_false' && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-[var(--color-foreground)]">
            Correct answer{' '}
            <span className="text-[var(--color-muted)] font-normal">
              (mark True or False for this statement)
            </span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            {question.question_choices.map((choice, ci) => {
              const isCorrect = choice.is_correct;
              return (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => {
                    const next = question.question_choices.map((c, i) => ({
                      ...c,
                      is_correct: i === ci,
                    }));
                    onUpdate({ question_choices: next });
                    setIsDirty(true);
                  }}
                  className={`flex items-center justify-center gap-2 p-4 rounded-[var(--radius-md)] border-2 text-sm font-semibold transition-colors ${
                    isCorrect
                      ? 'border-[var(--color-success)] bg-[var(--color-success)]/10 text-[var(--color-success)]'
                      : 'border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-primary)]/40'
                  }`}
                  aria-pressed={isCorrect}
                >
                  {isCorrect && (
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                  {choice.choice_text}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Answer for Identification */}
      {question.question_type === 'identification' && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-[var(--color-foreground)]">
            Correct Answer
          </label>
          <div className="flex items-center gap-2 p-3 rounded-[var(--radius-md)] border border-[var(--color-success)] bg-[var(--color-success)]/5">
            <svg className="w-5 h-5 text-[var(--color-success)] shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <textarea
              rows={2}
              value={question.canonical_answer || ''}
              onChange={(e) => {
                onUpdate({ canonical_answer: e.target.value });
                setIsDirty(true);
              }}
              placeholder="Enter the expected answer..."
              className="flex-1 bg-transparent border-none text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] focus:outline-none resize-none"
            />
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center justify-between pt-4 border-t border-[var(--color-border)]">
        <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
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
