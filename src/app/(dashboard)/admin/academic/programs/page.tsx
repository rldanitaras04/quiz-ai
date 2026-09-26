import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAcademicStructure, getAdminReferenceData } from '../../actions';
import AcademicManager from '../AcademicManager';

export default async function ProgramsPage(): Promise<JSX.Element> {
  const [structure, reference] = await Promise.all([
    getAcademicStructure(),
    getAdminReferenceData(),
  ]);

  const activePrograms = structure.programs.filter((p) => p.is_active).length;
  const totalSections = structure.programs.reduce(
    (sum, p) => sum + p.yearLevels.reduce((ys, yl) => ys + yl.sections.length, 0),
    0
  );

  const stats = [
    { label: 'Programs', value: structure.programs.length },
    { label: 'Active', value: activePrograms },
    { label: 'Year Levels', value: reference.yearLevels.length },
    { label: 'Sections', value: totalSections },
  ];

  return (
    <div>
      <PageHeader
        title="Programs"
        description="Create degree programs and review their sections"
        breadcrumbs={[
          { label: 'Admin', href: '/admin' },
          { label: 'Academic', href: '/admin/academic' },
          { label: 'Programs' },
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

      <AcademicManager structure={structure} reference={reference} view="programs" />
    </div>
  );
}
