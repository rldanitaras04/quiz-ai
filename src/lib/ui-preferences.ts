/**
 * Small external stores for chrome preferences.
 *
 * These exist so components can read browser state through
 * `useSyncExternalStore` instead of copying it into state inside an effect:
 * SSR-safe (every reader has a server snapshot), and a write notifies every
 * subscriber in the tab, which `localStorage` alone does not do.
 */

const COLLAPSE_KEY = 'mimo:sidebar-collapsed';
const DESKTOP_QUERY = '(min-width: 1024px)';

const collapseListeners = new Set<() => void>();

// ---------------------------------------------------------------------------
// Sidebar collapse preference
// ---------------------------------------------------------------------------

export function subscribeSidebarCollapsed(listener: () => void): () => void {
  collapseListeners.add(listener);

  // Propagate a change made in another tab.
  const onStorage = (event: StorageEvent) => {
    if (event.key === COLLAPSE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    collapseListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function getSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(COLLAPSE_KEY) === 'true';
}

export function getSidebarCollapsedServerSnapshot(): boolean {
  return false;
}

export function setSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(COLLAPSE_KEY, String(collapsed));
  for (const listener of collapseListeners) listener();
}

// ---------------------------------------------------------------------------
// Desktop breakpoint
// ---------------------------------------------------------------------------

export function subscribeDesktop(listener: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

export function getIsDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(DESKTOP_QUERY).matches;
}

export function getIsDesktopServerSnapshot(): boolean {
  return false;
}

// ---------------------------------------------------------------------------
// Color theme (light / dark / system)
// ---------------------------------------------------------------------------

const THEME_KEY = 'mimo:theme';

/** Stored user preference. A missing/unknown key means "system". */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What the theme actually resolves to once OS preference is applied. */
export type ResolvedTheme = 'light' | 'dark';

const themeListeners = new Set<() => void>();

/**
 * Apply the stored preference to the document. Both signals are written:
 * the `.dark` class (consumed by Tailwind's dark variant and the `.dark` token
 * block) and `data-theme` (consumed by the system-dark media query, so an
 * explicit Light choice is never overridden by a dark OS setting).
 */
function applyTheme(preference: ThemePreference): void {
  if (typeof document === 'undefined') return;
  const resolved: ResolvedTheme =
    preference === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : preference;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.dataset.theme = preference;
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_KEY) listener();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    themeListeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

// While the preference is "system", follow live OS changes.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePreference() !== 'system') return;
    applyTheme('system');
    for (const listener of themeListeners) listener();
  });
}

/** The stored preference: explicit light/dark, or system when unset. */
export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  const stored = window.localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'system';
}

export function getThemePreferenceServerSnapshot(): ThemePreference {
  return 'system';
}

/** Resolved theme: the stored preference, else the OS preference. */
export function getTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light';
  const preference = getThemePreference();
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return preference;
}

export function getThemeServerSnapshot(): ResolvedTheme {
  return 'light';
}

export function setTheme(theme: ThemePreference): void {
  window.localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
  for (const listener of themeListeners) listener();
}

/** Quick light/dark flip used by the header shortcut. */
export function toggleTheme(): void {
  setTheme(getTheme() === 'dark' ? 'light' : 'dark');
}
