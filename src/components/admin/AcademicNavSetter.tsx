'use client';

import { useEffect, type JSX } from 'react';
import { useNavigationContext } from '@/components/layout/NavigationContext';
import { getAcademicWorkspaceNav } from '@/config/navigation';

interface AcademicNavSetterProps {
  /** Full path of the current subpage — used to highlight the active rail item. */
  currentPath: string;
}

/**
 * Keeps the Academic Structure workspace rail (Overview / Academic Years /
 * Semesters / …) visible on every `/admin/academic/**` subpage. Each page
 * mounts this so switching views never unmounts the rail, mirroring how the
 * faculty subject workspace keeps its tabs.
 */
export default function AcademicNavSetter({ currentPath }: AcademicNavSetterProps): JSX.Element | null {
  const { setContextualNav, clearContextualNav } = useNavigationContext();

  useEffect(() => {
    setContextualNav(getAcademicWorkspaceNav(), currentPath);
    return () => clearContextualNav();
  }, [currentPath, setContextualNav, clearContextualNav]);

  return null;
}
