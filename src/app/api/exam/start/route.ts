import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { ExamManifest, QuestionWithChoices } from '@/lib/types';

function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { deploymentId } = await request.json();

    const { data: deployment, error: deploymentError } = await supabase
      .from('assessment_deployments')
      .select('*')
      .eq('id', deploymentId)
      .single();

    if (deploymentError || !deployment) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }

    const now = new Date();
    const opensAt = new Date(deployment.opens_at);
    const closesAt = new Date(deployment.closes_at);

    if (now < opensAt || now > closesAt) {
      return NextResponse.json({ error: 'Assessment is not currently available' }, { status: 403 });
    }

    if (deployment.requires_identity_verification) {
      const { data: studentProfile } = await supabase
        .from('student_profiles')
        .select('verification_status')
        .eq('user_id', user.id)
        .single();

      if (!studentProfile || studentProfile.verification_status !== 'verified') {
        return NextResponse.json({ error: 'Identity verification required' }, { status: 403 });
      }
    }

    const { data: enrollment } = await supabase
      .from('enrollments')
      .select('id')
      .eq('subject_offering_id', deployment.subject_offering_id)
      .eq('student_id', user.id)
      .eq('status', 'enrolled')
      .single();

    if (!enrollment) {
      return NextResponse.json({ error: 'Not enrolled in this subject' }, { status: 403 });
    }

    const { data: existingAttempts, count: attemptCount } = await supabase
      .from('exam_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('deployment_id', deploymentId)
      .eq('student_id', user.id)
      .in('status', ['created', 'in_progress', 'submitted', 'auto_submitted']);

    if (attemptCount !== null && attemptCount >= deployment.attempt_limit) {
      return NextResponse.json({ error: 'Attempt limit reached' }, { status: 403 });
    }

    const { data: questions, error: questionsError } = await supabase
      .from('questions')
      .select('*, question_choices(*)')
      .eq('assessment_version_id', deployment.assessment_version_id)
      .eq('status', 'approved');

    if (questionsError || !questions || questions.length === 0) {
      return NextResponse.json({ error: 'No questions available' }, { status: 404 });
    }

    let orderedQuestions: QuestionWithChoices[] = [...questions];
    if (deployment.question_order_mode === 'shuffled') {
      orderedQuestions = shuffleArray(orderedQuestions);
    }

    const questionOrder = orderedQuestions.map((q) => q.id);
    const choiceOrder: Record<string, string[]> = {};

    for (const question of orderedQuestions) {
      if (deployment.choice_order_mode === 'shuffled') {
        const shuffledChoices = shuffleArray(question.question_choices);
        choiceOrder[question.id] = shuffledChoices.map((c) => c.id);
      } else {
        choiceOrder[question.id] = question.question_choices
          .sort((a, b) => a.position - b.position)
          .map((c) => c.id);
      }
    }

    const attemptNumber = (attemptCount ?? 0) + 1;
    const expiresAt = new Date(now.getTime() + deployment.duration_minutes * 60 * 1000);

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .insert({
        deployment_id: deploymentId,
        student_id: user.id,
        assessment_version_id: deployment.assessment_version_id,
        attempt_number: attemptNumber,
        status: 'in_progress',
        started_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        identity_verified: !deployment.requires_identity_verification,
      })
      .select()
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: 'Failed to create attempt' }, { status: 500 });
    }

    const manifestHash = btoa(JSON.stringify({ questionOrder, choiceOrder, attemptId: attempt.id }));

    const { data: manifest, error: manifestError } = await supabase
      .from('exam_manifests')
      .insert({
        attempt_id: attempt.id,
        question_order: questionOrder,
        choice_order: choiceOrder,
        manifest_hash: manifestHash,
      })
      .select()
      .single();

    if (manifestError || !manifest) {
      return NextResponse.json({ error: 'Failed to create manifest' }, { status: 500 });
    }

    const questionsForStudent = orderedQuestions.map((q) => ({
      ...q,
      question_choices: q.question_choices
        .filter((c) => choiceOrder[q.id]?.includes(c.id))
        .sort((a, b) => (choiceOrder[q.id]?.indexOf(a.id) ?? 0) - (choiceOrder[q.id]?.indexOf(b.id) ?? 0)),
    }));

    return NextResponse.json({
      attempt,
      manifest,
      questions: questionsForStudent,
    });
  } catch (error) {
    console.error('Exam start error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
