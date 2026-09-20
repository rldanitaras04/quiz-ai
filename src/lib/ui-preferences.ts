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
