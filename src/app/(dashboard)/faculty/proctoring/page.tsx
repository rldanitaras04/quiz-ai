import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { isSuperAdmin } from '@/lib/auth';
import PageHeader from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import Badge from '@/components/ui/Badge';
import ProctoringManageClient from './ProctoringManageClient';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<Record<string, string>>;
}

/**
 * "Exams I'm proctoring" (scope §42): every deployment the signed-in user is
 * assigned to, plus — for offering faculty and administrators — the assignment
 * management card. All reads go through the session client, so RLS narrows the
 * list to the caller's own proctor rows (and their own offerings' sittings).
 */
export default async function ProctoringPage({ params }: Props) {
  await params;
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect('/login');

  const [{ data: rows }, admin] = await Promise.all([
    supabase
      .from('exam_proctors')
      .select(
        'id, deployment_id, created_at, deployment:assessment_deployments(id, status, opens_at, closes_at, assessment_id, subject_offering_id, assessment:assessments(id, title), offering:subject_offerings(id, subject:subjects(id, code, title), section:sections(id, name)))'
      )
      .eq('proctor_id', user.id)
      .order('created_at', { ascending: false }),
    isSuperAdmin(supabase, user.id),
  ]);

  interface ProctorListRow {
    id: string;
    deployment_id: string;
    created_at: string;
    deployment: {
      id: string;
      status: string;
      opens_at: string | null;
      closes_at: string | null;
      assessment_id: string;
      subject_offering_id: string;
      assessment: { id: string; title: string } | null;
      offering: {
        id: string;
        subject: { id: string; code: string | null; title: string } | null;
        section: { id: string; name: string } | null;
      } | null;
    } | null;
  }

  const list = ((rows ?? []) as unknown as ProctorListRow[]).filter(
    (r) => r.deployment && r.deployment.assessment && r.deployment.offering
  );

  // Management card: super administrators always; faculty when they hold any
  // offering assignment (listDeploymentTargets then RLS-scopes their sittings).
  let canManage = admin;
  if (!canManage) {
    const { data: anyAssignment } = await supabase
      .from('faculty_assignments')
      .select('id')
      .limit(1)
      .maybeSingle();
    canManage = Boolean(anyAssignment);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: 'Faculty', href: '/faculty' },
          { label: 'Proctoring' },
        ]}
        title="Proctoring"
        description="Exams you are assigned to supervise, with access to their live monitors (scope §42)."
      />

      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">My proctored exams</h2>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <EmptyState
              title="No exams assigned yet"
              description="When a faculty member or administrator assigns you as a proctor, the exam appears here with a link to its live monitor."
            />
          ) : (
            <ul className="space-y-2">
              {list.map((r) => {
                const d = r.deployment!;
                const subject = d.offering!.subject;
                const section = d.offering!.section;
                const subjectLabel = subject
                  ? subject.code
                    ? `${subject.code} — ${subject.title}`
                    : subject.title
                  : 'Unknown subject';
                const href = `/faculty/subjects/${d.subject_offering_id}/assessments/${d.assessment_id}/monitor`;

                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {d.assessment!.title}
                        </span>
                        <Badge
                          variant={
                            d.status === 'active'
                              ? 'success'
                              : d.status === 'scheduled'
                                ? 'info'
                                : 'default'
                          }
                        >
                          {d.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {subjectLabel}
                        {section ? ` · ${section.name}` : ''}
                        {d.opens_at
                          ? ` · opens ${new Date(d.opens_at).toLocaleString()}`
                          : ''}
                      </div>
                    </div>
                    <Link href={href} className="text-sm font-medium text-[var(--color-primary)] hover:underline">
                      Open live monitor →
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {canManage && <ProctoringManageClient />}
    </div>
  );
}
