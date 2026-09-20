'use client';

import { useCallback, useState, useSyncExternalStore, type JSX, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import type { UserRole } from '@/lib/types';
import {
  getIsDesktop,
  getIsDesktopServerSnapshot,
  getSidebarCollapsed,
  getSidebarCollapsedServerSnapshot,
  setSidebarCollapsed,
  subscribeDesktop,
  subscribeSidebarCollapsed,
} from '@/lib/ui-preferences';

interface AppShellProps {
  children: ReactNode;
  title: string;
  role: UserRole;
  userName: string;
  avatarUrl: string | null;
}

/**
 * Application chrome: a persistent sidebar on desktop, an overlay drawer on
 * mobile, and one hamburger in the top bar that drives whichever of the two the
 * current viewport actually shows.
 */
export default function AppShell({
  children,
  title,
  role,
  userName,
  avatarUrl,
}: AppShellProps): JSX.Element {
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  const toggleNavigation = useCallback(() => {
    if (isDesktop) {
      setSidebarCollapsed(!collapsed);
      return;
    }

    setDrawerOpen((prev) => !prev);
  }, [collapsed, isDesktop]);

  const navigationExpanded = isDesktop ? !collapsed : drawerOpen;

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

      {/* Mobile drawer */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 lg:hidden ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-hidden={!drawerOpen}
      >
        <Sidebar role={role} />
      </div>

      {/* Desktop rail */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar role={role} collapsed={collapsed} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          title={title}
          role={role}
          userName={userName}
          avatarUrl={avatarUrl}
          onNavToggle={toggleNavigation}
          navExpanded={navigationExpanded}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="h-full px-4 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
