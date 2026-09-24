import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import Button from '@/components/ui/Button';
import Link from 'next/link';
import AssessmentsTable from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/AssessmentsTable';
import type { AssessmentListRow } from '@/app/(dashboard)/faculty/subjects/[offeringId]/assessments/AssessmentsTable';
import WorkspaceNavSetter from '@/components/layout/WorkspaceNavSetter';

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
  subject_offering_id: string;
  current_version: { id: string; total_items: number; total_points: number } | null;
}

/** Section badge format: `BSIT 2 - NT` (program code · year · section name). */
function sectionLabel(
  section: { name: string } | null,
  program: { code: string } | null,
  yearLevel: { name: string } | null
): string {
  if (!section) return '—';
  const programCode = program?.code?.trim();
  const year = yearLevel?.name?.match(/\d+/)?.[0];
  if (programCode && year) return `${programCode} ${year} - ${section.name}`;
  if (programCode) return `${programCode} - ${section.name}`;
  return section.name;
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

  // Subject-level visibility: list every assessment of this subject, not just
  // those whose home offering is the current section.
  const { data: subjectOfferings } = await supabase
    .from('subject_offerings')
    .select('id')
    .eq('subject_id', o.subject_id);

  const subjectOfferingIds = ((subjectOfferings ?? []) as Array<{ id: string }>).map((x) => x.id);

  const { data: assessments } = subjectOfferingIds.length > 0
    ? await supabase
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
      .in('subject_offering_id', subjectOfferingIds)
      .order('created_at', { ascending: false })
    : { data: [] };

  const sectionByOfferingId = new Map<string, string>();
  const { data: sectionOfferings } = await supabase
    .from('subject_offerings')
    .select('id, section:sections(name, program:programs(code), year_level:year_levels(name))')
    .eq('subject_id', o.subject_id);
  for (const row of ((sectionOfferings ?? []) as unknown as Array<{
    id: string;
    section: {
      name: string;
      program: { code: string } | null;
      year_level: { name: string } | null;
    } | null;
  }>)) {
    sectionByOfferingId.set(row.id, sectionLabel(row.section, row.section?.program ?? null, row.section?.year_level ?? null));
  }

  // Distinct question types per current version (MCQ / ID / TF).
  const versionIds = ((assessments ?? []) as unknown as AssessmentRow[])
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

  const listRows: AssessmentListRow[] = ((assessments ?? []) as unknown as AssessmentRow[]).map((a) => ({
    id: a.id,
    title: a.title,
    assessment_type: a.assessment_type,
    status: a.status,
    created_at: a.created_at,
    total_items: a.current_version?.total_items ?? null,
    total_points: a.current_version?.total_points ?? null,
    section_label: sectionByOfferingId.get(a.subject_offering_id) ?? '—',
    question_types: a.current_version
      ? [...(questionTypesByVersion.get(a.current_version.id) ?? [])]
      : undefined,
    review_href: `/faculty/subjects/${offeringId}/assessments/${a.id}`,
    deploy_href: `/faculty/subjects/${offeringId}/assessments/${a.id}/deploy`,
    show_deploy: true,
  }));

  return (
    <div>
      <WorkspaceNavSetter
        offeringId={offeringId}
        currentPath={`/faculty/subjects/${offeringId}/assessments`}
      />
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

      {listRows.length > 0 ? (
        <AssessmentsTable rows={listRows} />
      ) : (
        <EmptyState
          title="No assessments yet"
          description="Create your first assessment with the button above."
        />
      )}
    </div>
  );
}
