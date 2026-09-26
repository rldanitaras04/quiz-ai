import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAcademicStructure, getAdminReferenceData } from '../../actions';
import AcademicManager from '../AcademicManager';

export default async function AcademicYearsPage(): Promise<JSX.Element> {
  const [structure, reference] = await Promise.all([
    getAcademicStructure(),
    getAdminReferenceData(),
  ]);

  const activeYears = structure.academicYears.filter((y) => y.is_active).length;
  const totalSemesters = structure.academicYears.reduce((sum, y) => sum + y.semesters.length, 0);

  const stats = [
    { label: 'Academic Years', value: structure.academicYears.length },
    { label: 'Active', value: activeYears },
    { label: 'Inactive', value: structure.academicYears.length - activeYears },
    { label: 'Semesters', value: totalSemesters },
  ];

  return (
    <div>
      <PageHeader
        title="Academic Years"
        description="Create academic years and review their semesters"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Academic', href: '/admin/academic' },
          { label: 'Academic Years' },
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

      <AcademicManager structure={structure} reference={reference} view="years" />
    </div>
  );
}
