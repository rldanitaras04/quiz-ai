'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import {
  canManageProctors,
  isFacultyOfOfferingOrSubject,
  isSuperAdmin,
} from '@/lib/auth';
import { getOfferingNotificationContext, notifyUser } from '@/lib/notifications';

/**
 * Proctor assignment management (scope §42).
 *
 * Every action: caller session → deployment context resolved → explicit
 * authorization (faculty of the offering/subject, or super administrator) →
 * mutation through the service-role client (exam_proctors has no write
 * policies, so the browser can never insert assignment rows itself) → audit
 * log + a `proctor_assigned` notification deep-linking the new proctor to the
 * live monitor.
 *
 * These actions power both the monitor's "Proctors" card and the admin
 * management section on `/faculty/proctoring`.
 */

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

type ManageContext =
  | { error: string }
  | { context: { deploymentId: string; offeringId: string; assessmentId: string } };

/**
 * Resolve the deployment and prove the caller may manage proctors on it.
 *
 * Super administrators read the row through the service-role client (RLS
 * grants them no deployment read); everyone else goes through the session
 * client so RLS narrows the lookup first, and the explicit faculty check
 * then rejects proctors who can *see* a deployment but not administer it.
 */
async function loadManageContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  deploymentId: string
): Promise<ManageContext> {
  const adminUser = await isSuperAdmin(supabase, userId);
  const client = adminUser ? createAdminClient() : supabase;

  const { data: deployment } = await client
    .from('assessment_deployments')
    .select('id, subject_offering_id, assessment_id')
    .eq('id', deploymentId)
    .maybeSingle();

  if (!deployment) return { error: 'Deployment not found' };

  if (
    !adminUser &&
    !(await isFacultyOfOfferingOrSubject(
      supabase,
      userId,
      deployment.subject_offering_id
    ))
  ) {
    return { error: 'Not authorized to manage proctors for this exam' };
  }

  return {
    context: {
      deploymentId: deployment.id,
      offeringId: deployment.subject_offering_id,
      assessmentId: deployment.assessment_id,
    },
  };
}

export interface ProctorCandidate {
  id: string;
  full_name: string;
  email: string;
  role: 'faculty' | 'admin';
}

export interface ProctorRowInfo {
  id: string;
  proctor_id: string;
  full_name: string;
  email: string;
  created_at: string;
}

export interface DeploymentTarget {
  deploymentId: string;
  status: string;
  opensAt: string | null;
  closesAt: string | null;
  assessmentId: string;
  assessmentTitle: string;
  offeringId: string;
  subjectLabel: string;
  sectionName: string | null;
}

export async function assignProctor(input: {
  deploymentId: string;
  proctorUserId: string;
}): Promise<{ success: boolean; error?: string; already?: boolean }> {
  try {
    if (!input?.deploymentId || !input?.proctorUserId) {
      return { success: false, error: 'Missing exam or faculty member' };
    }

    const { supabase, userId } = await requireUser();
    const loaded = await loadManageContext(supabase, userId, input.deploymentId);
    if ('error' in loaded) return { success: false, error: loaded.error };
    const { offeringId, assessmentId } = loaded.context;

    const admin = createAdminClient();

    // A proctor must be an active faculty member or administrator (§42).
    const [profileResult, rolesResult] = await Promise.all([
      admin
        .from('profiles')
        .select('id, full_name, email, status')
        .eq('id', input.proctorUserId)
        .maybeSingle(),
      admin
        .from('user_roles')
        .select('role')
        .eq('user_id', input.proctorUserId)
        .in('role', ['faculty', 'super_admin']),
    ]);
    const profile = profileResult.data;
    const roles = rolesResult.data ?? [];

    if (!profile || profile.status !== 'active') {
      return { success: false, error: 'That user is not an active account' };
    }
    if (roles.length === 0) {
      return {
        success: false,
        error: 'Proctors must be faculty members or administrators',
      };
    }

    const { data: existing } = await admin
      .from('exam_proctors')
      .select('id')
      .eq('deployment_id', input.deploymentId)
      .eq('proctor_id', input.proctorUserId)
      .maybeSingle();

    if (existing) {
      return {
        success: false,
        error: 'That user is already a proctor for this exam',
        already: true,
      };
    }

    const { data: row, error: insertError } = await admin
      .from('exam_proctors')
      .insert({
        deployment_id: input.deploymentId,
        proctor_id: input.proctorUserId,
        granted_by: userId,
      })
      .select('id')
      .maybeSingle();

    if (insertError || !row) {
      return {
        success: false,
        error: insertError?.message ?? 'Could not assign the proctor',
      };
    }

    await recordAuditLog({
      actorUserId: userId,
      action: 'create',
      entityType: 'exam_proctor',
      entityId: row.id,
      metadata: {
        deployment_id: input.deploymentId,
        subject_offering_id: offeringId,
        assessment_id: assessmentId,
        proctor_id: input.proctorUserId,
        granted_by: userId,
      },
    });

    // Best-effort: the assignment already committed.
    const [contextInfo, assessmentResult] = await Promise.all([
      getOfferingNotificationContext(offeringId),
      admin.from('assessments').select('title').eq('id', assessmentId).maybeSingle(),
    ]);
    const assessmentTitle = assessmentResult.data?.title ?? 'An examination';
    const subjectPrefix = contextInfo.subjectLabel
      ? contextInfo.sectionName
        ? `${contextInfo.subjectLabel} (${contextInfo.sectionName})`
        : contextInfo.subjectLabel
      : null;

    await notifyUser({
      userId: input.proctorUserId,
      type: 'proctor_assigned',
      title: 'You were assigned as a proctor',
      body: subjectPrefix
        ? `${subjectPrefix} — ${assessmentTitle}: you can now open the live exam monitor.`
        : `${assessmentTitle}: you can now open the live exam monitor.`,
      data: {
        proctor: true,
        subject_offering_id: offeringId,
        assessment_id: assessmentId,
        deployment_id: input.deploymentId,
        subject_label: contextInfo.subjectLabel,
        section_name: contextInfo.sectionName,
      },
    });

    revalidatePath(
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}/monitor`
    );
    revalidatePath('/faculty/proctoring');
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unexpected error' };
  }
}

export async function removeProctor(input: {
  deploymentId: string;
  proctorUserId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!input?.deploymentId || !input?.proctorUserId) {
      return { success: false, error: 'Missing exam or proctor' };
    }

    const { supabase, userId } = await requireUser();
    const loaded = await loadManageContext(supabase, userId, input.deploymentId);
    if ('error' in loaded) return { success: false, error: loaded.error };
    const { offeringId, assessmentId } = loaded.context;

    const admin = createAdminClient();
    const { data: removed, error: deleteError } = await admin
      .from('exam_proctors')
      .delete()
      .eq('deployment_id', input.deploymentId)
      .eq('proctor_id', input.proctorUserId)
      .select('id');

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }
    if (!removed || removed.length === 0) {
      return { success: false, error: 'That user is not a proctor for this exam' };
    }

    await recordAuditLog({
      actorUserId: userId,
      action: 'delete',
      entityType: 'exam_proctor',
      entityId: removed[0].id,
      metadata: {
        deployment_id: input.deploymentId,
        subject_offering_id: offeringId,
        assessment_id: assessmentId,
        proctor_id: input.proctorUserId,
      },
    });

    revalidatePath(
      `/faculty/subjects/${offeringId}/assessments/${assessmentId}/monitor`
    );
    revalidatePath('/faculty/proctoring');
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unexpected error' };
  }
}

/** Current proctors on a deployment (names/emails resolved via service role). */
export async function listProctors(deploymentId: string): Promise<{
  proctors?: ProctorRowInfo[];
  error?: string;
}> {
  try {
    if (!deploymentId) return { error: 'Missing exam' };

    const { supabase, userId } = await requireUser();
    const loaded = await loadManageContext(supabase, userId, deploymentId);
    if ('error' in loaded) return { error: loaded.error };

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('exam_proctors')
      .select(
        'id, proctor_id, created_at, proctor:profiles!exam_proctors_proctor_id_fkey(full_name, email)'
      )
      .eq('deployment_id', deploymentId)
      .order('created_at', { ascending: true });

    if (error) return { error: error.message };

    const rows = (data ?? []) as unknown as {
      id: string;
      proctor_id: string;
      created_at: string;
      proctor: { full_name: string | null; email: string | null } | null;
    }[];

    return {
      proctors: rows.map((r) => ({
        id: r.id,
        proctor_id: r.proctor_id,
        full_name: r.proctor?.full_name || r.proctor?.email || 'Unknown user',
        email: r.proctor?.email ?? '',
        created_at: r.created_at,
      })),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unexpected error' };
  }
}

/**
 * Everyone who may be assigned as a proctor: active faculty plus super
 * administrators (§42). Requires an offering the caller can manage proctors
 * for; the faculty directory itself is read with the service role.
 */
export async function listProctorCandidates(input: {
  offeringId: string;
}): Promise<{ candidates?: ProctorCandidate[]; error?: string }> {
  try {
    if (!input?.offeringId) return { error: 'Missing offering' };

    const { supabase, userId } = await requireUser();
    if (!(await canManageProctors(supabase, userId, input.offeringId))) {
      return { error: 'Not authorized to manage proctors for this exam' };
    }

    const admin = createAdminClient();
    const [facultyResult, adminResult] = await Promise.all([
      admin.from('user_roles').select('user_id').eq('role', 'faculty'),
      admin.from('user_roles').select('user_id').eq('role', 'super_admin'),
    ]);

    const facultyIds = new Set(
      (facultyResult.data ?? []).map((r) => r.user_id as string)
    );
    const adminIds = new Set(
      (adminResult.data ?? []).map((r) => r.user_id as string)
    );
    const ids = [...new Set([...facultyIds, ...adminIds])].filter(Boolean);
    if (ids.length === 0) return { candidates: [] };

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name, email, status')
      .in('id', ids);

    const candidates = (profiles ?? [])
      .filter((p) => p.status === 'active')
      .map((p) => ({
        id: p.id,
        full_name: p.full_name || p.email || 'Unknown user',
        email: p.email ?? '',
        role: (adminIds.has(p.id) ? 'admin' : 'faculty') as 'faculty' | 'admin',
      }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    return { candidates };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unexpected error' };
  }
}

/**
 * Deployments the caller may assign proctors to: their own offerings'
 * sittings (session client, RLS-scoped) or — for a super administrator —
 * every recent sitting (service role). Used by the management card on
 * `/faculty/proctoring`.
 */
export async function listDeploymentTargets(): Promise<{
  targets?: DeploymentTarget[];
  error?: string;
}> {
  try {
    const { supabase, userId } = await requireUser();

    const adminUser = await isSuperAdmin(supabase, userId);
    if (!adminUser) {
      const { data: anyAssignment } = await supabase
        .from('faculty_assignments')
        .select('id')
        .limit(1)
        .maybeSingle();
      if (!anyAssignment) return { error: 'Not authorized' };
    }

    const client = adminUser ? createAdminClient() : supabase;
    const { data, error } = await client
      .from('assessment_deployments')
      .select(
        'id, status, opens_at, closes_at, assessment:assessments!inner(id, title), offering:subject_offerings!inner(id, subject:subjects(id, code, title), section:sections(id, name))'
      )
      .order('opens_at', { ascending: false })
      .limit(50);

    if (error) return { error: error.message };

    type Raw = {
      id: string;
      status: string;
      opens_at: string | null;
      closes_at: string | null;
      assessment: { id: string; title: string };
      offering: {
        id: string;
        subject: { id: string; code: string | null; title: string } | null;
        section: { id: string; name: string } | null;
      };
    };

    const targets = ((data ?? []) as unknown as Raw[]).map((d) => {
      const subject = d.offering?.subject ?? null;
      return {
        deploymentId: d.id,
        status: d.status,
        opensAt: d.opens_at,
        closesAt: d.closes_at,
        assessmentId: d.assessment.id,
        assessmentTitle: d.assessment.title,
        offeringId: d.offering.id,
        subjectLabel: subject
          ? subject.code
            ? `${subject.code} — ${subject.title}`
            : subject.title
          : 'Unknown subject',
        sectionName: d.offering?.section?.name ?? null,
      };
    });

    return { targets };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unexpected error' };
  }
}
