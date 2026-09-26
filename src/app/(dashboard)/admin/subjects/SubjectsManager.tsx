'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';
import { confirmAction, notifyError, notifySuccess } from '@/components/ui/alerts';
import type { AdminReferenceData } from '../actions';
import type { SubjectOverview, OfferingWithFaculty } from './actions';
import ManageStudentsModal from './ManageStudentsModal';
import {
  createSubject,
  updateSubject,
  setSubjectActive,
  deleteSubject,
  createOffering,
  setOfferingStatus,
  deleteOffering,
  assignFaculty,
  removeFacultyAssignment,
} from './actions';

interface SubjectsManagerProps {
  subjects: SubjectOverview[];
  reference: AdminReferenceData;
  /** Defaults to the combined subjects+offerings view; /admin/subjects/offerings passes 'offerings'. */
  view?: 'all' | 'offerings';
}

const offeringStatusVariant: Record<string, 'success' | 'warning' | 'default'> = {
  active: 'success',
  inactive: 'warning',
  archived: 'default',
};

const PAGE_SIZE = 25;

interface SubjectFormState {
  mode: 'create' | 'edit';
  id: string;
  code: string;
  title: string;
  description: string;
}

interface OfferingFormState {
  subjectId: string;
  semesterId: string;
  programId: string;
  yearLevelId: string;
  sectionId: string;
}

export default function SubjectsManager({
  subjects,
  reference,
  view = 'all',
}: SubjectsManagerProps): JSX.Element {
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [subjectForm, setSubjectForm] = useState<SubjectFormState | null>(null);
  const [offeringForm, setOfferingForm] = useState<OfferingFormState | null>(null);
  const [rosterOfferingId, setRosterOfferingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const query = search.toLowerCase();
  const filtered = query
    ? subjects.filter(
        (s) =>
          s.code.toLowerCase().includes(query) ||
          s.title.toLowerCase().includes(query) ||
          s.offerings.some(
            (o) =>
              o.program.toLowerCase().includes(query) ||
              o.section.toLowerCase().includes(query) ||
              o.faculty.some((f) => f.fullName.toLowerCase().includes(query))
          )
        )
      : subjects;

  // Flat offering rows for the dedicated Subject Offerings route.
  const flatOfferings = filtered.flatMap((subject) =>
    subject.offerings.map((offering) => ({ subject, offering }))
  );

  // Clamp so actions on the last row of the final page never show a blank page.
  const pageCount = Math.max(1, Math.ceil(flatOfferings.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedOfferings = flatOfferings.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  function closeForms(): void {
    setSubjectForm(null);
    setOfferingForm(null);
    setError(null);
  }

  async function submitSubject(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!subjectForm) return;

    setLoading(true);
    setError(null);

    const result =
      subjectForm.mode === 'create'
        ? await createSubject({
            code: subjectForm.code,
            title: subjectForm.title,
            description: subjectForm.description,
          })
        : await updateSubject({
            id: subjectForm.id,
            code: subjectForm.code,
            title: subjectForm.title,
            description: subjectForm.description,
          });

    setLoading(false);
    if ('error' in result) {
      setError(result.error);
      notifyError('Could not save the subject', result.error);
      return;
    }
    notifySuccess(
      subjectForm.mode === 'create' ? 'Subject created' : 'Subject updated',
      subjectForm.code
    );
    closeForms();
    router.refresh();
  }

  async function submitOffering(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!offeringForm) return;

    setLoading(true);
    setError(null);

    const result = await createOffering(offeringForm);

    setLoading(false);
    if ('error' in result) {
      setError(result.error);
      notifyError('Could not create the offering', result.error);
      return;
    }
    notifySuccess('Offering created');
    closeForms();
    router.refresh();
  }

  // Sections valid for the offering form's chosen program + year level.
  const availableSections = offeringForm
    ? reference.sections.filter(
        (s) =>
          (!offeringForm.programId || s.programId === offeringForm.programId) &&
          (!offeringForm.yearLevelId || s.yearLevelId === offeringForm.yearLevelId)
      )
    : [];

  return (
    <>
      <ManageStudentsModal
        offeringId={rosterOfferingId ?? ''}
        open={rosterOfferingId !== null}
        onClose={() => setRosterOfferingId(null)}
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {view !== 'offerings' && (
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setSubjectForm({ mode: 'create', id: '', code: '', title: '', description: '' });
            }}
          >
            New Subject
          </Button>
        )}
        {view === 'offerings' && (
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setOfferingForm({ subjectId: '', semesterId: '', programId: '', yearLevelId: '', sectionId: '' });
            }}
          >
            New Offering
          </Button>
        )}
        <Input
          placeholder="Search by code, title, program, section, or faculty…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="max-w-md"
        />
      </div>

      {/* Subject create/edit ------------------------------------------- */}
      <Modal
        open={subjectForm !== null}
        onClose={closeForms}
        title={subjectForm?.mode === 'edit' ? 'Edit Subject' : 'New Subject'}
        actions={
          <>
            <Button variant="ghost" onClick={closeForms}>Cancel</Button>
            <Button onClick={submitSubject} loading={loading}>
              {subjectForm?.mode === 'edit' ? 'Save' : 'Create'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitSubject} className="space-y-4">
          <Input
            label="Code"
            value={subjectForm?.code ?? ''}
            onChange={(e) => setSubjectForm((f) => (f ? { ...f, code: e.target.value } : f))}
            placeholder="CS101"
            required
          />
          <Input
            label="Title"
            value={subjectForm?.title ?? ''}
            onChange={(e) => setSubjectForm((f) => (f ? { ...f, title: e.target.value } : f))}
            placeholder="Introduction to Computing"
            required
          />
          <Input
            label="Description"
            value={subjectForm?.description ?? ''}
            onChange={(e) => setSubjectForm((f) => (f ? { ...f, description: e.target.value } : f))}
            placeholder="Optional"
          />
          {error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
        </form>
      </Modal>

      {/* Offering create ---------------------------------------------- */}
      <Modal
        open={offeringForm !== null}
        onClose={closeForms}
        title="New Offering"
        actions={
          <>
            <Button variant="ghost" onClick={closeForms}>Cancel</Button>
            <Button onClick={submitOffering} loading={loading}>Create</Button>
          </>
        }
      >
        <form onSubmit={submitOffering} className="space-y-4">
          {view === 'offerings' && (
            <Select
              label="Subject"
              value={offeringForm?.subjectId ?? ''}
              onChange={(e) => setOfferingForm((f) => (f ? { ...f, subjectId: e.target.value } : f))}
              required
            >
              <option value="">Select a subject…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.title}</option>
              ))}
            </Select>
          )}
          <Select
            label="Semester"
            value={offeringForm?.semesterId ?? ''}
            onChange={(e) => setOfferingForm((f) => (f ? { ...f, semesterId: e.target.value } : f))}
            required
          >
            <option value="">Select a semester…</option>
            {reference.semesters.map((s) => (
              <option key={s.id} value={s.id}>{s.name} ({s.academicYearName})</option>
            ))}
          </Select>
          <Select
            label="Program"
            value={offeringForm?.programId ?? ''}
            onChange={(e) =>
              setOfferingForm((f) => (f ? { ...f, programId: e.target.value, sectionId: '' } : f))
            }
            required
          >
            <option value="">Select a program…</option>
            {reference.programs.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
            ))}
          </Select>
          <Select
            label="Year level"
            value={offeringForm?.yearLevelId ?? ''}
            onChange={(e) =>
              setOfferingForm((f) => (f ? { ...f, yearLevelId: e.target.value, sectionId: '' } : f))
            }
            required
          >
            <option value="">Select a year level…</option>
            {reference.yearLevels.map((y) => (
              <option key={y.id} value={y.id}>{y.name}</option>
            ))}
          </Select>
          <Select
            label="Section"
            value={offeringForm?.sectionId ?? ''}
            onChange={(e) => setOfferingForm((f) => (f ? { ...f, sectionId: e.target.value } : f))}
            error={
              offeringForm?.programId && offeringForm?.yearLevelId && availableSections.length === 0
                ? 'No sections exist for that program and year level yet. Create one under Academic Structure.'
                : undefined
            }
            required
          >
            <option value="">Select a section…</option>
            {availableSections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
          {error && <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>}
        </form>
      </Modal>

      {/* Subject list, or the flat offerings table ---------------------- */}
      {view === 'offerings' ? (
        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold text-[var(--color-foreground)]">
              Subject Offerings ({flatOfferings.length})
            </h2>
          </CardHeader>
          <CardContent>
            {flatOfferings.length === 0 ? (
              <EmptyState
                title="No offerings found"
                description={
                  query
                    ? 'Try adjusting your search query.'
                    : 'Create your first offering to schedule a subject into a section.'
                }
              />
            ) : (
              <>
                <Table cards caption="Subject offerings">
                  <THead>
                    <TR>
                      <TH>Subject</TH>
                      <TH>Semester</TH>
                      <TH>Program</TH>
                      <TH>Year</TH>
                      <TH>Section</TH>
                      <TH>Enrolled</TH>
                      <TH>Status</TH>
                      <TH>Faculty</TH>
                      <TH>Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {pagedOfferings.map(({ subject, offering }) => (
                      <OfferingRow
                        key={offering.id}
                        subjectLabel={`${subject.code} – ${subject.title}`}
                        offering={offering}
                        facultyOptions={reference.faculty}
                        onChanged={() => router.refresh()}
                        onManageStudents={() => setRosterOfferingId(offering.id)}
                      />
                    ))}
                  </TBody>
                </Table>
                <Pagination
                  page={safePage}
                  pageSize={PAGE_SIZE}
                  total={flatOfferings.length}
                  onPageChange={setPage}
                />
              </>
            )}
          </CardContent>
        </Card>
      ) : (
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                title="No subjects found"
                description={
                  query
                    ? 'Try adjusting your search query.'
                    : 'Create your first subject to begin building offerings.'
                }
              />
            </CardContent>
          </Card>
        ) : (
          filtered.map((subject) => (
            <Card key={subject.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-[var(--color-foreground)]">
                      {subject.code} – {subject.title}
                    </h3>
                    {subject.description && (
                      <p className="text-sm text-[var(--color-muted)]">{subject.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={subject.isActive ? 'success' : 'default'}>
                      {subject.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setSubjectForm({
                          mode: 'edit',
                          id: subject.id,
                          code: subject.code,
                          title: subject.title,
                          description: subject.description ?? '',
                        })
                      }
                    >
                      Edit
                    </Button>
                    <ActionButton
                      label={subject.isActive ? 'Deactivate' : 'Activate'}
                      onClick={() => setSubjectActive(subject.id, !subject.isActive)}
                      onDone={() => router.refresh()}
                      successMessage={
                        subject.isActive
                          ? `${subject.code} deactivated.`
                          : `${subject.code} activated.`
                      }
                    />
                    <ActionButton
                      label="Delete"
                      danger
                      confirmMessage={`Delete ${subject.code}?`}
                      confirmText="Delete subject"
                      confirmBody="Its offerings and assessments must already be removed. This cannot be undone."
                      onClick={() => deleteSubject(subject.id)}
                      onDone={() => router.refresh()}
                      successMessage={`${subject.code} deleted.`}
                    />
                  </div>
                </div>
              </CardHeader>

              <CardContent>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wide">
                    Offerings ({subject.offerings.length})
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setError(null);
                      setOfferingForm({
                        subjectId: subject.id,
                        semesterId: '',
                        programId: '',
                        yearLevelId: '',
                        sectionId: '',
                      });
                    }}
                  >
                    New Offering
                  </Button>
                </div>

                {subject.offerings.length === 0 ? (
                  <p className="text-sm text-[var(--color-muted)]">No offerings yet.</p>
                ) : (
                  <Table cards caption={`Offerings for ${subject.code}`}>
                    <THead>
                      <TR>
                        <TH>Semester</TH>
                        <TH>Program</TH>
                        <TH>Year</TH>
                        <TH>Section</TH>
                        <TH>Enrolled</TH>
                        <TH>Status</TH>
                        <TH>Faculty</TH>
                        <TH>Actions</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {subject.offerings.map((offering) => (
                        <OfferingRow
                          key={offering.id}
                          offering={offering}
                          facultyOptions={reference.faculty}
                          onChanged={() => router.refresh()}
                          onManageStudents={() => setRosterOfferingId(offering.id)}
                        />
                      ))}
                    </TBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Offering row
// ---------------------------------------------------------------------------

function OfferingRow({
  offering,
  facultyOptions,
  onChanged,
  onManageStudents,
  subjectLabel,
}: {
  offering: OfferingWithFaculty;
  facultyOptions: AdminReferenceData['faculty'];
  onChanged: () => void;
  onManageStudents: () => void;
  /** Extra leading column used by the flat Subject Offerings table. */
  subjectLabel?: string;
}): JSX.Element {
  const assignedIds = new Set(offering.faculty.map((f) => f.facultyId));
  const unassigned = facultyOptions.filter((f) => !assignedIds.has(f.id));

  return (
    <TR className="align-top">
      {subjectLabel !== undefined && (
        <TD primary label="Subject" className="font-medium text-[var(--color-foreground)]">
          {subjectLabel}
        </TD>
      )}
      <TD
        primary={subjectLabel === undefined}
        label="Semester"
        className="text-[var(--color-foreground)]"
      >
        {offering.semester}
        <span className="text-[var(--color-muted)] ml-1">({offering.academicYear})</span>
      </TD>
      <TD label="Program" hideOnMobile className="text-[var(--color-muted)]">{offering.program}</TD>
      <TD label="Year" hideOnMobile className="text-[var(--color-muted)]">{offering.yearLevel}</TD>
      <TD label="Section" className="text-[var(--color-muted)]">{offering.section}</TD>
      <TD label="Enrolled" className="font-medium text-[var(--color-foreground)]">
        {offering.enrolledCount}
      </TD>
      <TD label="Status">
        <Badge variant={offeringStatusVariant[offering.status] ?? 'default'}>
          {offering.status}
        </Badge>
      </TD>
      <TD label="Faculty">
        <div className="flex flex-col gap-1">
          {offering.faculty.length === 0 && (
            <span className="text-xs text-[var(--color-muted)]">Unassigned</span>
          )}
          {offering.faculty.map((f) => (
            <span key={f.assignmentId} className="inline-flex items-center gap-1">
              <Badge variant={f.isPrimary ? 'info' : 'default'}>{f.fullName}</Badge>
              <ActionButton
                label="Remove"
                compact
                confirmMessage={`Remove ${f.fullName} from this offering?`}
                onClick={() => removeFacultyAssignment(f.assignmentId)}
                onDone={onChanged}
              />
            </span>
          ))}
          {unassigned.length > 0 && (
            <Select
              aria-label="Assign faculty"
              value=""
              onChange={(e) => {
                const facultyId = e.target.value;
                if (!facultyId) return;
                void (async () => {
                  const result = await assignFaculty({ offeringId: offering.id, facultyId });
                  if ('error' in result) {
                    notifyError('Could not assign the faculty member', result.error);
                    return;
                  }
                  notifySuccess('Faculty assigned');
                  onChanged();
                })();
              }}
            >
              <option value="">Assign faculty…</option>
              {unassigned.map((f) => (
                <option key={f.id} value={f.id}>{f.fullName}</option>
              ))}
            </Select>
          )}
        </div>
      </TD>
      <TD label="Actions">
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="outline"
            className="!h-7 !px-2 !text-xs"
            onClick={onManageStudents}
          >
            Students ({offering.enrolledCount})
          </Button>
          <Select
            aria-label="Offering status"
            value={offering.status}
            onChange={(e) => {
              const status = e.target.value;
              void (async () => {
                const result = await setOfferingStatus(offering.id, status);
                if ('error' in result) {
                  notifyError('Could not update the offering', result.error);
                  return;
                }
                notifySuccess('Offering status updated', `Now ${status}.`);
                onChanged();
              })();
            }}
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="archived">archived</option>
          </Select>
          <ActionButton
            label="Delete"
            danger
            confirmMessage="Delete this offering?"
            confirmText="Delete offering"
            confirmBody="This cannot be undone. Archive it instead if it still has enrollments or deployments."
            onClick={() => deleteOffering(offering.id)}
            onDone={onChanged}
            successMessage="Offering deleted."
          />
        </div>
      </TD>
    </TR>
  );
}

// ---------------------------------------------------------------------------
// Generic inline action button with pending + error state
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  onClick,
  onDone,
  confirmMessage,
  confirmText,
  confirmBody,
  successMessage,
  danger = false,
  compact = false,
}: {
  label: string;
  onClick: () => Promise<{ success: true } | { error: string }>;
  onDone: () => void;
  confirmMessage?: string;
  /** Overrides the confirmation's confirm-button label (defaults to `label`). */
  confirmText?: string;
  confirmBody?: string;
  successMessage?: string;
  danger?: boolean;
  compact?: boolean;
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (confirmMessage) {
      const confirmed = await confirmAction({
        title: confirmMessage,
        text: confirmBody,
        confirmText: confirmText ?? label,
        destructive: danger,
      });
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    const result = await onClick();
    setBusy(false);

    if ('error' in result) {
      setError(result.error);
      notifyError(`Could not ${label.toLowerCase()}`, result.error);
      return;
    }

    if (successMessage) notifySuccess(successMessage);
    onDone();
  }

  return (
    <span className="inline-flex items-center gap-1">
      {error && <span className="text-xs text-[var(--color-danger)]" role="alert">{error}</span>}
      <Button
        size="sm"
        variant="ghost"
        loading={busy}
        onClick={() => void run()}
        className={danger ? 'text-[var(--color-danger)]' : ''}
      >
        {compact ? (label === 'Remove' ? '×' : label) : label}
      </Button>
    </span>
  );
}
