import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { APP_NAME } from '@/lib/constants';

export default async function SystemSettingsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!roles?.some((r) => r.role === 'super_admin')) redirect('/');

  const [academicYears, programs, yearLevels] = await Promise.all([
    supabase.from('academic_years').select('*').order('starts_on', { ascending: false }),
    supabase.from('programs').select('*').order('code'),
    supabase.from('year_levels').select('*').order('sort_order'),
  ]);

  const activeYear = academicYears.data?.find((y) => y.is_active);

  return (
    <div>
      <PageHeader title="System Settings" description="Configure application-wide settings" />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>Application</CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-[var(--color-muted)]">Application Name</p>
              <p className="text-sm font-medium text-[var(--color-foreground)]">{APP_NAME}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Active Academic Year</p>
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                {activeYear ? `${activeYear.name} (${activeYear.starts_on} to ${activeYear.ends_on})` : 'None configured'}
              </p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Total Programs</p>
              <p className="text-sm font-medium text-[var(--color-foreground)]">{programs.data?.length ?? 0}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Year Levels</p>
              <p className="text-sm font-medium text-[var(--color-foreground)]">
                {yearLevels.data?.map((y) => y.name).join(', ') || 'None configured'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>Academic Years</CardHeader>
          <CardContent>
            {academicYears.data && academicYears.data.length > 0 ? (
              <div className="space-y-3">
                {academicYears.data.map((year) => (
                  <div
                    key={year.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{year.name}</p>
                      <p className="text-xs text-[var(--color-muted)]">
                        {year.starts_on} to {year.ends_on}
                      </p>
                    </div>
                    {year.is_active ? (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-success-light)] text-[var(--color-success)]">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-surface-hover)] text-[var(--color-muted)]">
                        Inactive
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">No academic years configured. Run the seed SQL to add defaults.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>Programs</CardHeader>
          <CardContent>
            {programs.data && programs.data.length > 0 ? (
              <div className="space-y-2">
                {programs.data.map((program) => (
                  <div
                    key={program.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]"
                  >
                    <div>
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{program.name}</p>
                      <p className="text-xs text-[var(--color-muted)]">{program.code}</p>
                    </div>
                    {program.is_active ? (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-success-light)] text-[var(--color-success)]">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-[var(--color-surface-hover)] text-[var(--color-muted)]">
                        Inactive
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">No programs configured. Run the seed SQL to add defaults.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>Year Levels</CardHeader>
          <CardContent>
            {yearLevels.data && yearLevels.data.length > 0 ? (
              <div className="space-y-2">
                {yearLevels.data.map((yl) => (
                  <div
                    key={yl.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]"
                  >
                    <p className="text-sm font-medium text-[var(--color-foreground)]">{yl.name}</p>
                    <span className="text-xs text-[var(--color-muted)]">Order: {yl.sort_order}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">No year levels configured. Run the seed SQL to add defaults.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
