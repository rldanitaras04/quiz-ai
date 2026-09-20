import type { JSX } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { getAcademicStructure, getAdminReferenceData } from '../actions';
import AcademicManager from './AcademicManager';

/**
 * Access is gated by the admin layout (`requireRole(['super_admin'])`) and again
 * by the loaders, which re-derive the caller's role server-side.
 */
export default async function AcademicPage(): Promise<JSX.Element> {
  const [structure, reference] = await Promise.all([
    getAcademicStructure(),
    getAdminReferenceData(),
  ]);

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

      <AcademicManager structure={structure} reference={reference} />
    </div>
  );
}
