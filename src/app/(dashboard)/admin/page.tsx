import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Link from 'next/link';

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: roles } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id);

  const isAdmin = roles?.some((r) => r.role === 'super_admin');
  if (!isAdmin) redirect('/');

  const [usersCount, subjectsCount, offeringsCount, activeOfferingsCount] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('subjects').select('id', { count: 'exact', head: true }),
    supabase.from('subject_offerings').select('id', { count: 'exact', head: true }),
    supabase.from('subject_offerings').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  const stats = [
    { label: 'Total Users', value: usersCount.count ?? 0, href: '/admin/users' },
    { label: 'Subjects', value: subjectsCount.count ?? 0, href: '/admin/subjects' },
    { label: 'Total Offerings', value: offeringsCount.count ?? 0, href: '/admin/subjects' },
    { label: 'Active Offerings', value: activeOfferingsCount.count ?? 0, href: '/admin/subjects' },
  ];

  const managementLinks = [
    { label: 'User Management', href: '/admin/users', description: 'Manage user accounts, roles, and profiles' },
    { label: 'Academic Structure', href: '/admin/academic', description: 'Manage programs, year levels, sections, and semesters' },
    { label: 'Subjects & Offerings', href: '/admin/subjects', description: 'Manage subjects and their offerings per semester' },
    { label: 'Audit Logs', href: '/admin/audit-logs', description: 'View system activity and change history' },
  ];

  return (
    <div>
      <PageHeader title="Admin Dashboard" description="System overview and management" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent>
                <p className="text-sm font-medium text-[var(--color-muted)]">{stat.label}</p>
                <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{stat.value}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">Management</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {managementLinks.map((link) => (
          <Link key={link.href} href={link.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardContent>
                <h3 className="font-medium text-[var(--color-foreground)]">{link.label}</h3>
                <p className="mt-1 text-sm text-[var(--color-muted)]">{link.description}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
