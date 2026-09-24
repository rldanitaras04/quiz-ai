import { redirect, notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import AssessmentsTable from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/AssessmentsTable';
import type { AssessmentListRow } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/AssessmentsTable';

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
  section: {
    name: string;
    program: { code: string } | null;
    year_level: { name: string } | null;
  } | null;
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

/** Section badge format: `BSIT 2 - NT` (program code · year · section name). */
function sectionLabel(
  section: {
    name: string;
    program: { code: string } | null;
    year_level: { name: string } | null;
  } | null
): string {
  if (!section) return '—';
  const programCode = section.program?.code?.trim();
  const year = section.year_level?.name?.match(/\d+/)?.[0];
  if (programCode && year) return `${programCode} ${year} - ${section.name}`;
  if (programCode) return `${programCode} - ${section.name}`;
  return section.name;
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
      section:sections(name, program:programs(code), year_level:year_levels(name)),
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
      current_version:assessment_versions!assessments_current_version_id_fkey(id, total_items, total_points)
    `)
    .in('subject_offering_id', offeringIds)
    .order('created_at', { ascending: false });

  const assessmentRows = (assessments ?? []) as unknown as AssessmentRow[];

  // Distinct question types per current version (MCQ / ID / TF).
  const versionIds = assessmentRows
    .map((a) => a.current_version?.id)
    .filter((id): id is string => Boolean(id));
  const questionTypesByVersion = new Map<string, Set<string>>();
  if (versionIds.length > 0) {
    const { data: questionRows } = await supabase
      .from('questions')
      .select('assessment_version_id, question_type')
      .in('assessment_version_id', versionIds);
    for (const q of ((questionRows ?? []) as unknown as Array<{ assessment_version_id: string; question_type: string }>)) {
      const set = questionTypesByVersion.get(q.assessment_version_id) ?? new Set<string>();
      set.add(q.question_type);
      questionTypesByVersion.set(q.assessment_version_id, set);
    }
  }

  // List every assessment (do not collapse by title — separate drafts can share a title).
  const offeringSectionById = new Map(offeringList.map((o) => [o.id, sectionLabel(o.section)]));
  const uniqueAssessments = assessmentRows.map((assessment) => ({
    id: assessment.id,
    title: assessment.title,
    assessment_type: assessment.assessment_type,
    status: assessment.status,
    created_at: assessment.created_at,
    offeringIds: [assessment.subject_offering_id],
    sectionLabel: offeringSectionById.get(assessment.subject_offering_id) ?? '—',
    version: assessment.current_version,
    questionTypes: assessment.current_version
      ? [...(questionTypesByVersion.get(assessment.current_version.id) ?? [])]
      : undefined,
  }));

  const listRows: AssessmentListRow[] = uniqueAssessments.map((assessment) => ({
    id: assessment.id,
    title: assessment.title,
    assessment_type: assessment.assessment_type,
    status: assessment.status,
    created_at: assessment.created_at,
    total_items: assessment.version?.total_items ?? null,
    total_points: assessment.version?.total_points ?? null,
    section_label: assessment.sectionLabel,
    question_types: assessment.questionTypes,
    review_href: `/faculty/subjects/subject/${subjectId}/assessments/${assessment.id}`,
    deploy_href: `/faculty/subjects/subject/${subjectId}/assessments/${assessment.id}/deploy`,
    show_deploy: true,
    single_redirect_to: `/faculty/subjects/subject/${subjectId}`,
  }));

  return (
    <div>
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'My Subjects', href: '/faculty/subjects' },
          { label: `${s.code} - ${s.title}` },
        ]}
        title={`${s.code} - ${s.title}`}
        description={`${offeringList.length} section${offeringList.length !== 1 ? 's' : ''}: ${offeringList.map(o => sectionLabel(o.section)).join(', ')}`}
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
                {sectionLabel(offering.section)} · {offering.semester?.name ?? '—'}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Assessments */}
      {listRows.length > 0 ? (
        <AssessmentsTable rows={listRows} />
      ) : (
        <EmptyState
          title="No assessments yet"
          description="Create your first assessment for this subject using the button above."
        />
      )}
    </div>
  );
}
