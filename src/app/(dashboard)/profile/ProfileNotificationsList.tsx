import Link from 'next/link';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import ViewNotificationLink from '@/app/(dashboard)/notifications/ViewNotificationLink';
import DeleteNotificationButton from '@/app/(dashboard)/notifications/DeleteNotificationButton';
import ClearAllNotificationsButton from '@/app/(dashboard)/notifications/ClearAllNotificationsButton';

interface NotificationSummary {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

interface ProfileNotificationsCardProps {
  notifications: NotificationSummary[];
  /** Cap list length; "View all" still links to /notifications. */
  limit?: number;
}

function notificationHref(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const assessmentId = data.assessment_id;
  if (typeof assessmentId !== 'string' || !assessmentId) return null;

  const attemptId = data.attempt_id;
  if (typeof attemptId === 'string' && attemptId) {
    return `/student/assessments/${assessmentId}/exam/${attemptId}/results`;
  }
  return `/student/assessments/${assessmentId}`;
}

function subjectLabelFromData(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  const label = data.subject_label;
  return typeof label === 'string' && label ? label : null;
}

export default function ProfileNotificationsList({
  notifications,
  limit,
}: ProfileNotificationsCardProps) {
  const list = limit ? notifications.slice(0, limit) : notifications;
  const unread = notifications.filter((n) => !n.read_at).length;

  if (list.length === 0) {
    return (
      <EmptyState
        title="No notifications"
        description="Notifications from your subjects will appear here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-muted)]">
          {unread > 0
            ? `${unread} unread notification${unread !== 1 ? 's' : ''}`
            : 'All notifications are read'}
        </p>
        <div className="flex items-center gap-2">
          <ClearAllNotificationsButton />
          <Link
            href="/notifications"
            className="text-sm font-medium text-[var(--color-primary)] hover:underline"
          >
            View all
          </Link>
        </div>
      </div>

      <ul className="space-y-3">
        {list.map((n) => {
          const href = notificationHref(n.data);
          const subjectLabel = subjectLabelFromData(n.data);
          const isRead = Boolean(n.read_at);

          return (
            <li
              key={n.id}
              className={`rounded-[var(--radius-md)] border border-[var(--color-border)] p-3 ${
                !isRead ? 'border-l-4 border-l-[var(--color-primary)]' : ''
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-[var(--color-foreground)]">{n.title}</p>
                    <Badge variant="outline">{n.type.replace(/_/g, ' ')}</Badge>
                    {subjectLabel && <Badge variant="info">{subjectLabel}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-muted)]">{n.body}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted-light)]">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                  {href && (
                    <ViewNotificationLink
                      notificationId={n.id}
                      href={href}
                      isRead={isRead}
                      className="mt-2 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
                    >
                      View
                    </ViewNotificationLink>
                  )}
                </div>
                <DeleteNotificationButton notificationId={n.id} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
