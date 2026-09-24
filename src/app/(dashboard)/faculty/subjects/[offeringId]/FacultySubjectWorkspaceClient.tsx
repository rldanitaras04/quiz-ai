'use client';

import { useEffect } from 'react';
import PageHeader from '@/components/ui/PageHeader';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Link from 'next/link';
import { useNavigationContext } from '@/components/layout/NavigationContext';
import { getSubjectWorkspaceNav, type NavigationItem } from '@/config/navigation';

interface OfferingDetail {
  subject: { id: string; code: string; title: string; description: string | null } | null;
  semester: {
    id: string;
    name: string;
    academic_year: {
      id: string;
      name: string;
      starts_on: string;
      ends_on: string;
    } | null;
  } | null;
  section: {
    id: string;
    name: string;
    program: { id: string; code: string; name: string } | null;
    year_level: { id: string; name: string } | null;
  } | null;
  faculty_assignments: Array<{
    id: string;
    faculty: { id: string; full_name: string; email: string | null } | null;
  }>;
}

interface FacultySubjectWorkspaceClientProps {
  offeringId: string;
  subject: OfferingDetail['subject'];
  section: OfferingDetail['section'];
  semester: OfferingDetail['semester'];
  enrollmentsCount: number;
  assessmentsCount: number;
  sourcesCount: number;
  status: string;
  facultyAssignments: OfferingDetail['faculty_assignments'];
}

export default function FacultySubjectWorkspaceClient({
  offeringId,
  subject,
  section,
  semester,
  enrollmentsCount,
  assessmentsCount,
  sourcesCount,
  status,
  facultyAssignments,
}: FacultySubjectWorkspaceClientProps) {
  const { setContextualNav, clearContextualNav } = useNavigationContext();

  // Set contextual navigation on mount, clear on unmount
  useEffect(() => {
    const nav = getSubjectWorkspaceNav(offeringId);
    setContextualNav(nav, `/faculty/subjects/${offeringId}`);
    return () => clearContextualNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeringId]);

  const tabs = getSubjectWorkspaceNav(offeringId);

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${subject?.code} - ${subject?.title}` },
        ]}
        title={`${subject?.code} - ${subject?.title}`}
        description={`${section?.name} | ${semester?.name} ${semester?.academic_year?.name}`}
        actions={
          <Link href={`/faculty/subjects/${offeringId}/students`}>
            <Button variant="secondary">Manage Students</Button>
          </Link>
        }
      />

      {/* Contextual tabs - shown on mobile and as fallback */}
      <nav className="lg:hidden flex gap-1 mb-6 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map((tab: NavigationItem) => (
          <Link
            key={tab.id}
            href={tab.href ?? '#'}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab.href === `/faculty/subjects/${offeringId}`
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border)]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Link href={`/faculty/subjects/${offeringId}/students`} className="block">
          <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
            <CardContent>
              <p className="text-sm font-medium text-[var(--color-muted)]">Enrolled Students</p>
              <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{enrollmentsCount}</p>
              <p className="mt-1 text-xs font-medium text-[var(--color-primary)]">Manage roster →</p>
            </CardContent>
          </Card>
        </Link>
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Assessments</p>
            <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{assessmentsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Source Materials</p>
            <p className="mt-1 text-3xl font-bold text-[var(--color-foreground)]">{sourcesCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <p className="text-sm font-medium text-[var(--color-muted)]">Status</p>
            <div className="mt-1">
              <Badge variant={status === 'active' ? 'success' : 'default'}>
                {status}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--color-foreground)]">Subject Information</h3>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-sm text-[var(--color-muted)]">Description</p>
              <p className="text-[var(--color-foreground)]">{subject?.description || 'No description available.'}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Program</p>
              <p className="text-[var(--color-foreground)]">{section?.program?.code} - {section?.program?.name}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Year Level</p>
              <p className="text-[var(--color-foreground)]">{section?.year_level?.name}</p>
            </div>
            <div>
              <p className="text-sm text-[var(--color-muted)]">Academic Year</p>
              <p className="text-[var(--color-foreground)]">
                {semester?.academic_year?.name} ({new Date(semester?.academic_year?.starts_on ?? '').toLocaleDateString()} - {new Date(semester?.academic_year?.ends_on ?? '').toLocaleDateString()})
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="font-semibold text-[var(--color-foreground)]">Assigned Faculty</h3>
          </CardHeader>
          <CardContent>
            {facultyAssignments && facultyAssignments.length > 0 ? (
              <ul className="space-y-3">
                {facultyAssignments.map((fa) => (
                  <li key={fa.id} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center">
                      <span className="text-sm font-medium text-[var(--color-muted)]">
                        {fa.faculty?.full_name?.charAt(0) ?? '?'}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{fa.faculty?.full_name}</p>
                      <p className="text-xs text-[var(--color-muted)]">{fa.faculty?.email}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">No faculty assigned.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}