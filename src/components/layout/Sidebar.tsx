'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { JSX } from 'react';
import type { UserRole } from '@/lib/types';
import { APP_NAME } from '@/lib/constants';
import {
  GLOBAL_NAVIGATION,
  isNavActive,
  type NavigationItem,
  type NavigationGroup,
} from '@/config/navigation';

interface SidebarProps {
  role: UserRole;
  collapsed?: boolean;
}

function NavIcon({ icon: Icon }: { icon: NavigationItem['icon'] }): JSX.Element {
  return <Icon className="h-5 w-5" weight="regular" />;
}

/**
 * Primary navigation, grouped by area of work. Identity and the account menu
 * live in the top bar, so the sidebar carries navigation only.
 *
 * Collapsing is driven by the hamburger in the top bar; this component just
 * renders the requested width.
 */
export default function Sidebar({ role, collapsed = false }: SidebarProps): JSX.Element {
  const pathname = usePathname();
  const groups: NavigationGroup[] = GLOBAL_NAVIGATION[role] ?? [];

  return (
    <aside
      className={`flex flex-col h-full bg-[var(--color-surface)] border-r border-[var(--color-border)] transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
      aria-label="Sidebar navigation"
    >
      <div
        className={`flex items-center h-16 border-b border-[var(--color-border)] ${
          collapsed ? 'justify-center px-2' : 'gap-3 px-4'
        }`}
      >
        <div className="flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white text-sm font-bold">
          M
        </div>
        {!collapsed && (
          <span className="text-lg font-semibold text-[var(--color-foreground)]">{APP_NAME}</span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2" aria-label="Main navigation">
        {groups.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex > 0 ? 'mt-4' : undefined}>
            {collapsed ? (
              groupIndex > 0 && (
                <div
                  className="mx-2 mb-2 h-px bg-[var(--color-border)]"
                  aria-hidden="true"
                />
              )
            ) : (
              <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-light)]">
                {group.label}
              </p>
            )}

            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active = isNavActive(item, pathname);
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href ?? '#'}
                      className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                          : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]'
                      } ${collapsed ? 'justify-center' : ''}`}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                    >
                      <NavIcon icon={item.icon} />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
