'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import AssessmentDetailClient from './AssessmentDetailClient';
import PageHeader from '@/components/ui/PageHeader';
import { useNavigationContext } from '@/components/layout/NavigationContext';
import { getAssessmentWorkspaceNav, type NavigationItem } from '@/config/navigation';

interface Props {
  offeringId: string;
  assessmentId: string;
  detail: NonNullable<Awaited<ReturnType<typeof import('../actions').getAssessmentDetail>>>;
  subjectName: string;
  statusLabel: string;
  heading: {
    subject: { code: string; title: string } | null;
    section: { name: string } | null;
  } | null;
}

export default function AssessmentWorkspaceClient({
  offeringId,
  assessmentId,
  detail,
  subjectName,
  statusLabel,
  heading,
}: Props) {
  const { setContextualNav, clearContextualNav } = useNavigationContext();

  // Set contextual navigation on mount, clear on unmount
  useEffect(() => {
    const nav = getAssessmentWorkspaceNav(offeringId, assessmentId);
    setContextualNav(nav, `/faculty/subjects/${offeringId}/assessments/${assessmentId}`);
    return () => clearContextualNav();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeringId, assessmentId]);

  const tabs = getAssessmentWorkspaceNav(offeringId, assessmentId);

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          {
            label: heading?.subject ? `${heading.subject.code} - ${heading.subject.title}` : 'Subject',
            href: `/faculty/subjects/${offeringId}`,
          },
          { label: 'Assessments', href: `/faculty/subjects/${offeringId}/assessments` },
          { label: detail.title },
        ]}
        title={detail.title}
        description={[subjectName, statusLabel].filter(Boolean).join(' · ')}
      />

      {/* Contextual tabs - shown on mobile and as fallback */}
      <nav className="lg:hidden flex gap-1 mb-6 border-b border-[var(--color-border)] overflow-x-auto">
        {tabs.map((tab: NavigationItem) => (
          <Link
            key={tab.id}
            href={tab.href ?? '#'}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab.href === `/faculty/subjects/${offeringId}/assessments/${assessmentId}`
                ? 'border-[var(--color-primary)] text-[var(--color-primary)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-foreground)] hover:border-[var(--color-border)]'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <AssessmentDetailClient detail={detail} subjectName={subjectName} />
    </div>
  );
}