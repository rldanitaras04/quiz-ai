import type { JSX } from 'react';

interface SkeletonProps {
  /** Tailwind size classes; override to match the content being replaced. */
  className?: string;
}

/**
 * Shimmering placeholder block for loading states (`.skeleton` in
 * globals.css). Prefer this over page-shaped skeleton layouts that flash a
 * guess of the final dashboard before data arrives.
 *
 *   <Skeleton className="h-4 w-40" />        one line
 *   <Skeleton className="h-24 w-full" />     a card-sized block
 */
export default function Skeleton({ className = 'h-4 w-full' }: SkeletonProps): JSX.Element {
  return (
    <div
      aria-hidden="true"
      className={`skeleton rounded-[var(--radius-sm)] ${className}`}
    />
  );
}
