'use client';

import { useEffect } from 'react';
import { useNavigationContext } from '@/components/layout/NavigationContext';
import { getAssessmentWorkspaceNav } from '@/config/navigation';

/**
 * Keeps the assessment workspace tabs visible on sub-pages (review,
 * exceptions, deploy, monitor, analytics). Only the root assessment page
 * registers contextual navigation itself, so without this every sub-page
 * silently loses the workspace tabs.
 */
export default function AssessmentNavSetter({
  offeringId,
  assessmentId,
}: {
  offeringId: string;
  assessmentId: string;
}) {
  const { setContextualNav, clearContextualNav } = useNavigationContext();

  useEffect(() => {
    setContextualNav(
      getAssessmentWorkspaceNav(offeringId, assessmentId),
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}`
    );
    return () => clearContextualNav();
  }, [offeringId, assessmentId, setContextualNav, clearContextualNav]);

  return null;
}
