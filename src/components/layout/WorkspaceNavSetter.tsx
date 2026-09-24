'use client';

import { useEffect, type JSX } from 'react';
import { useNavigationContext } from './NavigationContext';
import { getSubjectWorkspaceNav } from '@/config/navigation';

interface WorkspaceNavSetterProps {
  offeringId: string;
  /** Full path of the current subpage — used to highlight the active tab. */
  currentPath: string;
}

/**
 * Keeps the subject-workspace contextual sidebar (Overview / Students /
 * Assessments / …) visible on every subpage. The overview page sets this nav
 * inline; without an equivalent setter here, navigating away unmounts the
 * overview and `clearContextualNav()` removes the whole Workspace rail.
 */
export default function WorkspaceNavSetter({
  offeringId,
  currentPath,
}: WorkspaceNavSetterProps): JSX.Element | null {
  const { setContextualNav, clearContextualNav } = useNavigationContext();

  useEffect(() => {
    setContextualNav(getSubjectWorkspaceNav(offeringId), currentPath);
    return () => clearContextualNav();
  }, [offeringId, currentPath, setContextualNav, clearContextualNav]);

  return null;
}
