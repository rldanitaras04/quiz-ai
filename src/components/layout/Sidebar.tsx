'use client';

import { useState, type JSX } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { CaretDown, X } from '@phosphor-icons/react';
import type { UserRole } from '@/lib/types';
import { APP_NAME, ROLE_LABELS } from '@/lib/constants';
import { BrandIcon } from '@/components/brand';
import {
  getSidebarCollapsed,
  setSidebarCollapsed,
} from '@/lib/ui-preferences';
import {
  getNavigationForRole,
  isNavActive,
  type NavigationGroup,
  type NavigationItem,
} from '@/config/navigation';

interface SidebarProps {
  role: UserRole;
  collapsed?: boolean;
  /** When provided, a close button is shown (mobile drawer). */
  onClose?: () => void;
  /** Unread notification badge shared with the top-bar bell. */
  notificationCount?: number;
}

function NavIcon({ icon: Icon }: { icon: NavigationItem['icon'] }): JSX.Element {
  return <Icon className="h-5 w-5 shrink-0" weight="regular" />;
}

/**
 * Role-aware primary navigation rendered from the single centralized
 * configuration in `@/config/navigation` — the same source feeds the desktop
 * rail, the mobile drawer, and the mobile bottom bar.
 *
 * Groups with `children` render as collapsible parents that stay expanded
 * while one of their routes is active. Collapsing (width) is driven by the
 * hamburger in the top bar; this component just renders the requested width.
 */
export default function Sidebar({
  role,
  collapsed = false,
  onClose,
  notificationCount,
}: SidebarProps): JSX.Element {
  const pathname = usePathname();
  const groups: NavigationGroup[] = getNavigationForRole(role);

  return (
    <aside
      className={`flex h-full flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width] duration-200 ${
        collapsed ? 'w-[76px]' : 'w-64'
      }`}
      aria-label="Sidebar navigation"
    >
      {/* Brand */}
      <div
        className={`flex h-16 shrink-0 items-center gap-3 border-b border-[var(--color-border)] ${
          collapsed ? 'justify-center px-2' : 'px-4'
        }`}
      >
        <BrandIcon className="h-8 w-8 shrink-0" alt={APP_NAME} />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight text-[var(--color-foreground)]">
              {APP_NAME}
            </p>
            <p className="truncate text-[11px] leading-tight text-[var(--color-muted)]">
              {ROLE_LABELS[role]}
            </p>
          </div>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className={`flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)] lg:hidden ${
              collapsed ? '' : 'ml-auto'
            }`}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" weight="regular" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3" aria-label="Main navigation">
        {groups.map((group, groupIndex) => (
          <div key={group.label} className={groupIndex > 0 ? 'mt-4' : undefined}>
            {collapsed ? (
              groupIndex > 0 && (
                <div className="mx-2 mb-2 h-px bg-[var(--color-border)]" aria-hidden="true" />
              )
            ) : (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-muted-light)]">
                {group.label}
              </p>
            )}

            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavItem
                  key={item.id}
                  item={item}
                  collapsed={collapsed}
                  pathname={pathname}
                  notificationCount={notificationCount}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function NavItem({
  item,
  collapsed,
  pathname,
  notificationCount,
}: {
  item: NavigationItem;
  collapsed: boolean;
  pathname: string;
  notificationCount?: number;
}): JSX.Element {
  const hasChildren = Boolean(item.children && item.children.length > 0);
  const active = isNavActive(item, pathname);
  // Manual toggle; a group with an active child is always expanded.
  const [toggled, setToggled] = useState(false);
  const open = hasChildren && (toggled || active);

  const badge =
    item.id === 'notifications' && notificationCount != null && notificationCount > 0
      ? notificationCount > 99
        ? '99+'
        : String(notificationCount)
      : undefined;

  const handleToggle = (): void => {
    if (collapsed) {
      // Expand the rail first so the group has room to open.
      setSidebarCollapsed(!getSidebarCollapsed());
      setToggled(true);
      return;
    }
    setToggled((prev) => !(prev || active));
  };

  if (hasChildren) {
    const childId = `nav-group-${item.id}`;

    if (collapsed) {
      return (
        <li>
          <button
            type="button"
            onClick={handleToggle}
            className={`flex w-full items-center justify-center rounded-[var(--radius-md)] p-2.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
              active
                ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]'
            }`}
            title={`${item.label} (expand sidebar)`}
            aria-label={`${item.label}, expand sidebar`}
            aria-expanded={open}
            aria-controls={childId}
          >
            <NavIcon icon={item.icon} />
          </button>
        </li>
      );
    }

    return (
      <li>
        <button
          type="button"
          onClick={handleToggle}
          className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
            active
              ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
              : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]'
          }`}
          aria-expanded={open}
          aria-controls={childId}
        >
          <NavIcon icon={item.icon} />
          <span className="flex-1 truncate text-left">{item.label}</span>
          <CaretDown
            className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
            weight="bold"
            aria-hidden="true"
          />
        </button>

        {open && (
          <ul
            id={childId}
            className="ml-4 mt-0.5 flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-3 animate-slide-down"
          >
            {item.children!.map((child) => {
              const childActive = isNavActive(child, pathname);
              return (
                <li key={child.id}>
                  <Link
                    href={child.href ?? '#'}
                    className={`flex items-center rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
                      childActive
                        ? 'bg-[var(--color-primary-light)] font-semibold text-[var(--color-primary)]'
                        : 'font-medium text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]'
                    }`}
                    aria-current={childActive ? 'page' : undefined}
                  >
                    <span className="truncate">{child.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  }

  return (
    <li>
      <Link
        href={item.href ?? '#'}
        title={collapsed ? item.label : undefined}
        aria-label={collapsed ? item.label : undefined}
        className={`relative flex items-center gap-3 rounded-[var(--radius-md)] text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] ${
          collapsed ? 'justify-center p-2.5' : 'px-3 py-2'
        } ${
          active
            ? 'bg-[var(--color-primary)] text-white shadow-sm shadow-[var(--color-primary)]/30'
            : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]'
        }`}
        aria-current={active ? 'page' : undefined}
      >
        <NavIcon icon={item.icon} />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {badge && (
              <span
                className="flex min-w-[18px] items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-bold leading-[18px] text-white"
                aria-label={`${notificationCount} unread notifications`}
              >
                {badge}
              </span>
            )}
          </>
        )}
        {collapsed && badge && (
          <span
            className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[var(--color-danger)] px-1 text-[9px] font-bold leading-none text-white"
            aria-label={`${notificationCount} unread notifications`}
          >
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}
