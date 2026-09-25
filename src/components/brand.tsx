import type { JSX } from 'react';
import { APP_NAME } from '@/lib/constants';

const ICON_SRC = '/seams_ai_logo_notext.png';
const LOGO_SRC = '/seams_ai_logo_text.png';

interface BrandProps {
  /** Which asset to render. */
  variant?: 'icon' | 'logo';
  /** CSS class on the <img>. */
  className?: string;
  /** Accessible label; defaults to the app name. */
  alt?: string;
}

/** Square app icon (favicon-sized mark). */
export function BrandIcon({
  className = 'h-8 w-8',
  alt = APP_NAME,
}: Omit<BrandProps, 'variant'>): JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ICON_SRC}
      alt={alt}
      width={32}
      height={32}
      className={`rounded-[var(--radius-md)] object-contain ${className}`}
      draggable={false}
    />
  );
}

/** Horizontal wordmark/logo for CTAs and wide headers. */
export function BrandLogo({
  className = 'h-9',
  alt = APP_NAME,
}: Omit<BrandProps, 'variant'>): JSX.Element {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={LOGO_SRC}
      alt={alt}
      height={36}
      className={`object-contain ${className}`}
      draggable={false}
    />
  );
}

/**
 * Compact brand lockup: icon + name (or logo only when `preferLogo`).
 * Used in landing nav, login, sidebar, and setup.
 */
export function Brand({
  variant = 'icon',
  className = '',
  alt = APP_NAME,
}: BrandProps): JSX.Element {
  if (variant === 'logo') {
    return (
      <span className={`inline-flex items-center ${className}`}>
        <BrandLogo alt={alt} className="h-8 md:h-9" />
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <BrandIcon alt={alt} className="h-8 w-8 md:h-9 md:w-9" />
      <BrandLogo alt="" className="h-5 w-auto md:h-6" />
    </span>
  );
}
