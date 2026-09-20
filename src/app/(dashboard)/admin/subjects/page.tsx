import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAdminReferenceData } from '../actions';
import { getSubjectsOverview } from './actions';
import SubjectsManager from './SubjectsManager';

export default async function SubjectsPage(): Promise<JSX.Element> {
  const [subjects, reference] = await Promise.all([
    getSubjectsOverview(),
    getAdminReferenceData(),
  ]);

  const totalSubjects = subjects.length;
  const activeSubjects = subjects.filter((s) => s.isActive).length;
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
        description="Manage subjects, their semester offerings, and faculty assignments"
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

      <SubjectsManager subjects={subjects} reference={reference} />
    </div>
  );
}
