'use client';

import { useSyncExternalStore, type JSX } from 'react';
import { Moon, Sun } from '@phosphor-icons/react';
import {
  getTheme,
  getThemeServerSnapshot,
  subscribeTheme,
  toggleTheme,
} from '@/lib/ui-preferences';

interface ThemeToggleProps {
  /** Spacing/sizing belongs to the bar that hosts the button. */
  className?: string;
}

/**
 * Light/dark switch shared by the dashboard TopBar and the public landing
 * nav, so the two cannot drift apart in wording or behaviour.
 *
 * The icon reflects the RESOLVED theme (system preference included) via
 * useSyncExternalStore, so it stays correct when the OS flips its own
 * preference; `toggleTheme` then pins an explicit light/dark choice, which
 * the pre-paint script in the root layout applies before first paint on the
 * next visit (no flash).
 */
export default function ThemeToggle({ className = '' }: ThemeToggleProps): JSX.Element {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, getThemeServerSnapshot);
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`rounded-[var(--radius-md)] text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${className}`}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? (
        <Sun className="h-5 w-5" weight="regular" />
      ) : (
        <Moon className="h-5 w-5" weight="regular" />
      )}
    </button>
  );
}
