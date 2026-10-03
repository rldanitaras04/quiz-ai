'use client';

import { useEffect } from 'react';
import { useNavigationContext } from '@/components/layout/NavigationContext';
import { getAssessmentWorkspaceNav, proctorOnlyWorkspaceNav } from '@/config/navigation';

/**
 * Keeps the assessment workspace tabs visible on sub-pages (review,
 * exceptions, deploy, monitor, analytics). Only the root assessment page
 * registers contextual navigation itself, so without this every sub-page
 * silently loses the workspace tabs.
 *
 * `proctorOnly` narrows the tab strip to the Live Monitor: a proctor (scope
 * §42) is not faculty of this workspace, so every other tab would bounce
 * them out of a page they are allowed to use.
 */
export default function AssessmentNavSetter({
  offeringId,
  assessmentId,
  proctorOnly = false,
}: {
  offeringId: string;
  assessmentId: string;
  proctorOnly?: boolean;
}) {
  const { setContextualNav, clearContextualNav } = useNavigationContext();

  useEffect(() => {
    const items = getAssessmentWorkspaceNav(offeringId, assessmentId);
    setContextualNav(
      proctorOnly ? proctorOnlyWorkspaceNav(items) : items,
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}`
    );
    return () => clearContextualNav();
  }, [offeringId, assessmentId, proctorOnly, setContextualNav, clearContextualNav]);

  return null;
}
