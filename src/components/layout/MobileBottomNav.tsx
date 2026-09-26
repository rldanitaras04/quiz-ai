'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type JSX } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  DotsThree,
  Moon,
  SignOut,
  Sun,
  X,
} from '@phosphor-icons/react';
import { useSignOut } from '@/lib/hooks';
import type { UserRole } from '@/lib/types';
import {
  getBottomNavigationForRole,
  isNavActive,
  type NavigationItem,
} from '@/config/navigation';
import {
  getTheme,
  getThemeServerSnapshot,
  setTheme,
  subscribeTheme,
} from '@/lib/ui-preferences';

interface MobileBottomNavProps {
  role: UserRole;
  /** Unread notification count surfaced inside the "More" sheet. */
  notificationCount?: number;
}

/**
 * Compact mobile bottom bar. Slots are resolved from the single centralized
 * `GLOBAL_NAVIGATION` config by id, so this component never defines a route of
 * its own — the desktop sidebar, mobile drawer, and this bar all read the same
 * rows. Rendered only for roles that declare bottom slots, and suppressed on
 * full-screen routes (secure exam) by the shell.
 */
export default function MobileBottomNav({
  role,
  notificationCount,
}: MobileBottomNavProps): JSX.Element | null {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const { primary, overflow } = getBottomNavigationForRole(role);

  const closeMore = useCallback(() => setMoreOpen(false), []);

  // Close the sheet on Escape. Route changes reset it via the `key` the shell
  // passes, so no state update is needed inside an effect here.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  if (primary.length === 0) return null;

  return (
    <>
      <nav
        className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)] lg:hidden"
        aria-label="Primary mobile navigation"
      >
        <ul className="grid" style={{ gridTemplateColumns: `repeat(${primary.length + 1}, minmax(0, 1fr))` }}>
          {primary.map((item) => (
            <BottomNavItem key={item.id} item={item} pathname={pathname} />
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[var(--color-muted)] transition-colors hover:text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              aria-controls="mobile-more-sheet"
            >
              <DotsThree className="h-6 w-6" weight="bold" aria-hidden="true" />
              <span className="text-[10px] font-medium leading-none">More</span>
            </button>
          </li>
        </ul>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="More navigation"
          id="mobile-more-sheet"
        >
          <div className="absolute inset-0 bg-black/50" onClick={closeMore} aria-hidden="true" />
          <div className="relative w-full animate-slide-down rounded-t-[var(--radius-xl)] border-t border-[var(--color-border)] bg-[var(--color-surface)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
              <p className="text-sm font-semibold text-[var(--color-foreground)]">More</p>
              <button
                type="button"
                onClick={closeMore}
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
                aria-label="Close more navigation"
              >
                <X className="h-5 w-5" weight="regular" />
              </button>
            </div>

            <ul className="max-h-[60vh] overflow-y-auto py-2">
              {overflow.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href ?? '#'}
                    onClick={closeMore}
                    className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors ${
                      isNavActive(item, pathname)
                        ? 'font-semibold text-[var(--color-primary)]'
                        : 'text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                    aria-current={isNavActive(item, pathname) ? 'page' : undefined}
                  >
                    <item.icon className="h-5 w-5 shrink-0" weight="regular" aria-hidden="true" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.id === 'notifications' && notificationCount != null && notificationCount > 0 && (
                      <span className="flex min-w-[20px] items-center justify-center rounded-full bg-[var(--color-danger)] px-1.5 text-[10px] font-bold leading-[18px] text-white">
                        {notificationCount > 99 ? '99+' : notificationCount}
                      </span>
                    )}
                  </Link>
                </li>
              ))}

              <li className="mt-1 border-t border-[var(--color-border)] pt-1">
                <ThemeRow />
              </li>
              <li>
                <SignOutRow />
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

function BottomNavItem({
  item,
  pathname,
}: {
  item: NavigationItem;
  pathname: string;
}): JSX.Element {
  const active = isNavActive(item, pathname);
  const Icon = item.icon;

  return (
    <li>
      <Link
        href={item.href ?? '#'}
        className={`flex w-full flex-col items-center gap-1 px-1 py-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] ${
          active ? 'text-[var(--color-primary)]' : 'text-[var(--color-muted)] hover:text-[var(--color-foreground)]'
        }`}
        aria-current={active ? 'page' : undefined}
      >
        <Icon className="h-6 w-6" weight={active ? 'fill' : 'regular'} aria-hidden="true" />
        <span className="max-w-full truncate px-0.5 text-[10px] font-medium leading-none">
          {item.shortLabel ?? item.label}
        </span>
      </Link>
    </li>
  );
}

function ThemeRow(): JSX.Element {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getThemeServerSnapshot);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
    >
      {isDark ? (
        <Sun className="h-5 w-5 shrink-0 text-[var(--color-muted)]" weight="regular" aria-hidden="true" />
      ) : (
        <Moon className="h-5 w-5 shrink-0 text-[var(--color-muted)]" weight="regular" aria-hidden="true" />
      )}
      <span className="flex-1 text-left">Theme</span>
      <span className="text-xs capitalize text-[var(--color-muted)]">{isDark ? 'Dark' : 'Light'}</span>
    </button>
  );
}

function SignOutRow(): JSX.Element {
  const { signOut, signingOut } = useSignOut();

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={signingOut}
      className="flex w-full items-center gap-3 px-4 py-3 text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-light)] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
    >
      <SignOut className="h-5 w-5 shrink-0" weight="regular" aria-hidden="true" />
      <span className="flex-1 text-left">{signingOut ? 'Signing out…' : 'Sign Out'}</span>
    </button>
  );
}
