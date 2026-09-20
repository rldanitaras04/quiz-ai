'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import type { AcademicStructure, AdminReferenceData } from '../actions';
import {
  createAcademicYear,
  createSemester,
  createProgram,
  createYearLevel,
  createSection,
  setAcademicActive,
  deleteAcademicEntity,
} from './actions';

type FormKind = 'academic_year' | 'semester' | 'program' | 'year_level' | 'section' | null;

interface AcademicManagerProps {
  structure: AcademicStructure;
  reference: AdminReferenceData;
}

const FORM_TITLES: Record<Exclude<FormKind, null>, string> = {
  academic_year: 'New Academic Year',
  semester: 'New Semester',
  program: 'New Program',
  year_level: 'New Year Level',
  section: 'New Section',
};

/** Used for the success/error wording around each create. */
const ENTITY_LABELS: Record<Exclude<FormKind, null>, string> = {
  academic_year: 'Academic year',
  semester: 'Semester',
  program: 'Program',
  year_level: 'Year level',
  section: 'Section',
};

/**
 * Super-admin CRUD for the academic structure. Mutations go through the server
 * actions in ./actions, which re-authorize the caller and enforce validation;
 * this component only renders the controls and surfaces the result.
 */
export default function AcademicManager({
  structure,
  reference,
}: AcademicManagerProps): JSX.Element {
  const router = useRouter();

  const [kind, setKind] = useState<FormKind>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function openForm(next: Exclude<FormKind, null>): void {
    setFields({});
    setError(null);
    setKind(next);
  }

  function closeForm(): void {
    setKind(null);
    setFields({});
    setError(null);
  }

  function set(name: string, value: string): void {
    setFields((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!kind) return;

    setLoading(true);
    setError(null);

    let result;
    switch (kind) {
      case 'academic_year':
        result = await createAcademicYear({
          name: fields.name ?? '',
          startsOn: fields.startsOn ?? '',
          endsOn: fields.endsOn ?? '',
        });
        break;
      case 'semester':
        result = await createSemester({
          academicYearId: fields.academicYearId ?? '',
          name: fields.name ?? '',
          startsOn: fields.startsOn ?? '',
          endsOn: fields.endsOn ?? '',
        });
        break;
      case 'program':
        result = await createProgram({ code: fields.code ?? '', name: fields.name ?? '' });
        break;
      case 'year_level':
        result = await createYearLevel({
          name: fields.name ?? '',
          sortOrder: Number(fields.sortOrder ?? '0'),
        });
        break;
      case 'section':
        result = await createSection({
          programId: fields.programId ?? '',
          yearLevelId: fields.yearLevelId ?? '',
          name: fields.name ?? '',
        });
        break;
    }

    setLoading(false);

    if (result && 'error' in result) {
      setError(result.error);
      notifyError('Could not save', result.error);
      return;
    }

    notifySuccess(`${ENTITY_LABELS[kind]} created`);
    closeForm();
    router.refresh();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-6">
        <Button size="sm" onClick={() => openForm('academic_year')}>New Academic Year</Button>
        <Button size="sm" variant="secondary" onClick={() => openForm('semester')}>New Semester</Button>
        <Button size="sm" variant="secondary" onClick={() => openForm('program')}>New Program</Button>
        <Button size="sm" variant="secondary" onClick={() => openForm('year_level')}>New Year Level</Button>
        <Button size="sm" variant="secondary" onClick={() => openForm('section')}>New Section</Button>
      </div>

      <Modal
        open={kind !== null}
        onClose={closeForm}
        title={kind ? FORM_TITLES[kind] : ''}
        actions={
          <>
            <Button variant="ghost" onClick={closeForm}>Cancel</Button>
            <Button onClick={handleSubmit} loading={loading}>Create</Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {kind === 'academic_year' && (
            <>
              <Input label="Name" value={fields.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="2026-2027" required />
              <Input label="Starts on" type="date" value={fields.startsOn ?? ''} onChange={(e) => set('startsOn', e.target.value)} required />
              <Input label="Ends on" type="date" value={fields.endsOn ?? ''} onChange={(e) => set('endsOn', e.target.value)} required />
            </>
          )}

          {kind === 'semester' && (
            <>
              <Select label="Academic year" value={fields.academicYearId ?? ''} onChange={(e) => set('academicYearId', e.target.value)} required>
                <option value="">Select an academic year…</option>
                {reference.academicYears.map((y) => (
                  <option key={y.id} value={y.id}>{y.name}</option>
                ))}
              </Select>
              <Input label="Name" value={fields.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="1st Semester" required />
              <Input label="Starts on" type="date" value={fields.startsOn ?? ''} onChange={(e) => set('startsOn', e.target.value)} required />
              <Input label="Ends on" type="date" value={fields.endsOn ?? ''} onChange={(e) => set('endsOn', e.target.value)} required />
            </>
          )}

          {kind === 'program' && (
            <>
              <Input label="Code" value={fields.code ?? ''} onChange={(e) => set('code', e.target.value)} placeholder="BSCS" required />
              <Input label="Name" value={fields.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="BS Computer Science" required />
            </>
          )}

          {kind === 'year_level' && (
            <>
              <Input label="Name" value={fields.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="1st Year" required />
              <Input label="Sort order" type="number" min={0} max={99} value={fields.sortOrder ?? '0'} onChange={(e) => set('sortOrder', e.target.value)} />
            </>
          )}

          {kind === 'section' && (
            <>
              <Select label="Program" value={fields.programId ?? ''} onChange={(e) => set('programId', e.target.value)} required>
                <option value="">Select a program…</option>
                {reference.programs.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </Select>
              <Select label="Year level" value={fields.yearLevelId ?? ''} onChange={(e) => set('yearLevelId', e.target.value)} required>
                <option value="">Select a year level…</option>
                {reference.yearLevels.map((y) => (
                  <option key={y.id} value={y.id}>{y.name}</option>
                ))}
              </Select>
              <Input label="Section name" value={fields.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="A" required />
            </>
          )}

          {error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
        </form>
      </Modal>

      {/* Academic years + semesters -------------------------------------- */}
      <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">
        Academic Years &amp; Semesters
      </h2>
      {structure.academicYears.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)] mb-8">No academic years yet.</p>
      ) : (
        <div className="space-y-3 mb-8">
          {structure.academicYears.map((year) => (
            <div key={year.id} className="rounded-lg border border-[var(--color-border)] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-[var(--color-foreground)]">{year.name}</p>
                  <p className="text-xs text-[var(--color-muted)]">
                    {new Date(year.starts_on).toLocaleDateString()} – {new Date(year.ends_on).toLocaleDateString()}
                  </p>
                </div>
                <RowActions
                  entityLabel="Academic year"
                  isActive={year.is_active}
                  onToggle={() => setAcademicActive('academic_year', year.id, !year.is_active)}
                  onDelete={() => deleteAcademicEntity('academic_year', year.id)}
                  deleteLabel="Delete this academic year?"
                  refresh={() => router.refresh()}
                />
              </div>

              {year.semesters.length > 0 && (
                <div className="mt-3 space-y-2">
                  {year.semesters.map((sem) => (
                    <div
                      key={sem.id}
                      className="flex items-center justify-between rounded-lg bg-[var(--color-surface-hover)] px-3 py-2"
                    >
                      <div>
                        <p className="text-sm text-[var(--color-foreground)]">{sem.name}</p>
                        <p className="text-xs text-[var(--color-muted)]">
                          {new Date(sem.starts_on).toLocaleDateString()} – {new Date(sem.ends_on).toLocaleDateString()}
                        </p>
                      </div>
                      <RowActions
                        entityLabel="Semester"
                        isActive={sem.is_active}
                        compact
                        onToggle={() => setAcademicActive('semester', sem.id, !sem.is_active)}
                        onDelete={() => deleteAcademicEntity('semester', sem.id)}
                        deleteLabel="Delete this semester?"
                        refresh={() => router.refresh()}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Programs / year levels / sections ------------------------------- */}
      <h2 className="text-lg font-semibold text-[var(--color-foreground)] mb-4">
        Programs, Year Levels &amp; Sections
      </h2>
      {structure.programs.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">No programs yet.</p>
      ) : (
        <div className="space-y-3">
          {structure.programs.map((program) => (
            <div key={program.id} className="rounded-lg border border-[var(--color-border)] p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-[var(--color-foreground)]">
                  {program.code} — {program.name}
                </p>
                <RowActions
                  entityLabel="Program"
                  isActive={program.is_active}
                  onToggle={() => setAcademicActive('program', program.id, !program.is_active)}
                  onDelete={() => deleteAcademicEntity('program', program.id)}
                  deleteLabel="Delete this program?"
                  refresh={() => router.refresh()}
                />
              </div>

              <div className="mt-3 space-y-2">
                {program.yearLevels.map((yl) => (
                  <div key={yl.id} className="flex items-start gap-3">
                    <span className="text-xs text-[var(--color-muted)] w-20 shrink-0 pt-0.5">
                      {yl.name}
                    </span>
                    {yl.sections.length === 0 ? (
                      <span className="text-xs text-[var(--color-muted)]">No sections</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {yl.sections.map((sec) => (
                          <span key={sec.id} className="inline-flex items-center gap-1">
                            <Badge variant={sec.is_active ? 'outline' : 'default'}>{sec.name}</Badge>
                            <RowActions
                              entityLabel={`Section ${sec.name}`}
                              isActive={sec.is_active}
                              iconOnly
                              onToggle={() => setAcademicActive('section', sec.id, !sec.is_active)}
                              onDelete={() => deleteAcademicEntity('section', sec.id)}
                              deleteLabel="Delete this section?"
                              refresh={() => router.refresh()}
                            />
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Global year levels (reference rows, deletable) ------------------ */}
      <h2 className="text-lg font-semibold text-[var(--color-foreground)] mt-8 mb-4">Year Levels</h2>
      <div className="flex flex-wrap gap-2">
        {reference.yearLevels.map((yl) => (
          <span key={yl.id} className="inline-flex items-center gap-1">
            <Badge variant="default">{yl.name}</Badge>
            <RowActions
              entityLabel={`Year level ${yl.name}`}
              iconOnly
              isActive
              hideToggle
              onDelete={() => deleteAcademicEntity('year_level', yl.id)}
              deleteLabel="Delete this year level?"
              refresh={() => router.refresh()}
            />
          </span>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row-level controls
// ---------------------------------------------------------------------------

interface RowActionsProps {
  /** Row identity used in toast and confirm wording, e.g. "Semester". */
  entityLabel: string;
  isActive: boolean;
  onToggle?: () => Promise<{ success: true } | { error: string }>;
  onDelete: () => Promise<{ success: true } | { error: string }>;
  /** Confirm-dialog title, e.g. "Delete this semester?". */
  deleteLabel: string;
  refresh: () => void;
  compact?: boolean;
  iconOnly?: boolean;
  hideToggle?: boolean;
}

function RowActions({
  entityLabel,
  isActive,
  onToggle,
  onDelete,
  deleteLabel,
  refresh,
  compact = false,
  iconOnly = false,
  hideToggle = false,
}: RowActionsProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(
    fn: () => Promise<{ success: true } | { error: string }>,
    successMessage: string
  ): Promise<void> {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);

    if ('error' in result) {
      setError(result.error);
      notifyError(`Could not update the ${entityLabel.toLowerCase()}`, result.error);
      return;
    }

    notifySuccess(successMessage);
    refresh();
  }

  return (
    <div className="flex items-center gap-1">
      {error && <span className="text-xs text-[var(--color-danger)] mr-1" role="alert">{error}</span>}
      {!hideToggle && onToggle && (
        <Button
          size="sm"
          variant="ghost"
          loading={busy}
          onClick={() =>
            void run(
              onToggle,
              isActive ? `${entityLabel} deactivated.` : `${entityLabel} activated.`
            )
          }
          title={isActive ? 'Deactivate' : 'Activate'}
        >
          {iconOnly ? (isActive ? 'On' : 'Off') : isActive ? (compact ? 'Disable' : 'Deactivate') : 'Activate'}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        onClick={() => {
          void (async () => {
            const confirmed = await confirmAction({
              title: deleteLabel,
              text: 'This cannot be undone.',
              confirmText: 'Delete',
              destructive: true,
            });
            if (confirmed) await run(onDelete, `${entityLabel} deleted.`);
          })();
        }}
        title={deleteLabel}
        aria-label={deleteLabel}
        className="text-[var(--color-danger)]"
      >
        Delete
      </Button>
    </div>
  );
}
