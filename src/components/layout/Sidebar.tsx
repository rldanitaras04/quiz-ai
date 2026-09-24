'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { JSX } from 'react';
import type { UserRole } from '@/lib/types';
import { APP_NAME } from '@/lib/constants';
import { BrandIcon } from '@/components/brand';
import {
  GLOBAL_NAVIGATION,
  isNavActive,
  type NavigationItem,
  type NavigationGroup,
} from '@/config/navigation';

interface SidebarProps {
  role: UserRole;
  collapsed?: boolean;
  /** When provided, a close button is shown (mobile drawer). */
  onClose?: () => void;
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
export default function Sidebar({ role, collapsed = false, onClose }: SidebarProps): JSX.Element {
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
        <BrandIcon className="h-8 w-8 flex-shrink-0" alt={APP_NAME} />
        {!collapsed && (
          <span className="text-lg font-semibold text-[var(--color-foreground)] flex-1">{APP_NAME}</span>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex items-center justify-center h-8 w-8 rounded-[var(--radius-md)] text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)] transition-colors lg:hidden"
            aria-label="Close navigation"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
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
