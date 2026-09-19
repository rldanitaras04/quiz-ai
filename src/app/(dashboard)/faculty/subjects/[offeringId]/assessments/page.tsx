import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { ASSESSMENT_STATUS_LABELS } from '@/lib/constants';
import Link from 'next/link';

interface Props {
  params: Promise<{ offeringId: string }>;
}

interface OfferingHeading {
  id: string;
  subject_id: string;
  subject: { id: string; code: string; title: string } | null;
  section: { id: string; name: string } | null;
}

interface AssessmentRow {
  id: string;
  title: string;
  assessment_type: string;
  status: string;
  created_at: string;
  current_version: { id: string; total_items: number; total_points: number } | null;
}

export default async function AssessmentsPage({ params }: Props) {
  const { offeringId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const { data: offering } = await supabase
    .from('subject_offerings')
    .select('id, subject_id, subject:subjects(id, code, title), section:sections(id, name)')
    .eq('id', offeringId)
    .single();

  if (!offering) redirect('/faculty/subjects');

  const o = offering as unknown as OfferingHeading;

  const { data: assessments } = await supabase
    .from('assessments')
    .select(`
      id,
      title,
      assessment_type,
      status,
      created_at,
      current_version:assessment_versions(id, total_items, total_points)
    `)
    .eq('subject_offering_id', offeringId)
    .order('created_at', { ascending: false });

  const statusVariant = (status: string): 'success' | 'warning' | 'info' | 'default' => {
    switch (status) {
      case 'published': return 'success';
      case 'approved': return 'info';
      case 'draft': return 'warning';
      default: return 'default';
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${o.subject?.code} - ${o.subject?.title}`, href: `/faculty/subjects/${offeringId}` },
          { label: 'Assessments' },
        ]}
        title="Assessments"
        description={`${o.subject?.code} - ${o.section?.name}`}
        actions={
          <Link href={`/faculty/subjects/${offeringId}/assessments/new`}>
            <Button variant="primary">New Assessment</Button>
          </Link>
        }
      />

      {assessments && assessments.length > 0 ? (
        <div className="space-y-3">
          {(assessments as unknown as AssessmentRow[]).map((a) => {
            const version = a.current_version;
            return (
              <Card key={a.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium text-[var(--color-foreground)]">{a.title}</h3>
                      <Link
                        href={`/faculty/subjects/${offeringId}/assessments/${a.id}/deploy`}
                        className="text-xs text-[var(--color-primary)] hover:underline"
                      >
                        Deploy →
                      </Link>
                    </div>
                    <p className="text-sm text-[var(--color-muted)]">
                      {a.assessment_type === 'multiple_choice' ? 'Multiple Choice' : 'Identification'}
                      {version ? ` | ${version.total_items} items, ${version.total_points} pts` : ''}
                    </p>
                    <p className="text-xs text-[var(--color-muted-light)]">
                      Created {new Date(a.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={statusVariant(a.status)}>
                    {ASSESSMENT_STATUS_LABELS[a.status as keyof typeof ASSESSMENT_STATUS_LABELS] ?? a.status}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          title="No assessments yet"
          description="Create your first assessment with the button above."
        />
      )}
    </div>
  );
}
