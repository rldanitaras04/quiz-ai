'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { markNotificationRead } from '@/app/actions/notifications';
import Button from '@/components/ui/Button';

export default function MarkAsReadButton({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    setLoading(true);
    const result = await markNotificationRead(notificationId);
    if (!result.error) router.refresh();
    setLoading(false);
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={loading}>
      Mark read
    </Button>
  );
}
