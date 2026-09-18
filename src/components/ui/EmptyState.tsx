import type { JSX, ReactNode } from 'react';
import Button from './Button';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  className?: string;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps): JSX.Element {
  return (
    <div className={`flex flex-col items-center justify-center py-12 px-6 text-center ${className}`}>
      {icon && (
        <div className="mb-4 text-[var(--color-muted-light)]">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-[var(--color-foreground)] mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-[var(--color-muted)] max-w-sm mb-6">
          {description}
        </p>
      )}
      {action && (
        <Button variant="primary" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}
