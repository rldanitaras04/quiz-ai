'use client';

import { useState, useEffect, useRef, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSupabase } from '@/lib/hooks';
import { signOut } from '@/app/actions/auth';
import type { UserRole } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/constants';

interface TopBarProps {
  title: string;
  userName: string;
  role: UserRole;
  avatarUrl: string | null;
  onNavToggle: () => void;
  /** Whether the navigation is currently open (mobile) or expanded (desktop). */
  navExpanded: boolean;
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
      // Server action clears the auth cookies; belt-and-braces client signOut
      // clears any residual local session state.
      await signOut();
      await supabase.auth.signOut();
      router.push('/login');
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
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <h1 className="text-lg font-semibold text-[var(--color-foreground)] truncate">{title}</h1>

      <div className="ml-auto flex items-center">
        {/* Notifications bell → shared notifications page */}
        <Link
          href="/notifications"
          className="p-2 rounded-[var(--radius-md)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label="Notifications"
          title="Notifications"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 01-3.46 0" />
          </svg>
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
            <svg
              className={`h-4 w-4 text-[var(--color-muted)] transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
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
                  <svg className="h-5 w-5 text-[var(--color-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                  Profile
                </Link>
                <button
                  role="menuitem"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors disabled:opacity-60"
                >
                  <svg className="h-5 w-5 text-[var(--color-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
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
