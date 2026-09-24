import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Link from 'next/link';
import CollapsibleSubjectCard from './CollapsibleSubjectCard';

interface ResultRow {
  id: string;
  attempt_id: string;
  raw_score: number;
  possible_score: number;
  percentage: number;
  released_at: string | null;
  created_at: string;
}

interface ParsedResult {
  id: string;
  attemptId: string;
  rawScore: number;
  possibleScore: number;
  percentage: number;
  releasedLabel: string;
  assessmentId: string | null;
  assessmentTitle: string;
  assessmentType: string;
  subjectKey: string;
  subjectLabel: string;
  sectionLabel: string | null;
}

function formatType(type: string | undefined): string {
  return type === 'multiple_choice' ? 'Multiple Choice' : 'Identification';
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString();
}

export default async function StudentResultsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: results } = await supabase
    .from('assessment_results')
    .select(`
      id,
      attempt_id,
      raw_score,
      possible_score,
      percentage,
      status,
      released_at,
      created_at,
      deployment:assessment_deployments(
        id,
        subject_offering:subject_offerings(
          id,
          subject:subjects(id, code, title),
          section:sections(name)
        ),
        assessment_version:assessment_versions(
          id,
          assessment:assessments!assessment_versions_assessment_id_fkey(id, title, assessment_type)
        )
      )
    `)
    .eq('student_id', user.id)
    .eq('status', 'released')
    .order('released_at', { ascending: false });

  const parsed: ParsedResult[] = ((results ?? []) as unknown as Array<
    ResultRow & {
      deployment: {
        subject_offering?: {
          subject?: { id: string; code: string; title: string } | null;
          section?: { name: string } | null;
        } | null;
        assessment_version?: {
          assessment?: { id: string; title: string; assessment_type: string } | null;
        } | null;
      } | null;
    }
  >).map((r) => {
    const offering = r.deployment?.subject_offering ?? null;
    const subject = offering?.subject ?? null;
    const section = offering?.section ?? null;
    const assessment = r.deployment?.assessment_version?.assessment ?? null;
    const subjectCode = subject?.code ?? '—';
    const subjectTitle = subject?.title ?? 'Unknown subject';

    return {
      id: r.id,
      attemptId: r.attempt_id,
      rawScore: r.raw_score,
      possibleScore: r.possible_score,
      percentage: Math.round(r.percentage),
      releasedLabel: formatDate(r.released_at ?? r.created_at),
      assessmentId: assessment?.id ?? null,
      assessmentTitle: assessment?.title ?? 'Untitled Assessment',
      assessmentType: formatType(assessment?.assessment_type),
      subjectKey: subject?.id ?? 'unknown',
      subjectLabel: subjectCode
        ? subject?.title
          ? `${subjectCode} - ${subjectTitle}`
          : subjectCode
        : subjectTitle,
      sectionLabel: section?.name ?? null,
    };
  });

  const subjectMap = new Map<string, { label: string; rows: ParsedResult[] }>();
  for (const row of parsed) {
    const existing = subjectMap.get(row.subjectKey);
    if (existing) {
      existing.rows.push(row);
    } else {
      subjectMap.set(row.subjectKey, { label: row.subjectLabel, rows: [row] });
    }
  }

  const subjectGroups = Array.from(subjectMap.values());

  return (
    <div>
      <PageHeader
        title="My Results"
        description="All released exam results, grouped by subject"
      />

      {subjectGroups.length > 0 ? (
        <div className="space-y-4">
          {subjectGroups.map((group) => (
            <CollapsibleSubjectCard
              key={group.label}
              subjectLabel={group.label}
              resultCount={group.rows.length}
              defaultOpen
            >
              <Table caption={`Released results for ${group.label}`}>
                <THead>
                  <TR>
                    <TH>Assessment</TH>
                    <TH>Type</TH>
                    <TH align="right">Score</TH>
                    <TH align="right">Percentage</TH>
                    <TH>Released</TH>
                    <TH align="right">Detail</TH>
                  </TR>
                </THead>
                <TBody>
                  {group.rows.map((r) => {
                    const href = r.assessmentId
                      ? `/student/assessments/${r.assessmentId}/exam/${r.attemptId}/results`
                      : '#';

                    return (
                      <TR key={r.id} className="hover:bg-[var(--color-surface-hover)]">
                        <TD>
                          <Link
                            href={href}
                            className="font-medium text-[var(--color-primary)] hover:underline"
                          >
                            {r.assessmentTitle}
                          </Link>
                          {r.sectionLabel ? (
                            <span className="block text-xs text-[var(--color-muted)]">
                              {r.sectionLabel}
                            </span>
                          ) : null}
                        </TD>
                        <TD className="text-[var(--color-muted)]">{r.assessmentType}</TD>
                        <TD numeric className="text-[var(--color-foreground)]">
                          {r.rawScore}/{r.possibleScore}
                        </TD>
                        <TD>
                          <div className="flex justify-end">
                            <Badge
                              variant={
                                r.percentage >= 75
                                  ? 'success'
                                  : r.percentage >= 50
                                    ? 'warning'
                                    : 'danger'
                              }
                            >
                              {r.percentage}%
                            </Badge>
                          </div>
                        </TD>
                        <TD className="text-xs text-[var(--color-muted)]">
                          {r.releasedLabel}
                        </TD>
                        <TD className="text-right">
                          <Link
                            href={href}
                            className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                          >
                            View
                          </Link>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </CollapsibleSubjectCard>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No results yet"
          description="Your exam results will appear here once released by your instructor."
        />
      )}
    </div>
  );
}
