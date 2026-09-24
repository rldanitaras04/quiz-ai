import type { MouseEvent } from 'react';

/**
 * Handle same-path hash navigation (e.g. `/student/subjects/x#assessments`).
 *
 * Next.js `Link` navigates same-path hash changes via `history.pushState`,
 * which does not fire `hashchange`. Workspace clients that switch tabs from
 * `hashchange` therefore never update. This intercepts those clicks, updates
 * the hash directly (firing `hashchange`), and returns true when default
 * should be prevented.
 *
 * Returns false for cross-path links, modified clicks, and non-left clicks —
 * those should fall through to `Link` / the browser.
 */
export function handleSamePathHashClick(
  event: MouseEvent<HTMLAnchorElement>,
  href: string
): boolean {
  if (typeof window === 'undefined') return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (event.button !== 0) return false;

  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }

  if (url.pathname !== window.location.pathname) return false;
  if (url.search !== window.location.search) return false;

  const targetHash = url.hash;
  if (targetHash === window.location.hash) {
    event.preventDefault();
    return true;
  }

  event.preventDefault();

  if (targetHash) {
    window.location.hash = targetHash;
  } else {
    history.pushState(null, '', url.pathname + url.search);
    window.dispatchEvent(new Event('hashchange'));
  }

  return true;
}
