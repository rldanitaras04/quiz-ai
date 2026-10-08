'use client';

import type { TextareaHTMLAttributes, JSX } from 'react';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  /** Neutral hint under the field (format rules, examples); hidden when `error` shows. */
  helper?: string;
  required?: boolean;
}

/**
 * Multi-line field with the same label/helper/error contract as `Input` and
 * `Select`, so forms don't hand-roll their own textarea styling (there were
 * 16 raw ones, each with slightly different borders and focus rings).
 */
export default function Textarea({
  label,
  error,
  helper,
  required = false,
  id,
  rows = 4,
  className = '',
  ...props
}: TextareaProps): JSX.Element {
  const fieldId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={fieldId}
          className="text-sm font-medium text-[var(--color-foreground)]"
        >
          {label}
          {required && <span className="text-[var(--color-danger)] ml-0.5">*</span>}
        </label>
      )}
      <textarea
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={!!error}
        aria-describedby={
          [helper && !error ? `${fieldId}-helper` : null, error ? `${fieldId}-error` : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        className={`w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 resize-y ${
          error
            ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-[var(--color-danger-light)]'
            : 'border-[var(--color-border)]'
        } ${className}`}
        {...props}
      />
      {helper && !error && (
        <p id={`${fieldId}-helper`} className="text-xs text-[var(--color-muted)]">
          {helper}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
