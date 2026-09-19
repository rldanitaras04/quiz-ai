import { redirect } from 'next/navigation';

/**
 * Superseded by the shared `/profile` page, which is role-aware and already
 * renders the student detail card. Kept as a redirect so existing links and
 * the student navigation keep working with a single implementation.
 */
export default function StudentProfilePage(): never {
  redirect('/profile');
}
