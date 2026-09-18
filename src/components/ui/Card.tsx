import type { JSX, ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
}

interface CardSectionProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '' }: CardProps): JSX.Element {
  return (
    <div
      className={`bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[var(--radius-lg)] shadow-[var(--shadow-sm)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = '' }: CardSectionProps): JSX.Element {
  return (
    <div className={`px-6 py-4 border-b border-[var(--color-border)] ${className}`}>
      {children}
    </div>
  );
}

export function CardContent({ children, className = '' }: CardSectionProps): JSX.Element {
  return <div className={`px-6 py-4 ${className}`}>{children}</div>;
}

export function CardFooter({ children, className = '' }: CardSectionProps): JSX.Element {
  return (
    <div className={`px-6 py-4 border-t border-[var(--color-border)] ${className}`}>
      {children}
    </div>
  );
}
