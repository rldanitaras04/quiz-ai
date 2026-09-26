'use client';

import { useState, type JSX } from 'react';
import { Lock } from '@phosphor-icons/react';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Pagination from '@/components/ui/Pagination';

const PAGE_SIZE = 25;

export interface GradebookColumn {
  id: string;
  title: string;
  date: string | null;
  /** Total points for the assessment; shown as "Title (40 points)". */
  points: number | null;
}

export interface GradebookCell {
  /** Best percentage across attempts; null when nothing has been scored yet. */
  pct: number | null;
  /** Raw score of that best attempt, for "20 (50%)" display. */
  score: number | null;
  /** Whether that score has been released to the student. */
  released: boolean;
  attempts: number;
}

export interface GradebookRow {
  id: string;
  studentNumber: string;
  name: string;
  /** Aligned to the columns array by index. */
  cells: GradebookCell[];
}

function formatPct(pct: number): string {
  const rounded = Math.round(pct * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function formatScore(cell: GradebookCell): string {
  if (cell.pct === null) return '—';
  const pct = formatPct(cell.pct);
  if (cell.score === null) return pct;
  const score = Math.round(cell.score * 100) / 100;
  return `${score % 1 === 0 ? score.toFixed(0) : score} (${pct})`;
}

/** Header label: "Quiz 1 (40 points)" — points omitted when unknown. */
function headerTitle(column: GradebookColumn): string {
  return column.points != null ? `${column.title} (${column.points} points)` : column.title;
}

/**
 * Student scores across every deployment of one section: rows = enrolled
 * students, columns = deployed assessments. Paginated like the roster table;
 * the Table wrapper owns horizontal scrolling for wide matrices, and below
 * `lg` each student renders as a card labelled by assessment.
 */
export default function GradebookTable({
  columns,
  rows,
}: {
  columns: GradebookColumn[];
  rows: GradebookRow[];
}): JSX.Element {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const hasUnreleased = rows.some((row) =>
    row.cells.some((cell) => cell.pct !== null && !cell.released)
  );

  return (
    <>
      {hasUnreleased && (
        <p className="mb-3 inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Lock size={14} aria-hidden="true" />
          A lock means the score has not been released to the student yet.
        </p>
      )}
      <Table caption="Student scores for each deployed assessment" cards>
        <THead>
          <TR>
            <TH className="whitespace-nowrap align-top">Student</TH>
            {columns.map((column) => (
              // Assessment headers are right-aligned so titles and dates sit
              // directly above the right-aligned score cells.
              <TH key={column.id} align="right" className="align-top">
                <div className="ml-auto min-w-[120px] max-w-[210px]">
                  <div className="truncate font-medium text-[var(--color-foreground)]">
                    {headerTitle(column)}
                  </div>
                  <div className="text-xs font-normal">
                    {column.date ?? 'No date'}
                  </div>
                </div>
              </TH>
            ))}
          </TR>
        </THead>
        <TBody>
          {paged.map((row) => (
            <TR key={row.id}>
              <TD primary label="Student" className="whitespace-nowrap align-top">
                <div className="font-medium text-[var(--color-foreground)]">{row.name}</div>
                <div className="font-mono text-xs text-[var(--color-muted)]">{row.studentNumber}</div>
              </TD>
              {row.cells.map((cell, index) => {
                const column = columns[index];
                const showTries = cell.attempts > 1 || (cell.pct === null && cell.attempts > 0);
                return (
                  <TD
                    key={column.id}
                    label={headerTitle(column)}
                    numeric
                    align="right"
                    className="align-top"
                  >
                    <div className="inline-flex items-center gap-1">
                      <span
                        className={
                          cell.pct === null
                            ? 'text-[var(--color-muted)]'
                            : 'font-semibold text-[var(--color-foreground)]'
                        }
                      >
                        {formatScore(cell)}
                      </span>
                      {cell.pct !== null && !cell.released && (
                        <Lock
                          size={13}
                          className="text-[var(--color-muted)]"
                          aria-label="Not yet released to students"
                        />
                      )}
                    </div>
                    {showTries && (
                      <div className="text-xs text-[var(--color-muted)]">
                        {cell.attempts} {cell.attempts === 1 ? 'try' : 'tries'}
                      </div>
                    )}
                  </TD>
                );
              })}
            </TR>
          ))}
        </TBody>
      </Table>
      <Pagination page={safePage} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} />
    </>
  );
}
