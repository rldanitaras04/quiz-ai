'use client';

import { useState, useEffect, useRef, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSupabase } from '@/lib/hooks';
import { signOut } from '@/app/actions/auth';
import type { UserRole } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/constants';
import {
  List,
  Bell,
  User,
  SignOut,
  CaretDown,
  CaretUp,
} from '@phosphor-icons/react';
import { BrandIcon } from '@/components/brand';
import { APP_NAME } from '@/lib/constants';

interface TopBarProps {
  title: string;
  userName: string;
  role: UserRole;
  avatarUrl: string | null;
  onNavToggle: () => void;
  /** Whether the navigation is currently open (mobile) or expanded (desktop). */
  navExpanded: boolean;
  /** Optional notification badge count. */
  notificationCount?: number;
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
  avatarUrl,
  onNavToggle,
  navExpanded,
  notificationCount,
}: TopBarProps): JSX.Element {
  const router = useRouter();
  const supabase = useSupabase();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  const handleLogout = async () => {
    setMenuOpen(false);
    setLoggingOut(true);
    try {
      await signOut();
      await supabase.auth.signOut();
      // Land on the public homepage after logout (not /login).
      router.push('/');
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <header className="flex items-center h-16 px-4 lg:px-6 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      {/* One control for both layouts: it opens the mobile drawer and
          collapses/expands the desktop rail. */}
      <button
        onClick={onNavToggle}
        className="p-2 -ml-2 mr-2 rounded-[var(--radius-md)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
        aria-label="Toggle navigation"
        aria-expanded={navExpanded}
      >
        <List className="h-6 w-6" weight="regular" />
      </button>

      <div className="flex items-center gap-2 min-w-0 mr-3 lg:hidden">
        <BrandIcon className="h-6 w-6" alt={APP_NAME} />
        <h1 className="text-lg font-semibold text-[var(--color-foreground)] truncate">{title}</h1>
      </div>

      <h1 className="hidden lg:block text-lg font-semibold text-[var(--color-foreground)] truncate">{title}</h1>

      <div className="ml-auto flex items-center">
        {/* Notifications bell with badge */}
        <Link
          href="/notifications"
          className="relative p-2 rounded-[var(--radius-md)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label={`Notifications${notificationCount ? ` (${notificationCount} unread)` : ''}`}
          title="Notifications"
        >
          <Bell className="h-5 w-5" weight="regular" />
          {notificationCount != null && notificationCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-[var(--color-danger)] rounded-full">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </Link>

        {/* Vertical divider */}
        <div className="h-8 w-px bg-[var(--color-border)] mx-2" aria-hidden="true" />

        {/* User menu trigger */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((prev) => !prev)}
            className="flex items-center gap-2.5 pl-1 pr-2 py-1.5 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-hover)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Open user menu"
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="h-9 w-9 rounded-full object-cover border border-[var(--color-border)]"
              />
            ) : (
              <div className="flex-shrink-0 flex items-center justify-center h-9 w-9 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-xs font-semibold">
                {initials}
              </div>
            )}
            <span className="hidden md:block text-sm font-medium text-[var(--color-foreground)] truncate max-w-[120px]">
              {userName}
            </span>
            {menuOpen ? (
              <CaretUp className="h-4 w-4 text-[var(--color-muted)]" weight="regular" />
            ) : (
              <CaretDown className="h-4 w-4 text-[var(--color-muted)]" weight="regular" />
            )}
          </button>

          {/* Dropdown */}
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-2 w-64 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)] py-2 z-50"
            >
              {/* Identity header */}
              <div className="px-4 py-3 border-b border-[var(--color-border)]">
                <div className="flex items-center gap-3">
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt=""
                      className="h-11 w-11 rounded-full object-cover border border-[var(--color-border)]"
                    />
                  ) : (
                    <div className="flex-shrink-0 flex items-center justify-center h-11 w-11 rounded-full bg-[var(--color-primary-light)] text-[var(--color-primary)] text-sm font-semibold">
                      {initials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[var(--color-foreground)] truncate">
                      {userName}
                    </p>
                    <p className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium mt-0.5 ${roleBadgeColors[role]}`}>
                      {ROLE_LABELS[role]}
                    </p>
                  </div>
                </div>
              </div>

              {/* Menu items */}
              <div className="py-1">
                <Link
                  href="/profile"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <User className="h-5 w-5 text-[var(--color-muted)]" weight="regular" />
                  Profile
                </Link>
                <button
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-60"
                >
                  <SignOut className="h-5 w-5 text-[var(--color-muted)]" weight="regular" />
                  {loggingOut ? 'Signing out…' : 'Logout'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
