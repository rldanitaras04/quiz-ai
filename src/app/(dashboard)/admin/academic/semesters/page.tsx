import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAcademicStructure, getAdminReferenceData } from '../../actions';
import AcademicManager from '../AcademicManager';

export default async function SemestersPage(): Promise<JSX.Element> {
  const [structure, reference] = await Promise.all([
    getAcademicStructure(),
    getAdminReferenceData(),
  ]);

  const semesters = structure.academicYears.flatMap((y) => y.semesters);
  const activeSemesters = semesters.filter((s) => s.is_active).length;

  const stats = [
    { label: 'Semesters', value: semesters.length },
    { label: 'Active', value: activeSemesters },
    { label: 'Inactive', value: semesters.length - activeSemesters },
    { label: 'Academic Years', value: structure.academicYears.length },
  ];

  return (
    <div>
      <PageHeader
        title="Semesters"
        description="Manage the semesters inside each academic year"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Academic', href: '/admin/academic' },
          { label: 'Semesters' },
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

      <AcademicManager structure={structure} reference={reference} view="semesters" />
    </div>
  );
}
