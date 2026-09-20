import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import Link from 'next/link';

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
        assessment_version:assessment_versions(
          id,
          assessment:assessments(id, title, assessment_type)
        )
      )
    `)
    .eq('student_id', user.id)
    .eq('status', 'released')
    .order('released_at', { ascending: false });

  return (
    <div>
      <PageHeader
        title="My Results"
        description="All released exam results"
      />

      {results && results.length > 0 ? (
        <Card>
          <Table caption="Your released exam results">
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
              {results.map((r) => {
                const deployment = r.deployment as unknown as Record<string, unknown> | undefined;
                const assessmentVersion = deployment?.assessment_version as Record<string, unknown> | undefined;
                const assessment = assessmentVersion?.assessment as Record<string, unknown> | undefined;
                const percentage = Math.round(r.percentage);
                const href = `/student/assessments/${assessment?.id as string}/exam/${r.attempt_id as string}/results`;

                return (
                  <TR key={r.id as string} className="hover:bg-[var(--color-surface-hover)]">
                    <TD>
                      <Link
                        href={href}
                        className="font-medium text-[var(--color-primary)] hover:underline"
                      >
                        {(assessment?.title as string) ?? 'Untitled Assessment'}
                      </Link>
                    </TD>
                    <TD className="text-[var(--color-muted)]">
                      {assessment?.assessment_type === 'multiple_choice'
                        ? 'Multiple Choice'
                        : 'Identification'}
                    </TD>
                    <TD numeric className="text-[var(--color-foreground)]">
                      {r.raw_score as number}/{r.possible_score as number}
                    </TD>
                    <TD>
                      <div className="flex justify-end">
                        <Badge variant={percentage >= 75 ? 'success' : percentage >= 50 ? 'warning' : 'danger'}>
                          {percentage}%
                        </Badge>
                      </div>
                    </TD>
                    <TD className="text-xs text-[var(--color-muted)]">
                      {r.released_at
                        ? new Date(r.released_at as string).toLocaleDateString()
                        : new Date(r.created_at as string).toLocaleDateString()}
                    </TD>
                    <TD className="text-right">
                      <Link href={href} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
                        View
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No results yet"
          description="Your exam results will appear here once released by your instructor."
        />
      )}
    </div>
  );
}
