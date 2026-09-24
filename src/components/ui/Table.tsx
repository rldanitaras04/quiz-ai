import type { JSX, ReactNode } from 'react';

/**
 * Shared table primitives.
 *
 * Data Table Constitution (§12): tables are for rows with comparable columns.
 * The wrapper owns the horizontal scroll so a wide comparison table never
 * forces the page to overflow; `numeric` right-aligns figures and switches them
 * to tabular figures so digits line up between rows.
 */

type Align = 'left' | 'right' | 'center';

const ALIGN: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
};

export function Table({
  children,
  className = '',
  caption,
}: {
  children: ReactNode;
  className?: string;
  /** Visually hidden description of the table's contents, for screen readers. */
  caption?: string;
}): JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-sm ${className}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }): JSX.Element {
  return <thead>{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }): JSX.Element {
  return <tbody>{children}</tbody>;
}

export function TR({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <tr
      className={`border-b border-[var(--color-border)] last:border-0 ${className}`}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  align = 'left',
  className = '',
}: {
  children?: ReactNode;
  align?: Align;
  className?: string;
}): JSX.Element {
  return (
    <th
      scope="col"
      className={`px-4 py-3 font-medium text-[var(--color-muted)] ${ALIGN[align]} ${className}`}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  align = 'left',
  numeric = false,
  className = '',
  colSpan,
}: {
  children?: ReactNode;
  align?: Align;
  /** Right-aligns and uses tabular figures (counts, scores, percentages). */
  numeric?: boolean;
  className?: string;
  colSpan?: number;
}): JSX.Element {
  return (
    <td
      colSpan={colSpan}
      className={`px-4 py-3 ${numeric ? 'text-right tabular-nums' : ALIGN[align]} ${className}`}
    >
      {children}
    </td>
  );
}
