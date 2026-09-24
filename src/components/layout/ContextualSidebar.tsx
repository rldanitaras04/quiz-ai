'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { JSX } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import type { NavigationItem } from '@/config/navigation';
import { handleSamePathHashClick } from '@/lib/hash-navigation';

interface ContextualSidebarProps {
  items: NavigationItem[];
  currentPath?: string;
  onNavigate?: () => void;
}

function ContextualNavIcon({ icon: Icon }: { icon: NavigationItem['icon'] }): JSX.Element {
  return <Icon className="h-5 w-5" weight="regular" />;
}

/**
 * Contextual navigation for subject/assessment workspaces.
 * Renders as a vertical tab list that can be used alongside or instead of
 * the global sidebar when inside a workspace.
 */
export default function ContextualSidebar({
  items,
  currentPath,
  onNavigate,
}: ContextualSidebarProps): JSX.Element {
  const pathname = usePathname();
  const effectivePath = currentPath ?? pathname;

  const isActive = (item: NavigationItem): boolean => {
    if (!item.href) return false;
    if (item.exact) return effectivePath === item.href;
    if (item.href.includes('#')) return effectivePath === item.href;
    return effectivePath.split('#')[0].startsWith(item.href);
  };

  return (
    <nav className="w-56 flex-shrink-0 border-r border-[var(--color-border)] bg-[var(--color-surface)]" aria-label="Contextual navigation">
      <div className="flex items-center h-16 px-4 border-b border-[var(--color-border)]">
        <CaretRight className="h-5 w-5 text-[var(--color-muted)] mr-2" weight="regular" />
        <span className="text-lg font-semibold text-[var(--color-foreground)]">Workspace</span>
      </div>

      <ul className="flex-1 overflow-y-auto py-3 px-2" role="tablist">
        {items.map((item) => {
          const active = isActive(item);
          return (
            <li key={item.id} role="tab">
              <Link
                href={item.href ?? '#'}
                onClick={(event) => {
                  if (item.href) handleSamePathHashClick(event, item.href);
                  onNavigate?.();
                }}
                className={`flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                    : 'text-[var(--color-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-foreground)]'
                }`}
                aria-current={active ? 'page' : undefined}
                aria-selected={active}
              >
                <ContextualNavIcon icon={item.icon} />
                <span>{item.label}</span>
                {item.badge != null && (
                  <span className="ml-auto inline-flex items-center justify-center px-2 py-0.5 text-xs font-medium bg-[var(--color-primary-light)] text-[var(--color-primary)] rounded-full">
                    {item.badge}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}