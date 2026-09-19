import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { getAcademicStructure } from '../actions';

export default async function AcademicPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!roles?.some((r) => r.role === 'super_admin')) redirect('/');

  const structure = await getAcademicStructure();

  const activeYearCount = structure.academicYears.filter((y) => y.is_active).length;
  const totalSemesters = structure.academicYears.reduce((sum, y) => sum + y.semesters.length, 0);
  const totalPrograms = structure.programs.length;
  const totalSections = structure.programs.reduce(
    (sum, p) => sum + p.yearLevels.reduce((ys, yl) => ys + yl.sections.length, 0),
    0
  );

  const stats = [
    { label: 'Academic Years', value: activeYearCount },
    { label: 'Semesters', value: totalSemesters },
    { label: 'Programs', value: totalPrograms },
    { label: 'Sections', value: totalSections },
  ];

  return (
    <div>
      <PageHeader
        title="Academic Structure"
        description="Manage academic years, semesters, programs, and sections"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Academic Structure' },
        ]}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent>
              <p className="text-sm font-medium text-[var(--color-muted)]">{stat.label}</p>
              <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">
            Academic Years & Semesters
          </h2>
          {structure.academicYears.length === 0 ? (
            <EmptyState
              title="No academic years"
              description="Create an academic year to get started."
            />
          ) : (
            <div className="space-y-4">
              {structure.academicYears.map((year) => (
                <Card key={year.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-[var(--color-foreground)]">{year.name}</h3>
                        <p className="text-sm text-[var(--color-muted)]">
                          {new Date(year.starts_on).toLocaleDateString()} –{' '}
                          {new Date(year.ends_on).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge variant={year.is_active ? 'success' : 'default'}>
                        {year.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </CardHeader>
                  {year.semesters.length > 0 && (
                    <CardContent>
                      <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide mb-2">
                        Semesters
                      </p>
                      <div className="space-y-2">
                        {year.semesters.map((sem) => (
                          <div
                            key={sem.id}
                            className="flex items-center justify-between rounded-lg border border-[var(--color-border)] px-3 py-2"
                          >
                            <div>
                              <p className="text-sm font-medium text-[var(--color-foreground)]">
                                {sem.name}
                              </p>
                              <p className="text-xs text-[var(--color-muted)]">
                                {new Date(sem.starts_on).toLocaleDateString()} –{' '}
                                {new Date(sem.ends_on).toLocaleDateString()}
                              </p>
                            </div>
                            <Badge variant={sem.is_active ? 'success' : 'default'} className="text-xs">
                              {sem.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">
            Programs, Year Levels & Sections
          </h2>
          {structure.programs.length === 0 ? (
            <EmptyState
              title="No programs"
              description="Create a program to get started."
            />
          ) : (
            <div className="space-y-4">
              {structure.programs.map((program) => (
                <Card key={program.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium text-[var(--color-foreground)]">
                          {program.code} – {program.name}
                        </h3>
                      </div>
                      <Badge variant={program.is_active ? 'success' : 'default'}>
                        {program.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                  </CardHeader>
                  {program.yearLevels.length > 0 && (
                    <CardContent>
                      <div className="space-y-3">
                        {program.yearLevels.map((yl) => (
                          <div key={yl.id}>
                            <p className="text-sm font-medium text-[var(--color-foreground)] mb-1">
                              {yl.name}
                            </p>
                            {yl.sections.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {yl.sections.map((sec) => (
                                  <Badge
                                    key={sec.id}
                                    variant={sec.is_active ? 'outline' : 'default'}
                                  >
                                    {sec.name}
                                  </Badge>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-[var(--color-muted)]">No sections</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
