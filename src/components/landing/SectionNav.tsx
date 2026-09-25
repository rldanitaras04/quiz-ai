'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';

const LINKS = [
  { label: 'Home', id: 'home' },
  { label: 'Features', id: 'features' },
  { label: 'For Faculty', id: 'faculty' },
  { label: 'For Students', id: 'students' },
  { label: 'Security', id: 'security' },
  { label: 'About', id: 'about' },
] as const;

export function SectionNav(): JSX.Element {
  const [active, setActive] = useState<string>(LINKS[0].id);

  useEffect(() => {
    const ids = LINKS.map((link) => link.id);

    const syncActive = (): void => {
      const offset = 140;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top - offset <= 0) {
          current = id;
        }
      }
      setActive(current);
    };

    syncActive();
    window.addEventListener('scroll', syncActive, { passive: true });
    return () => window.removeEventListener('scroll', syncActive);
  }, []);

  return (
    <div className="hidden items-center gap-7 lg:flex">
      {LINKS.map((link) => (
        <Link
          key={link.id}
          href={`#${link.id}`}
          className={
            active === link.id
              ? 'border-b-2 border-[var(--color-primary)] pb-0.5 text-sm font-semibold text-[var(--color-primary)]'
              : 'text-sm font-medium text-[var(--color-foreground)]/80 transition-colors hover:text-[var(--color-primary)]'
          }
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
