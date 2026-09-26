'use client';

import { useCallback, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Sidebar from './Sidebar';
import ContextualSidebar from './ContextualSidebar';
import TopBar from './TopBar';
import MobileBottomNav from './MobileBottomNav';
import { useNavigationContext } from './NavigationContext';
import type { UserRole } from '@/lib/types';
import type { NavigationItem } from '@/config/navigation';
import { hasBottomNavigation, isFullScreenRoute } from '@/config/navigation';
import {
  getIsDesktop,
  getIsDesktopServerSnapshot,
  getSidebarCollapsed,
  getSidebarCollapsedServerSnapshot,
  setSidebarCollapsed,
  subscribeDesktop,
  subscribeSidebarCollapsed,
} from '@/lib/ui-preferences';
import { handleSamePathHashClick } from '@/lib/hash-navigation';

interface AppShellProps {
  children: ReactNode;
  title: string;
  role: UserRole;
  userName: string;
  avatarUrl: string | null;
  /** Unread notification badge for the top-bar bell. */
  notificationCount?: number;
}

/**
 * Application chrome: a persistent sidebar on desktop, an overlay drawer on
 * mobile, a contextual workspace rail, and a mobile bottom bar — all fed from
 * the one centralized navigation configuration.
 *
 * On full-screen routes (the secure exam shell) none of this chrome renders:
 * no sidebar, no top bar, no bottom navigation.
 */
export default function AppShell({
  children,
  title,
  role,
  userName,
  avatarUrl,
  notificationCount,
}: AppShellProps): JSX.Element {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileContextualNavOpen, setMobileContextualNavOpen] = useState(false);
  const { contextualNav, contextualNavPath } = useNavigationContext();
  const pathname = usePathname();
  const fullScreen = isFullScreenRoute(pathname);

  // Browser state (stored preference, viewport) is read through external stores
  // so the server snapshot stays stable and the preference persists across
  // navigations and tabs.
  const collapsed = useSyncExternalStore(
    subscribeSidebarCollapsed,
    getSidebarCollapsed,
    getSidebarCollapsedServerSnapshot
  );
  const isDesktop = useSyncExternalStore(subscribeDesktop, getIsDesktop, getIsDesktopServerSnapshot);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const closeMobileContextualNav = useCallback(() => setMobileContextualNavOpen(false), []);

  const toggleNavigation = useCallback(() => {
    if (isDesktop) {
      setSidebarCollapsed(!collapsed);
      return;
    }

    setDrawerOpen((prev) => !prev);
  }, [collapsed, isDesktop]);

  const toggleMobileContextualNav = useCallback(() => {
    setMobileContextualNavOpen((prev) => !prev);
  }, []);

  // Secure examination: render nothing but the page itself. ExamShell owns the
  // full-height layout, so no wrapper chrome is added here either.
  if (fullScreen) return <>{children}</>;

  const navigationExpanded = isDesktop ? !collapsed : drawerOpen;
  const hasContextualNav = Boolean(contextualNav && contextualNav.length > 0);
  const showBottomNav = hasBottomNavigation(role);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      )}

      {/* Mobile drawer - global navigation */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 lg:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!drawerOpen}
      >
        <Sidebar
          role={role}
          onClose={closeDrawer}
          notificationCount={notificationCount}
        />
      </div>

      {/* Desktop global rail */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar
          role={role}
          collapsed={collapsed}
          notificationCount={notificationCount}
        />
      </div>

      {/* Desktop contextual rail - only when in a workspace */}
      {hasContextualNav && isDesktop && (
        <div className="hidden lg:flex lg:flex-shrink-0">
          <ContextualSidebar items={contextualNav} currentPath={contextualNavPath} />
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          title={title}
          role={role}
          userName={userName}
          avatarUrl={avatarUrl}
          onNavToggle={toggleNavigation}
          navExpanded={navigationExpanded}
          notificationCount={notificationCount}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="h-full px-4 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>

        {/* Mobile contextual tabs, stacked directly above the global bottom bar */}
        {hasContextualNav && !isDesktop && (
          <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-surface)] lg:hidden">
            <div className="flex items-center justify-between px-3 py-1.5">
              <button
                onClick={toggleMobileContextualNav}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[var(--color-muted)] hover:text-[var(--color-foreground)] transition-colors rounded-[var(--radius-md)] focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)]"
                aria-label="Workspace navigation"
                aria-expanded={mobileContextualNavOpen}
                aria-controls="mobile-contextual-nav"
              >
                <span>Workspace</span>
                <svg
                  className={`h-4 w-4 transition-transform ${mobileContextualNavOpen ? 'rotate-180' : ''}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <div className="flex-1" />
              <span className="text-xs text-[var(--color-muted)] px-2">
                {contextualNav.length} tabs
              </span>
            </div>

            {mobileContextualNavOpen && (
              <div id="mobile-contextual-nav" className="px-3 pb-3 border-t border-[var(--color-border)] animate-slide-down">
                <nav className="flex gap-1 overflow-x-auto pb-2" aria-label="Workspace tabs">
                  {contextualNav.map((item: NavigationItem) => (
                    <Link
                      key={item.id}
                      href={item.href ?? '#'}
                      onClick={(event) => {
                        if (item.href) handleSamePathHashClick(event, item.href);
                        closeMobileContextualNav();
                      }}
                      className={`flex-shrink-0 px-4 py-2 text-sm font-medium whitespace-nowrap rounded-[var(--radius-md)] transition-colors ${
                        item.exact
                          ? contextualNavPath === item.href
                            ? 'bg-[var(--color-primary)] text-white'
                            : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)]'
                          : contextualNavPath.startsWith(item.href ?? '')
                            ? 'bg-[var(--color-primary)] text-white'
                            : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)]'
                      }`}
                      aria-current={item.exact ? contextualNavPath === item.href : contextualNavPath.startsWith(item.href ?? '') ? 'page' : undefined}
                    >
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </div>
            )}
          </div>
        )}

        {/* Global mobile bottom navigation (Student / Faculty) */}
        {showBottomNav && !isDesktop && (
          <MobileBottomNav key={pathname} role={role} notificationCount={notificationCount} />
        )}
      </div>
    </div>
  );
}