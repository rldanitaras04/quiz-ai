import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAdminReferenceData } from '../../actions';
import { getSubjectsOverview } from '../actions';
import SubjectsManager from '../SubjectsManager';

export default async function SubjectOfferingsPage(): Promise<JSX.Element> {
  const [subjects, reference] = await Promise.all([
    getSubjectsOverview(),
    getAdminReferenceData(),
  ]);

  const offerings = subjects.flatMap((s) => s.offerings);
  const activeOfferings = offerings.filter((o) => o.status === 'active').length;

  const stats = [
    { label: 'Offerings', value: offerings.length },
    { label: 'Active', value: activeOfferings },
    { label: 'Subjects', value: subjects.length },
    {
      label: 'Assigned Faculty',
      value: new Set(offerings.flatMap((o) => o.faculty.map((f) => f.facultyId))).size,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Subject Offerings"
        description="Every subject scheduled into a semester, program, and section"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Subjects', href: '/admin/subjects' },
          { label: 'Subject Offerings' },
        ]}
      />

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardContent>
              <p className="text-sm font-medium text-[var(--color-muted)]">{stat.label}</p>
              <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <SubjectsManager subjects={subjects} reference={reference} view="offerings" />
    </div>
  );
}
