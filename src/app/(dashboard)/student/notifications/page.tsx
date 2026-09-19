import { redirect } from 'next/navigation';

/**
 * Superseded by the shared `/notifications` page, which renders the same data
 * for every role (RLS scopes it to the caller's own rows). Kept as a redirect
 * so existing links and the student navigation keep working while there is
 * only one implementation to maintain.
 */
export default function StudentNotificationsPage(): never {
  redirect('/notifications');
}
