import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getSubjects } from '../actions';
import SubjectsFilter from './SubjectsFilter';

export default async function SubjectsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  if (!roles?.some((r) => r.role === 'super_admin')) redirect('/');

  const subjects = await getSubjects();

  const totalSubjects = subjects.length;
  const activeSubjects = subjects.filter((s) => s.is_active).length;
  const totalOfferings = subjects.reduce((sum, s) => sum + s.offerings.length, 0);
  const activeOfferings = subjects.reduce(
    (sum, s) => sum + s.offerings.filter((o) => o.status === 'active').length,
    0
  );

  const stats = [
    { label: 'Subjects', value: totalSubjects },
    { label: 'Active Subjects', value: activeSubjects },
    { label: 'Total Offerings', value: totalOfferings },
    { label: 'Active Offerings', value: activeOfferings },
  ];

  return (
    <div>
      <PageHeader
        title="Subjects & Offerings"
        description="Manage subjects and their semester offerings"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Subjects' },
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

      <SubjectsFilter subjects={subjects} />
    </div>
  );
}
