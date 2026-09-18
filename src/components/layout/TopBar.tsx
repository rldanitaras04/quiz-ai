'use client';

import type { JSX } from 'react';
import type { UserRole } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/constants';

interface TopBarProps {
  title: string;
  userName: string;
  role: UserRole;
  onMenuToggle: () => void;
}

const roleBadgeColors: Record<UserRole, string> = {
  super_admin: 'bg-[var(--color-danger-light)] text-[var(--color-danger)]',
  faculty: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
  student: 'bg-[var(--color-success-light)] text-[var(--color-success)]',
};

export default function TopBar({
  title,
  userName,
  role,
  onMenuToggle,
}: TopBarProps): JSX.Element {
  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="flex items-center h-16 px-4 lg:px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={onMenuToggle}
        className="lg:hidden p-2 -ml-2 mr-2 rounded-[var(--radius-md)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors"
        aria-label="Toggle navigation menu"
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <h1 className="text-lg font-semibold text-[var(--color-foreground)] truncate">{title}</h1>

      <div className="ml-auto flex items-center gap-3">
        <button
          className="relative p-2 rounded-[var(--radius-md)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label="Notifications"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
        </button>

        <span className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${roleBadgeColors[role]}`}>
          {ROLE_LABELS[role]}
        </span>

        <div className="flex items-center gap-2.5 pl-3 border-l border-[var(--color-border)]">
          <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-xs font-semibold">
            {initials}
          </div>
          <span className="hidden md:block text-sm font-medium text-[var(--color-foreground)] truncate max-w-[120px]">
            {userName}
          </span>
        </div>
      </div>
    </header>
  );
}
