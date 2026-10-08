'use client';

import { MagnifyingGlass, X } from '@phosphor-icons/react';
import type { JSX } from 'react';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name when no visible label is rendered (toolbars, tables). */
  ariaLabel?: string;
  className?: string;
}

/**
 * Filter field with the same surface/focus treatment as `Input`, plus a
 * leading magnifier and a clear button. Toolbars previously hand-rolled this
 * in several slightly different ways.
 */
export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  ariaLabel = 'Search',
  className = '',
}: SearchInputProps): JSX.Element {
  return (
    <div className={`relative ${className}`}>
      <MagnifyingGlass
        className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-8 pr-8 text-sm text-[var(--color-foreground)] placeholder:text-[var(--color-muted-light)] transition-colors focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-focus-ring)] focus:outline-none"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute inset-y-0 right-1.5 flex items-center rounded px-1 text-[var(--color-muted)] transition-colors hover:text-[var(--color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
