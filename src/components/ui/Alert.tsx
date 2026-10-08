'use client';

import { CheckCircle, Info, WarningCircle, X, XCircle } from '@phosphor-icons/react';
import type { JSX, ReactNode } from 'react';

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  /** Optional inline actions (buttons/links) rendered under the message. */
  actions?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}

const VARIANTS: Record<AlertVariant, { classes: string; icon: typeof Info; role: 'status' | 'alert' }> = {
  info: {
    classes: 'border-[var(--color-info)]/30 bg-[var(--color-info-light)] text-[var(--color-foreground)]',
    icon: Info,
    role: 'status',
  },
  success: {
    classes:
      'border-[var(--color-success)]/30 bg-[var(--color-success-light)] text-[var(--color-foreground)]',
    icon: CheckCircle,
    role: 'status',
  },
  warning: {
    classes:
      'border-[var(--color-warning)]/40 bg-[var(--color-warning-light)] text-[var(--color-foreground)]',
    icon: WarningCircle,
    role: 'status',
  },
  danger: {
    classes: 'border-[var(--color-danger)]/30 bg-[var(--color-danger-light)] text-[var(--color-foreground)]',
    icon: XCircle,
    role: 'alert',
  },
};

/**
 * Persistent, in-page message (form-level errors, offline banners, policy
 * notes). Transient feedback goes through `alerts.ts` toasts instead; this is
 * for content that must stay until the user acts on it.
 */
export default function Alert({
  variant = 'info',
  title,
  children,
  actions,
  onDismiss,
  className = '',
}: AlertProps): JSX.Element {
  const config = VARIANTS[variant];
  const Icon = config.icon;

  return (
    <div
      role={config.role}
      className={`flex gap-3 rounded-[var(--radius-md)] border px-4 py-3 ${config.classes} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold">{title}</p>}
        <div className="text-sm leading-relaxed [&:not(:first-child)]:mt-1">{children}</div>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-mr-1 h-6 w-6 shrink-0 rounded text-[var(--color-muted)] transition-colors hover:text-[var(--color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        >
          <X className="mx-auto h-4 w-4" />
        </button>
      )}
    </div>
  );
}
