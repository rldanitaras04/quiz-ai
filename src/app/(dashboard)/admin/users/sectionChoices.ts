import type { AdminReferenceData } from '../actions';

export interface SectionChoice {
  id: string;
  label: string;
}

/**
 * Flat, labeled section choices ("PROGRAM · YEAR · SECTION") for the
 * per-student Section column, derived from the shared admin reference data.
 */
export function buildSectionChoices(reference: AdminReferenceData): SectionChoice[] {
  const programNameById = new Map(reference.programs.map((p) => [p.id, p.code] as const));
  const yearNameById = new Map(reference.yearLevels.map((y) => [y.id, y.name] as const));
  return reference.sections.map((s) => ({
    id: s.id,
    label: `${programNameById.get(s.programId) ?? ''} · ${yearNameById.get(s.yearLevelId) ?? ''} · ${s.name}`,
  }));
}
