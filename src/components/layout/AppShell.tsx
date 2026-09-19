'use client';

import { useState, useCallback, type JSX, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import type { UserRole } from '@/lib/types';

interface AppShellProps {
  children: ReactNode;
  title: string;
  role: UserRole;
  userName: string;
  userEmail: string;
  avatarUrl: string | null;
}

export default function AppShell({
  children,
  title,
  role,
  userName,
  userEmail,
  avatarUrl,
}: AppShellProps): JSX.Element {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const toggleMobileMenu = useCallback(() => setSidebarOpen((prev) => !prev), []);
  const toggleCollapse = useCallback(() => setCollapsed((prev) => !prev), []);

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-background)]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={toggleMobileMenu}
          aria-hidden="true"
        />
      )}

      {/* Mobile sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-200 lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar
          role={role}
          userName={userName}
          userEmail={userEmail}
          onToggleCollapse={undefined}
        />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:flex-shrink-0">
        <Sidebar
          role={role}
          userName={userName}
          userEmail={userEmail}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar
          title={title}
          userName={userName}
          role={role}
          avatarUrl={avatarUrl}
          onMenuToggle={toggleMobileMenu}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="h-full px-4 py-6 lg:px-8 lg:py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
