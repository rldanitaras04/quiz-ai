import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { ASSESSMENT_STATUS_LABELS } from '@/lib/constants';
import Link from 'next/link';

interface Props {
  params: Promise<{ offeringId: string }>;
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

  const o = offering as any;

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
    .eq('subject_id', o.subject_id)
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
      />

      {assessments && assessments.length > 0 ? (
        <div className="space-y-3">
          {assessments.map((a: any) => {
            const version = a.current_version;
            return (
              <Card key={a.id}>
                <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium text-[var(--color-foreground)]">{a.title}</h3>
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
          description="Create your first assessment for this subject."
        />
      )}
    </div>
  );
}
