import type { AnchorHTMLAttributes, JSX, ReactNode } from 'react';
import Link from 'next/link';

type ButtonLinkVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
type ButtonLinkSize = 'sm' | 'md' | 'lg';

interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: ReactNode;
  variant?: ButtonLinkVariant;
  size?: ButtonLinkSize;
}

const variantClasses: Record<ButtonLinkVariant, string> = {
  primary:
    'bg-[var(--color-primary)] text-white hover:bg-[var(--color-primary-hover)] active:bg-[var(--color-primary-active)] shadow-sm',
  secondary:
    'bg-[var(--color-surface)] text-[var(--color-foreground)] border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] active:bg-[var(--color-surface-active)] shadow-sm',
  danger:
    'bg-[var(--color-danger)] text-white hover:bg-[var(--color-danger-dark)] active:bg-[var(--color-danger)] shadow-sm',
  ghost:
    'text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)] active:bg-[var(--color-surface-active)]',
  outline:
    'border border-[var(--color-primary)] text-[var(--color-primary)] hover:bg-[var(--color-primary-light)] active:bg-[var(--color-primary-light)]',
};

const sizeClasses: Record<ButtonLinkSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-[var(--radius-sm)]',
  md: 'h-10 px-4 text-sm gap-2 rounded-[var(--radius-md)]',
  lg: 'h-12 px-6 text-base gap-2.5 rounded-[var(--radius-lg)]',
};

/**
 * Navigation that must look like a `Button`. Wrapping a `<button>` in a `<Link>`
 * nests interactive elements (invalid HTML and confusing for screen readers),
 * so the anchor carries the button's classes instead. Mirrors `ui/Button`
 * visually — keep the two in sync when the kit's button styles change.
 */
export default function ButtonLink({
  href,
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...props
}: ButtonLinkProps): JSX.Element {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)] ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}
