import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import MarkAsReadButton from './MarkAsReadButton';

export const dynamic = 'force-dynamic';

/**
 * Deep link for a notification. Only exam-related notifications carry these
 * ids; authorization is still enforced when the target page loads (RLS scopes
 * everything to the signed-in user), so a stale or foreign id simply resolves
 * to nothing.
 */
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

export default async function NotificationsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: notifications } = await supabase
    .from('notifications')
    .select('id, type, title, body, data, read_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const list = notifications ?? [];
  const unreadCount = list.filter((n) => !n.read_at).length;

  const typeVariant = (type: string): 'info' | 'success' | 'warning' | 'danger' | 'default' => {
    switch (type) {
      case 'assessment_published':
      case 'assessment_opened':
        return 'info';
      case 'assessment_closed':
      case 'reminder':
        return 'warning';
      case 'result_released':
      case 'exception_granted':
      case 'submission_confirmed':
        return 'success';
      case 'system':
        return 'default';
      default:
        return 'default';
    }
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        description={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'All caught up'}
      />

      {list.length > 0 ? (
        <div className="space-y-3">
          {list.map((n) => {
            const href = notificationHref(n.data);
            return (
            <Card key={n.id} className={!n.read_at ? 'border-l-4 border-l-[var(--color-primary)]' : ''}>
              <CardContent className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-[var(--color-foreground)]">{n.title}</h3>
                    <Badge variant={typeVariant(n.type)}>
                      {n.type.replace(/_/g, ' ')}
                    </Badge>
                    {!n.read_at && (
                      <span className="h-2 w-2 rounded-full bg-[var(--color-primary)] flex-shrink-0" />
                    )}
                  </div>
                  <p className="text-sm text-[var(--color-muted)]">{n.body}</p>
                  <p className="text-xs text-[var(--color-muted-light)] mt-1">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                  {href && (
                    <Link
                      href={href}
                      className="mt-2 inline-block text-sm font-medium text-[var(--color-primary)] hover:underline"
                    >
                      View
                    </Link>
                  )}
                </div>
                {!n.read_at && <MarkAsReadButton notificationId={n.id} />}
              </CardContent>
            </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No notifications"
          description="You have no notifications at this time."
        />
      )}
    </div>
  );
}
