'use client';

import type { SelectHTMLAttributes, JSX, ReactNode } from 'react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  /** Neutral hint under the field; hidden when `error` shows. */
  helper?: string;
  children: ReactNode;
}

export default function Select({
  label,
  error,
  helper,
  required = false,
  id,
  children,
  className = '',
  ...props
}: SelectProps): JSX.Element {
  const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-[var(--color-foreground)]"
        >
          {label}
          {required && <span className="text-[var(--color-danger)] ml-0.5">*</span>}
        </label>
      )}
      <select
        id={selectId}
        required={required}
        aria-invalid={!!error}
        aria-describedby={
          [helper && !error ? `${selectId}-helper` : null, error ? `${selectId}-error` : null]
            .filter(Boolean)
            .join(' ') || undefined
        }
        className={`w-full rounded-[var(--radius-md)] border bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-foreground)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
          error
            ? 'border-[var(--color-danger)] focus:border-[var(--color-danger)] focus:ring-[var(--color-danger-light)]'
            : 'border-[var(--color-border)]'
        } ${className}`}
        {...props}
      >
        {children}
      </select>
      {helper && !error && (
        <p id={`${selectId}-helper`} className="text-xs text-[var(--color-muted)]">
          {helper}
        </p>
      )}
      {error && (
        <p id={`${selectId}-error`} className="text-xs text-[var(--color-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
