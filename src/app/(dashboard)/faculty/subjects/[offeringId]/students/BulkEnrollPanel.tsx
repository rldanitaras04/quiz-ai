'use client';

import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { describeSummary } from '@/lib/enrollment-summary';
import {
  enrollStudentsByIds,
  listSectionStudents,
  searchStudents,
  type StudentSearchHit,
} from './actions';

interface BulkEnrollPanelProps {
  offeringId: string;
  /** Fallback label while the section roster loads. */
  sectionName?: string;
  onChanged?: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

function isEnrolled(status: string | null | undefined): boolean {
  return status === 'enrolled';
}

/**
 * Shared bulk-enroll body: section checklist (select all / individual) plus
 * directory search so irregular students outside the section can be added.
 */
export default function BulkEnrollPanel({
  offeringId,
  sectionName,
  onChanged,
}: BulkEnrollPanelProps): JSX.Element {
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentSearchHit[]>([]);
  const [resolvedSectionName, setResolvedSectionName] = useState<string | null>(sectionName ?? null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** Search hits that are not on the section roster (irregular students). */
  const [manualHits, setManualHits] = useState<StudentSearchHit[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const searchSeq = useRef(0);

  const load = useCallback(async () => {
    const result = await listSectionStudents(offeringId);
    setError(result.error ?? null);
    if (result.error) {
      setStudents([]);
      setResolvedSectionName(sectionName ?? null);
      setLoadingList(false);
      return;
    }
    setStudents(result.students ?? []);
    setResolvedSectionName(result.sectionName ?? sectionName ?? null);
    // Preselect everyone not yet enrolled so "select all" and the default agree.
    setSelectedIds(
      new Set(
        (result.students ?? [])
          .filter((s) => !isEnrolled(s.enrollmentStatus))
          .map((s) => s.userId)
      )
    );
    setLoadingList(false);
  }, [offeringId, sectionName]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listSectionStudents(offeringId);
      if (cancelled) return;
      setError(result.error ?? null);
      if (result.error) {
        setStudents([]);
        setResolvedSectionName(sectionName ?? null);
        setLoadingList(false);
        return;
      }
      setStudents(result.students ?? []);
      setResolvedSectionName(result.sectionName ?? sectionName ?? null);
      setSelectedIds(
        new Set(
          (result.students ?? [])
            .filter((s) => !isEnrolled(s.enrollmentStatus))
            .map((s) => s.userId)
        )
      );
      setLoadingList(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [offeringId, sectionName]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    const trimmed = value.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      searchSeq.current += 1;
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const result = await searchStudents(offeringId, trimmed);
        if (seq !== searchSeq.current) return;
        if (result.error) {
          setResults([]);
          setSearchError(result.error);
          return;
        }
        setResults(result.students ?? []);
        setSearchError(null);
      } catch {
        if (seq !== searchSeq.current) return;
        setResults([]);
        setSearchError('Search failed. Try again.');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, offeringId]);

  const sectionIds = new Set(students.map((s) => s.userId));
  const enrollable = students.filter((s) => !isEnrolled(s.enrollmentStatus));
  const allEnrollableSelected =
    enrollable.length > 0 && enrollable.every((s) => selectedIds.has(s.userId));

  const toggle = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectAllEnrollable = () => {
    setSelectedIds(new Set(enrollable.map((s) => s.userId)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setManualHits([]);
  };

  const addIrregular = (hit: StudentSearchHit) => {
    if (sectionIds.has(hit.userId)) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.add(hit.userId);
        return next;
      });
      setQuery('');
      setResults([]);
      setSearching(false);
      return;
    }
    setManualHits((prev) => {
      if (prev.some((h) => h.userId === hit.userId)) return prev;
      return [...prev, hit];
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(hit.userId);
      return next;
    });
    setQuery('');
    setResults([]);
    setSearching(false);
  };

  const removeIrregular = (userId: string) => {
    setManualHits((prev) => prev.filter((h) => h.userId !== userId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  };

  const handleEnroll = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setEnrolling(true);
    setLoadingList(true);
    const result = await enrollStudentsByIds(offeringId, ids);
    setEnrolling(false);

    if (result.error) {
      notifyError('Could not enroll students', result.error);
      setError(result.error);
      return;
    }
    if (result.summary) {
      notifySuccess('Students enrolled', describeSummary(result.summary));
      setQuery('');
      setResults([]);
      setManualHits([]);
      setSearching(false);
      await load();
      onChanged?.();
    }
  };

  return (
    <div className="space-y-5">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-[var(--color-foreground)]">
            Section roster
            {resolvedSectionName ? (
              <span className="font-normal text-[var(--color-muted)]"> · {resolvedSectionName}</span>
            ) : null}
          </h3>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingList || enrollable.length === 0}
              onClick={selectAllEnrollable}
            >
              {allEnrollableSelected ? 'All selected' : 'Select all'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={selectedIds.size === 0 && manualHits.length === 0}
              onClick={clearSelection}
            >
              Clear
            </Button>
          </div>
        </div>

        <p className="text-sm text-[var(--color-muted)] mb-3">
          Choose who to enroll from students assigned to this section.
        </p>

        {loadingList ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-[var(--color-muted)]">
            <Spinner size="sm" />
            Loading section students…
          </div>
        ) : error ? (
          <p className="text-sm text-[var(--color-danger)]" role="alert">{error}</p>
        ) : students.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            No students are assigned to this section. Search below to add irregular students.
          </p>
        ) : (
          <ul className="max-h-64 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
            {students.map((student) => {
              const checked = selectedIds.has(student.userId);
              const enrolled = isEnrolled(student.enrollmentStatus);
              return (
                <li key={student.userId}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-[var(--color-surface-hover)]">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      checked={checked}
                      onChange={() => toggle(student.userId)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--color-foreground)] truncate">
                        {student.fullName || '(unknown name)'}
                      </span>
                      <span className="block text-xs font-mono text-[var(--color-muted)]">
                        {student.studentNumber}
                        {student.email ? ` · ${student.email}` : ''}
                      </span>
                    </span>
                    <Badge variant={enrolled ? 'success' : 'default'}>
                      {enrolled ? 'Enrolled' : student.enrollmentStatus ?? 'Not enrolled'}
                    </Badge>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="border-t border-[var(--color-border)] pt-4">
        <h3 className="text-sm font-semibold text-[var(--color-foreground)] mb-1">
          Add irregular students
        </h3>
        <p className="text-sm text-[var(--color-muted)] mb-3">
          Search by student number or name — students outside this section can still be enrolled.
        </p>

        <Input
          label="Search student"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder="Student number or name"
          autoComplete="off"
        />

        {query.trim().length >= MIN_QUERY_LENGTH && (
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-border)] max-h-48 overflow-y-auto">
            {searching && results.length === 0 ? (
              <div className="flex items-center justify-center gap-2 px-3 py-4 text-sm text-[var(--color-muted)]">
                <Spinner size="sm" />
                Searching…
              </div>
            ) : searchError ? (
              <p className="px-3 py-4 text-sm text-[var(--color-danger)]">{searchError}</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-4 text-sm text-[var(--color-muted)]">
                No students match “{query.trim()}”.
              </p>
            ) : (
              <ul>
                {results.map((student) => {
                  const onSection = sectionIds.has(student.userId);
                  const alreadySelected = selectedIds.has(student.userId);
                  return (
                    <li
                      key={student.userId}
                      className="flex items-center gap-3 border-b border-[var(--color-border)] last:border-0 px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--color-foreground)] truncate">
                          {student.fullName || '(unknown name)'}
                        </span>
                        <span className="block text-xs font-mono text-[var(--color-muted)]">
                          {student.studentNumber}
                          {student.email ? ` · ${student.email}` : ''}
                        </span>
                      </span>
                      {onSection && !alreadySelected ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => addIrregular(student)}>
                          Select
                        </Button>
                      ) : (
                        <Badge variant={alreadySelected ? 'info' : 'success'}>
                          {alreadySelected ? 'Selected' : onSection ? 'On roster' : 'Added'}
                        </Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {manualHits.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {manualHits.map((student) => (
              <li key={student.userId}>
                <button
                  type="button"
                  onClick={() => removeIrregular(student.userId)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-surface-hover)]"
                  title="Remove from selection"
                >
                  <span className="font-mono">{student.studentNumber}</span>
                  <span className="text-[var(--color-muted)]">
                    {student.fullName || 'student'}
                  </span>
                  <span aria-hidden="true" className="text-[var(--color-muted)]">×</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <p className="text-sm text-[var(--color-muted)]" data-selection-summary>
          {selectedIds.size === 0
            ? 'No students selected'
            : `${selectedIds.size} student${selectedIds.size === 1 ? '' : 's'} selected`}
        </p>
        <Button
          type="button"
          loading={enrolling}
          disabled={enrolling || selectedIds.size === 0}
          onClick={() => void handleEnroll()}
        >
          Enroll selected
        </Button>
      </div>
    </div>
  );
}
