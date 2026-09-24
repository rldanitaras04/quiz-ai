'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Spinner from '@/components/ui/Spinner';
import { notifyError, notifySuccess } from '@/components/ui/alerts';
import { addStudentToOffering, searchStudents, type StudentSearchHit } from './actions';

interface AddStudentButtonProps {
  offeringId: string;
  /** Called after a successful add (e.g. the admin roster modal reloads itself). */
  onChanged?: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export default function AddStudentButton({ offeringId, onChanged }: AddStudentButtonProps): JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StudentSearchHit[]>([]);
  const [selected, setSelected] = useState<StudentSearchHit | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const searchSeq = useRef(0);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (value.trim().length < MIN_QUERY_LENGTH) {
      searchSeq.current += 1;
      setResults([]);
      setSelected(null);
      setSearching(false);
      setError(null);
    } else {
      setSearching(true);
    }
  };

  useEffect(() => {
    if (!open) return;

    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;

    const seq = ++searchSeq.current;
    const timer = setTimeout(async () => {
      try {
        const result = await searchStudents(offeringId, trimmed);
        if (seq !== searchSeq.current) return;
        if (result.error) {
          setResults([]);
          setSelected(null);
          setError(result.error);
          return;
        }
        const students = result.students ?? [];
        setResults(students);
        const exact = students.find(
          (s) => s.studentNumber.toLowerCase() === trimmed.toLowerCase()
        );
        setSelected(exact ?? null);
        setError(null);
      } catch {
        if (seq !== searchSeq.current) return;
        setResults([]);
        setSelected(null);
        setError('Search failed. Try again.');
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, open, offeringId]);

  const close = () => {
    setOpen(false);
    setError(null);
    setSuccess(false);
    setQuery('');
    setResults([]);
    setSelected(null);
    setSearching(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const studentNumber = selected?.studentNumber ?? query.trim();

    try {
      const result = await addStudentToOffering(offeringId, studentNumber);
      if (result.error) {
        setError(result.error);
        notifyError('Could not add the student', result.error);
      } else {
        setSuccess(true);
        notifySuccess(
          'Student enrolled',
          selected
            ? `${selected.studentNumber}${selected.fullName ? ` — ${selected.fullName}` : ''} added to this offering.`
            : `${studentNumber} added to this offering.`
        );
        setQuery('');
        setResults([]);
        setSelected(null);
        setTimeout(() => {
          close();
          router.refresh();
          onChanged?.();
        }, 700);
      }
    } catch {
      setError('An unexpected error occurred.');
      notifyError('Could not add the student', 'An unexpected error occurred.');
    } finally {
      setLoading(false);
    }
  };

  const canSubmit =
    !loading &&
    !success &&
    !searching &&
    (Boolean(selected) || query.trim().length >= MIN_QUERY_LENGTH);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Add Student</Button>
      <Modal
        open={open}
        onClose={close}
        title="Add Student to Offering"
        actions={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button onClick={handleSubmit} loading={loading} disabled={!canSubmit || success}>
              {success ? 'Added!' : 'Add Student'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Search student"
            value={query}
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder="Student number or name"
            autoComplete="off"
            required={!selected}
          />

          {query.trim().length >= MIN_QUERY_LENGTH && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] max-h-56 overflow-y-auto">
              {searching && results.length === 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-4 text-sm text-[var(--color-muted)]">
                  <Spinner size="sm" />
                  Searching…
                </div>
              ) : results.length === 0 ? (
                <p className="px-3 py-4 text-sm text-[var(--color-muted)]">
                  No students match “{query.trim()}”.
                </p>
              ) : (
                <ul role="listbox" aria-label="Student search results">
                  {results.map((student) => {
                    const isSelected = selected?.userId === student.userId;
                    return (
                      <li key={student.userId}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => setSelected(student)}
                          className={`w-full text-left px-3 py-2 border-b border-[var(--color-border)] last:border-0 transition-colors ${
                            isSelected
                              ? 'bg-[var(--color-primary-light)]'
                              : 'hover:bg-[var(--color-surface-hover)]'
                          }`}
                        >
                          <span className="block text-sm font-medium text-[var(--color-foreground)]">
                            {student.fullName || '(unknown name)'}
                          </span>
                          <span className="block text-xs font-mono text-[var(--color-muted)]">
                            {student.studentNumber}
                            {student.email ? ` · ${student.email}` : ''}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {selected && (
            <p className="text-sm text-[var(--color-muted)]">
              Adding{' '}
              <span className="font-medium text-[var(--color-foreground)]">
                {selected.fullName || selected.studentNumber}
              </span>
              .
            </p>
          )}

          {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
          {success && <p className="text-sm text-[var(--color-success)]">Student added successfully!</p>}
        </form>
      </Modal>
    </>
  );
}
