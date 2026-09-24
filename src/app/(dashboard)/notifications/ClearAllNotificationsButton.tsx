'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAllNotifications } from '@/app/actions/notifications';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import Button from '@/components/ui/Button';

export default function ClearAllNotificationsButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    const ok = await confirmAction({
      title: 'Clear all notifications?',
      text: 'This permanently deletes every notification on your account.',
      confirmText: 'Clear all',
      destructive: true,
    });
    if (!ok) return;

    setLoading(true);
    const result = await deleteAllNotifications();
    setLoading(false);

    if (result.error) {
      notifyError('Could not clear notifications', result.error);
      return;
    }
    notifySuccess('Notifications cleared');
    router.refresh();
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      loading={loading}
    >
      Clear all
    </Button>
  );
}
