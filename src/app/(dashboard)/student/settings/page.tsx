import type { JSX } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import ThemeSetting from './ThemeSetting';
import SignOutButton from './SignOutButton';

/**
 * Student settings: display preference (shared theme store), read-only
 * account details, and sign out. Profile edits live on /profile.
 */
export default async function StudentSettingsPage(): Promise<JSX.Element> {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const [{ data: profile }, { data: studentProfile }] = await Promise.all([
    supabase.from('profiles').select('full_name, email').eq('id', user.id).maybeSingle(),
    supabase.from('student_profiles').select('student_number').eq('user_id', user.id).maybeSingle(),
  ]);

  const accountRows = [
    { label: 'Full name', value: profile?.full_name as string | null },
    { label: 'Email', value: profile?.email as string | null },
    { label: 'Student number', value: studentProfile?.student_number as string | null },
  ].filter((row) => row.value);

  return (
    <div>
      <PageHeader title="Settings" description="Display preferences and account details" />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardContent>
            <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Display</h2>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              Choose how the interface looks on this device.
            </p>
            <ThemeSetting />
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Account</h2>
                <Link
                  href="/profile"
                  className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                >
                  Edit profile
                </Link>
              </div>
              <dl className="mt-3 space-y-2">
                {accountRows.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2"
                  >
                    <dt className="text-sm text-[var(--color-muted)]">{row.label}</dt>
                    <dd className="truncate text-sm font-medium text-[var(--color-foreground)]">
                      {row.value}
                    </dd>
                  </div>
                ))}
                {accountRows.length === 0 && (
                  <p className="text-sm text-[var(--color-muted)]">
                    Account details are unavailable right now.
                  </p>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">Session</h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Sign out of your account on this device.
              </p>
              <div className="mt-3">
                <SignOutButton />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
