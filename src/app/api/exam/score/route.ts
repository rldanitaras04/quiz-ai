import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { scoreAttempt } from '@/lib/scoring';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Authenticate the caller.
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { attemptId } = await request.json();
    if (typeof attemptId !== 'string' || !attemptId) {
      return NextResponse.json({ error: 'attemptId is required' }, { status: 400 });
    }

    const { data: attempt, error: attemptError } = await supabase
      .from('exam_attempts')
      .select('id, student_id, deployment_id, status')
      .eq('id', attemptId)
      .single();

    if (attemptError || !attempt) {
      return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    }

    // Only the attempt owner (or faculty/admin for their offering) may score it.
    const isOwner = attempt.student_id === user.id;
    let authorized = isOwner;

    if (!authorized) {
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const isFacultyOrAdmin = roles?.some(
        (r) => r.role === 'faculty' || r.role === 'super_admin'
      );

      if (isFacultyOrAdmin) {
        const { data: assignment } = await supabase
          .from('assessment_deployments')
          .select('subject_offering_id')
          .eq('id', attempt.deployment_id)
          .single();

        if (assignment) {
          const { data: facAssignment } = await supabase
            .from('faculty_assignments')
            .select('id')
            .eq('subject_offering_id', assignment.subject_offering_id)
            .eq('faculty_id', user.id)
            .maybeSingle();

          authorized = !!facAssignment;
        }

        if (!authorized && roles?.some((r) => r.role === 'super_admin')) {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (attempt.status !== 'submitted' && attempt.status !== 'auto_submitted') {
      return NextResponse.json({ error: 'Attempt not submitted' }, { status: 400 });
    }

    // Scoring reads answer keys (RLS-denied to students) and writes results,
    // so it must run with the service-role client.
    const admin = createAdminClient();
    const { rawScore, possibleScore, percentage } = await scoreAttempt(attemptId, admin);

    const { data: existingResult } = await admin
      .from('assessment_results')
      .select('id')
      .eq('attempt_id', attemptId)
      .single();

    if (existingResult) {
      await admin
        .from('assessment_results')
        .update({
          raw_score: rawScore,
          possible_score: possibleScore || 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingResult.id);
    } else {
      await admin.from('assessment_results').insert({
        attempt_id: attemptId,
        student_id: attempt.student_id,
        deployment_id: attempt.deployment_id,
        raw_score: rawScore,
        possible_score: possibleScore || 1,
        status: 'pending',
      });
    }

    const { data: deployment } = await admin
      .from('assessment_deployments')
      .select('score_release_mode')
      .eq('id', attempt.deployment_id)
      .single();

    if (deployment?.score_release_mode === 'immediate') {
      const { data: result } = await admin
        .from('assessment_results')
        .select('id')
        .eq('attempt_id', attemptId)
        .single();

      if (result) {
        await admin
          .from('assessment_results')
          .update({
            status: 'released',
            released_at: new Date().toISOString(),
          })
          .eq('id', result.id);
      }
    }

    return NextResponse.json({
      success: true,
      rawScore,
      possibleScore,
      percentage,
    });
  } catch (error) {
    console.error('Score error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
