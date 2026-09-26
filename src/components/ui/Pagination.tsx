'use client';

import { type JSX } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';

const MAX_BUTTONS = 7;

/** Page numbers to render: 1, pageCount, and a window around the current page. */
function pageWindow(page: number, pageCount: number): Array<number | 'gap'> {
  const candidates = new Set<number>([1, pageCount]);
  for (let p = page - 1; p <= page + 1; p += 1) {
    if (p >= 1 && p <= pageCount) candidates.add(p);
  }

  let numbers = [...candidates].sort((a, b) => a - b);
  if (numbers.length > MAX_BUTTONS) {
    const half = Math.floor(MAX_BUTTONS / 2);
    const start = Math.max(1, Math.min(page - half, pageCount - MAX_BUTTONS + 1));
    numbers = Array.from({ length: MAX_BUTTONS }, (_, i) => start + i);
  }

  const items: Array<number | 'gap'> = [];
  let previous = 0;
  for (const n of numbers) {
    if (previous && n - previous > 1) items.push('gap');
    items.push(n);
    previous = n;
  }
  return items;
}

/**
 * Client-side pagination footer: "Showing X–Y of Z" plus prev/numbered/next
 * controls. Renders nothing when the data fits on a single page.
 */
export default function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}): JSX.Element | null {
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;

  const current = Math.min(Math.max(page, 1), pageCount);
  const from = (current - 1) * pageSize + 1;
  const to = Math.min(current * pageSize, total);

  const buttonClass = (active: boolean): string =>
    `flex h-8 min-w-8 items-center justify-center rounded-[var(--radius-md)] px-2 text-sm transition-colors ${
      active
        ? 'bg-[var(--color-primary)] font-semibold text-white'
        : 'border border-[var(--color-border)] text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
    } disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent`;

  return (
    <nav
      className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      aria-label="Pagination"
    >
      <p className="text-sm text-[var(--color-muted)]">
        Showing{' '}
        <span className="font-medium text-[var(--color-foreground)]">
          {from}–{to}
        </span>{' '}
        of {total.toLocaleString()}
      </p>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          className={buttonClass(false)}
          aria-label="Previous page"
        >
          <CaretLeft className="h-4 w-4" weight="bold" />
        </button>

        {pageWindow(current, pageCount).map((item, index) =>
          item === 'gap' ? (
            <span
              key={`gap-${index}`}
              className="px-1 text-sm text-[var(--color-muted)]"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              aria-current={item === current ? 'page' : undefined}
              className={buttonClass(item === current)}
            >
              {item}
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          className={buttonClass(false)}
          aria-label="Next page"
        >
          <CaretRight className="h-4 w-4" weight="bold" />
        </button>
      </div>
    </nav>
  );
}
