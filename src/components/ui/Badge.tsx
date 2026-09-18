import type { JSX, ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

interface BadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default:
    'bg-[var(--color-surface-hover)] text-[var(--color-muted)] border border-[var(--color-border)]',
  success:
    'bg-[var(--color-success-light)] text-[var(--color-success)] border border-[var(--color-success)]/20',
  warning:
    'bg-[var(--color-warning-light)] text-[var(--color-warning)] border border-[var(--color-warning)]/20',
  danger:
    'bg-[var(--color-danger-light)] text-[var(--color-danger)] border border-[var(--color-danger)]/20',
  info:
    'bg-[var(--color-info-light)] text-[var(--color-info)] border border-[var(--color-info)]/20',
  outline:
    'bg-transparent text-[var(--color-muted)] border border-[var(--color-border-strong)]',
};

export default function Badge({
  children,
  variant = 'default',
  className = '',
}: BadgeProps): JSX.Element {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
