import type { JSX } from 'react';
import Link from 'next/link';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { APP_NAME, APP_DESCRIPTION } from '@/lib/constants';
import { getSettings } from '@/lib/settings';
import { requireAdminUser } from '../actions';
import SettingsForm from './SettingsForm';

/**
 * Super-admin configuration. Access is gated by the admin layout and again by
 * `requireAdminUser`, which re-derives the caller's role server-side.
 *
 * The editable values live in `system_settings` (see ./actions); the reference
 * data behind them — academic years, programs, year levels — is only summarised
 * here, because it is managed under /admin/academic.
 */
export default async function SystemSettingsPage(): Promise<JSX.Element> {
  const { supabase } = await requireAdminUser();

  const [settings, yearsResult, programsResult, yearLevelsResult] = await Promise.all([
    getSettings(),
    supabase
      .from('academic_years')
      .select('name, starts_on, ends_on, is_active')
      .order('starts_on', { ascending: false }),
    supabase.from('programs').select('id', { count: 'exact', head: true }),
    supabase.from('year_levels').select('name').order('sort_order', { ascending: true }),
  ]);

  const activeYear = (yearsResult.data ?? []).find((y) => y.is_active);
  const programCount = programsResult.count ?? 0;
  const yearLevels = (yearLevelsResult.data ?? []).map((y) => y.name);

  const related = [
    {
      label: 'Academic Structure',
      href: '/admin/academic',
      description: 'Academic years, semesters, programs, year levels, and sections',
    },
    {
      label: 'Users & Roles',
      href: '/admin/users',
      description: 'Account approval, roles, and student verification',
    },
    {
      label: 'AI Configuration',
      href: '/admin/ai-config',
      description: 'Provider status and AI usage',
    },
  ];

  return (
    <div>
      <PageHeader
        title="System Settings"
        description="Configure system-wide limits and defaults"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'System Settings' },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SettingsForm settings={settings} />

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
                Deployment
              </h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-[var(--color-muted)]">Application</p>
                <p className="text-sm font-medium text-[var(--color-foreground)]">{APP_NAME}</p>
                <p className="text-xs text-[var(--color-muted)]">{APP_DESCRIPTION}</p>
              </div>
              <div>
                <p className="text-sm text-[var(--color-muted)]">Active Academic Year</p>
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {activeYear
                    ? `${activeYear.name} (${activeYear.starts_on} to ${activeYear.ends_on})`
                    : 'None configured'}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--color-muted)]">Programs</p>
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {programCount === 0 ? 'None configured' : programCount}
                </p>
              </div>
              <div>
                <p className="text-sm text-[var(--color-muted)]">Year Levels</p>
                <p className="text-sm font-medium text-[var(--color-foreground)]">
                  {yearLevels.length > 0 ? yearLevels.join(', ') : 'None configured'}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
                Configured Elsewhere
              </h2>
            </CardHeader>
            <CardContent className="space-y-3">
              {related.map((item) => (
                <Link key={item.href} href={item.href} className="block group">
                  <p className="text-sm font-medium text-[var(--color-foreground)] group-hover:text-[var(--color-primary)]">
                    {item.label}
                  </p>
                  <p className="text-xs text-[var(--color-muted)]">{item.description}</p>
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
