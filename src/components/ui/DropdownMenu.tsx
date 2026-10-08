'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { Icon } from '@phosphor-icons/react';
import type { JSX, ReactNode } from 'react';

interface MenuContextValue {
  close: () => void;
}

const MenuContext = createContext<MenuContextValue>({ close: () => {} });

interface DropdownMenuProps {
  /** Rendered *inside* the trigger button — content only, never a nested <button>. */
  trigger: ReactNode;
  children: ReactNode;
  align?: 'left' | 'right';
  /** Accessible name for the trigger when its visible content is an icon/avatar. */
  ariaLabel?: string;
  /** Extra classes for the trigger button (e.g. avatar rounding). */
  triggerClassName?: string;
  /** Extra classes for the popup panel (width, padding). */
  menuClassName?: string;
  className?: string;
}

/**
 * Button + popover menu (`role="menu"`), closed by outside click or Escape.
 * Shared so the account menu, overflow menus, and filters all behave the
 * same way instead of each page inventing its own open/close handling.
 */
export default function DropdownMenu({
  trigger,
  children,
  align = 'right',
  ariaLabel,
  triggerClassName = '',
  menuClassName = '',
  className = '',
}: DropdownMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex items-center gap-2 rounded-[var(--radius-md)] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${triggerClassName}`}
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-50 mt-1 min-w-44 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-lg)] ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${menuClassName}`}
        >
          <MenuContext.Provider value={{ close: () => setOpen(false) }}>
            {children}
          </MenuContext.Provider>
        </div>
      )}
    </div>
  );
}

interface DropdownMenuItemProps {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  /** Style the item as destructive (danger text + light red hover). */
  danger?: boolean;
  icon?: Icon;
  disabled?: boolean;
}

export function DropdownMenuItem({
  children,
  onClick,
  href,
  danger = false,
  icon: IconComponent,
  disabled = false,
}: DropdownMenuItemProps): JSX.Element {
  const { close } = useContext(MenuContext);
  const classes = `flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-primary)] disabled:pointer-events-none disabled:opacity-50 ${
    danger
      ? 'text-[var(--color-danger)] hover:bg-[var(--color-danger-light)]'
      : 'text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]'
  }`;

  const content = (
    <>
      {IconComponent && <IconComponent className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} role="menuitem" onClick={close} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onClick?.();
        close();
      }}
      className={classes}
    >
      {content}
    </button>
  );
}

/** Small heading above a group of items (e.g. the signed-in identity). */
export function DropdownMenuLabel({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div className="px-3 py-1.5 text-xs font-medium text-[var(--color-muted)]">{children}</div>
  );
}

export function DropdownMenuSeparator(): JSX.Element {
  return <div role="separator" className="my-1 h-px bg-[var(--color-border)]" />;
}
