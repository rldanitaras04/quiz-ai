'use client';

import { useSyncExternalStore, type JSX } from 'react';
import {
  getThemePreference,
  getThemePreferenceServerSnapshot,
  setTheme,
  subscribeTheme,
  type ThemePreference,
} from '@/lib/ui-preferences';

const OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/**
 * Theme preference segmented control. Reads/writes the same store as the
 * top-bar toggle (ui-preferences), so both stay in sync across tabs.
 */
export default function ThemeSetting(): JSX.Element {
  const preference = useSyncExternalStore(
    subscribeTheme,
    getThemePreference,
    getThemePreferenceServerSnapshot
  );

  return (
    <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-2">
      {OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(option.value)}
            className={`rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
              selected
                ? 'border-[var(--color-primary)] bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                : 'border-[var(--color-border)] text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
