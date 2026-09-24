'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationRead } from '@/app/actions/notifications';

interface ViewNotificationLinkProps {
  notificationId: string;
  href: string;
  isRead: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Navigates to a notification target after marking it read (no-op when
 * already read). Viewing the notification is the signal that it was seen.
 */
export default function ViewNotificationLink({
  notificationId,
  href,
  isRead,
  className,
  children,
}: ViewNotificationLinkProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const handleClick = async (event: React.MouseEvent) => {
    // Preserve modified/middle-click open-in-new-tab behaviour.
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }

    if (!isRead) {
      event.preventDefault();
      setBusy(true);
      try {
        await markNotificationRead(notificationId);
      } finally {
        setBusy(false);
      }
      router.push(href);
      router.refresh();
      return;
    }

    // Already read: normal Link navigation.
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className={className}
      aria-busy={busy || undefined}
    >
      {children}
    </a>
  );
}
