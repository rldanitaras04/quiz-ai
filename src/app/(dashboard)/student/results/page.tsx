import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
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
        <div className="space-y-3">
          {results.map((r) => {
            const deployment = r.deployment as unknown as Record<string, unknown> | undefined;
            const assessmentVersion = deployment?.assessment_version as Record<string, unknown> | undefined;
            const assessment = assessmentVersion?.assessment as Record<string, unknown> | undefined;
            const percentage = Math.round(r.percentage);

            return (
              <Link key={r.id as string} href={`/student/assessments/${assessment?.id as string}/exam/${r.attempt_id as string}/results`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardContent className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-[var(--color-foreground)]">
                        {(assessment?.title as string) ?? 'Untitled Assessment'}
                      </p>
                      <p className="text-sm text-[var(--color-muted)]">
                        Score: {r.raw_score as number}/{r.possible_score as number}
                        {assessment?.assessment_type === 'multiple_choice' ? ' \u00B7 Multiple Choice' : ' \u00B7 Identification'}
                      </p>
                      <p className="text-xs text-[var(--color-muted-light)]">
                        Released {r.released_at ? new Date(r.released_at as string).toLocaleDateString() : new Date(r.created_at as string).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant={percentage >= 75 ? 'success' : percentage >= 50 ? 'warning' : 'danger'}>
                      {percentage}%
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
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
