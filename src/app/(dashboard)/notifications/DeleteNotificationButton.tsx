'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteNotification } from '@/app/actions/notifications';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import Button from '@/components/ui/Button';

interface DeleteNotificationButtonProps {
  notificationId: string;
  size?: 'sm' | 'md';
}

export default function DeleteNotificationButton({
  notificationId,
  size = 'sm',
}: DeleteNotificationButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    const ok = await confirmAction({
      title: 'Delete notification?',
      text: 'This permanently removes the notification from your account.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;

    setLoading(true);
    const result = await deleteNotification(notificationId);
    setLoading(false);

    if (result.error) {
      notifyError('Could not delete', result.error);
      return;
    }
    notifySuccess('Notification deleted');
    router.refresh();
  };

  return (
    <Button
      variant="ghost"
      size={size}
      onClick={handleClick}
      loading={loading}
      aria-label="Delete notification"
    >
      Delete
    </Button>
  );
}
