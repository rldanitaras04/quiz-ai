import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { ASSESSMENT_STATUS_LABELS } from '@/lib/constants';

interface Props {
  params: Promise<{ subjectId: string }>;
}

interface SubjectInfo {
  id: string;
  code: string;
  title: string;
}

interface OfferingInfo {
  id: string;
  section: { name: string } | null;
  semester: { name: string } | null;
}

interface AssessmentRow {
  id: string;
  title: string;
  assessment_type: string;
  status: string;
  created_at: string;
  subject_offering_id: string;
  current_version: { id: string; total_items: number; total_points: number } | null;
}

export default async function SubjectAssessmentsPage({ params }: Props) {
  const { subjectId } = await params;
  const supabase = await createClient();

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  // Get subject info
  const { data: subject } = await supabase
    .from('subjects')
    .select('id, code, title')
    .eq('id', subjectId)
    .single();

  if (!subject) notFound();

  const s = subject as SubjectInfo;

  // Get all offerings for this subject that the faculty is assigned to
  const { data: offerings } = await supabase
    .from('subject_offerings')
    .select(`
      id,
      section:sections(name),
      semester:semesters(name)
    `)
    .eq('subject_id', subjectId)
    .eq('status', 'active');

  const offeringList = (offerings ?? []) as unknown as OfferingInfo[];
  const offeringIds = offeringList.map((o) => o.id);

  if (offeringIds.length === 0) {
    return (
      <div>
        <PageHeader
          breadcrumbs={[
            { label: 'Faculty', href: '/faculty' },
            { label: 'My Subjects', href: '/faculty/subjects' },
            { label: `${s.code} - ${s.title}` },
          ]}
          title={`${s.code} - ${s.title}`}
          description="No active offerings found"
        />
        <EmptyState
          title="No active offerings"
          description="You don't have any active sections for this subject."
        />
      </div>
    );
  }

  // Get all assessments across all offerings of this subject
  const { data: assessments } = await supabase
    .from('assessments')
    .select(`
      id,
      title,
      assessment_type,
      status,
      created_at,
      subject_offering_id,
      current_version:assessment_versions(id, total_items, total_points)
    `)
    .in('subject_offering_id', offeringIds)
    .order('created_at', { ascending: false });

  const assessmentRows = (assessments ?? []) as unknown as AssessmentRow[];

  // Group assessments by title to show cross-section assessments
  const assessmentMap = new Map<string, {
    id: string;
    title: string;
    assessment_type: string;
    status: string;
    created_at: string;
    offeringIds: string[];
    version: { id: string; total_items: number; total_points: number } | null;
  }>();

  for (const assessment of assessmentRows) {
    const key = assessment.title;
    if (!assessmentMap.has(key)) {
      assessmentMap.set(key, {
        id: assessment.id,
        title: assessment.title,
        assessment_type: assessment.assessment_type,
        status: assessment.status,
        created_at: assessment.created_at,
        offeringIds: [],
        version: assessment.current_version,
      });
    }
    assessmentMap.get(key)!.offeringIds.push(assessment.subject_offering_id);
  }

  const uniqueAssessments = Array.from(assessmentMap.values());

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
          { label: `${s.code} - ${s.title}` },
        ]}
        title={`${s.code} - ${s.title}`}
        description={`${offeringList.length} section${offeringList.length !== 1 ? 's' : ''}: ${offeringList.map(o => o.section?.name ?? '—').join(', ')}`}
        actions={
          <Link href={`/faculty/subjects/subject/${subjectId}/assessments/new`}>
            <Button variant="primary">New Assessment</Button>
          </Link>
        }
      />

      {/* Sections Overview */}
      <Card className="mb-6">
        <CardHeader>
          <h3 className="text-base font-semibold text-foreground">Sections</h3>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {offeringList.map((offering) => (
              <Badge key={offering.id} variant="default">
                {offering.section?.name ?? '—'} · {offering.semester?.name ?? '—'}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Assessments */}
      {uniqueAssessments.length > 0 ? (
        <Card>
          <CardHeader>
            <h3 className="text-base font-semibold text-foreground">
              Assessments ({uniqueAssessments.length})
            </h3>
          </CardHeader>
          <Table caption="Assessments for this subject">
            <THead>
              <TR>
                <TH>Assessment</TH>
                <TH>Type</TH>
                <TH align="right">Items</TH>
                <TH align="right">Points</TH>
                <TH>Sections</TH>
                <TH>Created</TH>
                <TH>Status</TH>
                <TH align="right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {uniqueAssessments.map((assessment) => (
                <TR key={assessment.id} className="hover:bg-[var(--color-surface-hover)]">
                  <TD className="font-medium">
                    <Link
                      href={`/faculty/subjects/subject/${subjectId}/assessments/${assessment.id}`}
                      className="text-[var(--color-foreground)] hover:text-[var(--color-primary)] hover:underline"
                    >
                      {assessment.title}
                    </Link>
                  </TD>
                  <TD className="text-[var(--color-muted)]">
                    {assessment.assessment_type === 'multiple_choice' ? 'MCQ' : 'ID'}
                  </TD>
                  <TD numeric className="text-[var(--color-foreground)]">
                    {assessment.version?.total_items ?? '—'}
                  </TD>
                  <TD numeric className="text-[var(--color-foreground)]">
                    {assessment.version?.total_points ?? '—'}
                  </TD>
                  <TD>
                    <Badge variant="info">
                      {assessment.offeringIds.length} section{assessment.offeringIds.length !== 1 ? 's' : ''}
                    </Badge>
                  </TD>
                  <TD className="text-xs text-[var(--color-muted)]">
                    {new Date(assessment.created_at).toLocaleDateString()}
                  </TD>
                  <TD>
                    <Badge variant={statusVariant(assessment.status)}>
                      {ASSESSMENT_STATUS_LABELS[assessment.status as keyof typeof ASSESSMENT_STATUS_LABELS] ?? assessment.status}
                    </Badge>
                  </TD>
                  <TD className="whitespace-nowrap text-right">
                    <Link
                      href={`/faculty/subjects/subject/${subjectId}/assessments/${assessment.id}`}
                      className="text-sm font-medium text-[var(--color-primary)] hover:underline"
                    >
                      Review
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : (
        <EmptyState
          title="No assessments yet"
          description="Create your first assessment for this subject using the button above."
        />
      )}
    </div>
  );
}
