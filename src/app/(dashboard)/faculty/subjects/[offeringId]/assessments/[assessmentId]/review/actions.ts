'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditLog } from '@/lib/audit';
import { isFacultyOfOffering } from '@/lib/auth';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

export interface IdentificationReviewItem {
  response_id: string;
  attempt_id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  question_id: string;
  question_text: string;
  text_answer: string;
  normalized_answer: string | null;
  canonical_answer: string;
  accepted_answers: string[];
  earned_points: number | null;
  max_points: number;
  scoring_status: string;
  assessment_title: string;
}

export async function getIdentificationResponsesNeedingReview(
  assessmentId: string
): Promise<{ data: IdentificationReviewItem[] | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: assessment } = await supabase
    .from('assessments')
    .select('id, title, subject_offering_id')
    .eq('id', assessmentId)
    .single();

  if (!assessment) return { data: null, error: 'Assessment not found' };
  if (!(await isFacultyOfOffering(supabase, userId, assessment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  const admin = createAdminClient();

  const { data: versions } = await admin
    .from('assessment_versions')
    .select('id')
    .eq('assessment_id', assessmentId);

  const versionIds = (versions ?? []).map(v => v.id);
  if (versionIds.length === 0) return { data: [] };

  const { data: questions } = await admin
    .from('questions')
    .select('id, question_text, points')
    .in('assessment_version_id', versionIds)
    .eq('question_type', 'identification');

  const questionIds = (questions ?? []).map(q => q.id);
  if (questionIds.length === 0) return { data: [] };

  const { data: answerKeys } = await admin
    .from('answer_keys')
    .select('question_id, canonical_answer, accepted_answers')
    .in('question_id', questionIds);

  const answerKeyMap = new Map((answerKeys ?? []).map(ak => [ak.question_id, ak]));

  const { data: responses } = await admin
    .from('student_responses')
    .select('id, attempt_id, question_id, text_answer, normalized_answer, earned_points, scoring_status')
    .in('question_id', questionIds)
    .not('text_answer', 'is', null)
    .neq('text_answer', '');

  if (!responses || responses.length === 0) return { data: [] };

  const attemptIds = [...new Set(responses.map(r => r.attempt_id))];
  const { data: attempts } = await admin
    .from('exam_attempts')
    .select('id, student_id, status')
    .in('id', attemptIds);

  const attemptMap = new Map((attempts ?? []).map(a => [a.id, a]));

  const studentIds = [...new Set((attempts ?? []).map(a => a.student_id))];
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name, email')
    .in('id', studentIds);

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));
  const questionMap = new Map((questions ?? []).map(q => [q.id, q]));

  const result: IdentificationReviewItem[] = responses
    .filter(r => {
      const a = attemptMap.get(r.attempt_id);
      return a && (a.status === 'submitted' || a.status === 'auto_submitted');
    })
    .map(r => {
      const a = attemptMap.get(r.attempt_id)!;
      const q = questionMap.get(r.question_id);
      const ak = answerKeyMap.get(r.question_id);
      const p = profileMap.get(a.student_id);
      return {
        response_id: r.id,
        attempt_id: r.attempt_id,
        student_id: a.student_id,
        student_name: p?.full_name ?? 'Unknown',
        student_email: p?.email ?? '',
        question_id: r.question_id,
        question_text: q?.question_text ?? '',
        text_answer: r.text_answer ?? '',
        normalized_answer: r.normalized_answer,
        canonical_answer: ak?.canonical_answer ?? '',
        accepted_answers: ak?.accepted_answers ?? [],
        earned_points: r.earned_points,
        max_points: q?.points ?? 1,
        scoring_status: r.scoring_status,
        assessment_title: assessment.title,
      };
    })
    .filter(item => item.earned_points === 0 || item.scoring_status === 'pending' || item.scoring_status === 'manual_review');

  return { data: result };
}

export async function scoreIdentificationResponse(
  responseId: string,
  earnedPoints: number,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, userId } = await requireUser();
  const admin = createAdminClient();

  const { data: response } = await admin
    .from('student_responses')
    .select('id, attempt_id, question_id')
    .eq('id', responseId)
    .single();

  if (!response) return { success: false, error: 'Response not found' };

  const { data: attempt } = await admin
    .from('exam_attempts')
    .select('deployment_id')
    .eq('id', response.attempt_id)
    .single();

  if (!attempt) return { success: false, error: 'Attempt not found' };

  const { data: deployment } = await admin
    .from('assessment_deployments')
    .select('subject_offering_id')
    .eq('id', attempt.deployment_id)
    .single();

  if (!deployment) return { success: false, error: 'Deployment not found' };
  if (!(await isFacultyOfOffering(supabase, userId, deployment.subject_offering_id))) {
    return { success: false, error: 'Not authorized' };
  }

  const { data: question } = await admin
    .from('questions')
    .select('points')
    .eq('id', response.question_id)
    .single();

  if (!question) return { success: false, error: 'Question not found' };

  const clampedPoints = Math.max(0, Math.min(earnedPoints, question.points));

  const { error: updateErr } = await admin
    .from('student_responses')
    .update({
      earned_points: clampedPoints,
      scoring_status: 'scored',
      scored_at: new Date().toISOString(),
      scored_by: userId,
    })
    .eq('id', responseId);

  if (updateErr) return { success: false, error: updateErr.message };

  await recordAuditLog({
    actorUserId: userId,
    action: 'score',
    entityType: 'student_response',
    entityId: responseId,
    metadata: {
      question_id: response.question_id,
      attempt_id: response.attempt_id,
      earned_points: clampedPoints,
      max_points: question.points,
    },
  });

  return { success: true };
}
