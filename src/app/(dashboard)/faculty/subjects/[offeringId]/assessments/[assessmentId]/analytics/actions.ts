'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isFacultyOfOffering } from '@/lib/auth';

async function requireUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Not authenticated');
  return { supabase, userId: user.id };
}

export interface DeploymentAnalytics {
  deployment_id: string;
  assessment_title: string;
  total_enrolled: number;
  total_attempted: number;
  total_submitted: number;
  completion_rate: number;
  mean_score: number;
  median_score: number;
  highest_score: number;
  lowest_score: number;
  standard_deviation: number;
  pass_rate: number;
  score_distribution: { range: string; count: number }[];
  item_analysis: ItemAnalysis[];
}

export interface ItemAnalysis {
  question_id: string;
  question_text: string;
  question_type: string;
  difficulty: string;
  bloom_level: string;
  points: number;
  total_responses: number;
  correct_count: number;
  difficulty_index: number;
  discrimination_index: number | null;
  distractor_analysis: DistractorAnalysis[];
}

export interface DistractorAnalysis {
  choice_id: string;
  choice_key: string;
  choice_text: string;
  selection_count: number;
  selection_percentage: number;
  is_correct: boolean;
}

/**
 * Upper/lower 27% discrimination index D = (RU/NU) − (RL/NL).
 * Respondents are ranked by total percentage; the top and bottom 27% (at least
 * 3 each when n allows) form the groups. Returns null when there are too few
 * scored attempts to form meaningful groups, or when the item has no variance
 * (everyone correct or everyone incorrect).
 */
function computeDiscriminationIndex(
  items: { attemptId: string; correct: boolean }[],
  totalByAttempt: Map<string, number>
): number | null {
  const scored = items.filter(i => totalByAttempt.has(i.attemptId));
  const n = scored.length;
  if (n < 6) return null;

  const correctCount = scored.filter(i => i.correct).length;
  if (correctCount === 0 || correctCount === n) return null;

  const groupSize = Math.max(3, Math.ceil(n * 0.27));
  if (groupSize * 2 > n) return null;

  const sorted = scored
    .slice()
    .sort((a, b) => (totalByAttempt.get(b.attemptId) ?? 0) - (totalByAttempt.get(a.attemptId) ?? 0));

  const upper = sorted.slice(0, groupSize);
  const lower = sorted.slice(sorted.length - groupSize);

  const ru = upper.filter(i => i.correct).length / upper.length;
  const rl = lower.filter(i => i.correct).length / lower.length;
  return ru - rl;
}

export async function getDeploymentAnalytics(
  deploymentId: string
): Promise<{ data: DeploymentAnalytics | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, assessment_version_id, subject_offering_id')
    .eq('id', deploymentId)
    .single();

  if (!deployment) return { data: null, error: 'Deployment not found' };
  if (!(await isFacultyOfOffering(supabase, userId, deployment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  const admin = createAdminClient();

  // Get assessment title
  const { data: version } = await admin
    .from('assessment_versions')
    .select('id, assessment_id, assessment:assessments!assessment_versions_assessment_id_fkey(title)')
    .eq('id', deployment.assessment_version_id)
    .single();

  const assessmentTitle = (version?.assessment as { title?: string })?.title ?? 'Unknown';

  // Get enrolled students
  const { count: enrolledCount } = await admin
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('subject_offering_id', deployment.subject_offering_id)
    .eq('status', 'enrolled');

  // Get attempts
  const { data: attempts } = await admin
    .from('exam_attempts')
    .select('id, student_id, status')
    .eq('deployment_id', deploymentId);

  const totalAttempted = new Set((attempts ?? []).map(a => a.student_id)).size;
  const submittedAttempts = (attempts ?? []).filter(a => a.status === 'submitted' || a.status === 'auto_submitted');
  const totalSubmitted = submittedAttempts.length;

  // Get results
  const attemptIds = submittedAttempts.map(a => a.id);
  const { data: results } = attemptIds.length > 0
    ? await admin
        .from('assessment_results')
        .select('id, attempt_id, raw_score, possible_score, percentage')
        .in('attempt_id', attemptIds)
    : { data: [] };

  const scores = (results ?? []).map(r => r.percentage);
  const completionRate = (enrolledCount ?? 0) > 0 ? (totalSubmitted / (enrolledCount ?? 1)) * 100 : 0;

  // Calculate statistics
  const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  const sortedScores = [...scores].sort((a, b) => a - b);
  const medianScore = sortedScores.length > 0
    ? sortedScores.length % 2 === 0
      ? (sortedScores[sortedScores.length / 2 - 1] + sortedScores[sortedScores.length / 2]) / 2
      : sortedScores[Math.floor(sortedScores.length / 2)]
    : 0;
  const highestScore = sortedScores.length > 0 ? sortedScores[sortedScores.length - 1] : 0;
  const lowestScore = sortedScores.length > 0 ? sortedScores[0] : 0;
  const variance = scores.length > 0
    ? scores.reduce((sum, s) => sum + Math.pow(s - meanScore, 2), 0) / scores.length
    : 0;
  const standardDeviation = Math.sqrt(variance);
  const passRate = scores.length > 0 ? (scores.filter(s => s >= 60).length / scores.length) * 100 : 0;

  // Score distribution
  const ranges = [
    { range: '0-20%', min: 0, max: 20 },
    { range: '21-40%', min: 21, max: 40 },
    { range: '41-60%', min: 41, max: 60 },
    { range: '61-80%', min: 61, max: 80 },
    { range: '81-100%', min: 81, max: 100 },
  ];
  const scoreDistribution = ranges.map(r => ({
    range: r.range,
    count: scores.filter(s => s >= r.min && s <= r.max).length,
  }));

  // Item analysis
  const { data: questions } = await admin
    .from('questions')
    .select('id, question_text, question_type, difficulty, bloom_level, points, position')
    .eq('assessment_version_id', deployment.assessment_version_id)
    .order('position', { ascending: true });

  const questionIds = (questions ?? []).map(q => q.id);

  const { data: answerKeys } = questionIds.length > 0
    ? await admin
        .from('answer_keys')
        .select('question_id, correct_choice_id, canonical_answer, accepted_answers')
        .in('question_id', questionIds)
    : { data: [] };

  const answerKeyMap = new Map((answerKeys ?? []).map(ak => [ak.question_id, ak]));

  const { data: allChoices } = questionIds.length > 0
    ? await admin
        .from('question_choices')
        .select('id, question_id, choice_key, choice_text, position')
        .in('question_id', questionIds)
    : { data: [] };

  const choicesByQuestion = new Map<string, { id: string; choice_key: string; choice_text: string; position: number | null }[]>();
  for (const choice of (allChoices ?? [])) {
    const list = choicesByQuestion.get(choice.question_id) ?? [];
    list.push(choice);
    choicesByQuestion.set(choice.question_id, list);
  }

  const { data: allResponses } = attemptIds.length > 0
    ? await admin
        .from('student_responses')
        .select('attempt_id, question_id, selected_choice_id, text_answer, earned_points')
        .in('attempt_id', attemptIds)
    : { data: [] };

  // Total score per attempt, used as the criterion for the discrimination index.
  const totalByAttempt = new Map<string, number>();
  for (const r of (results ?? [])) totalByAttempt.set(r.attempt_id, r.percentage);

  const itemAnalysis: ItemAnalysis[] = [];
  for (const question of (questions ?? [])) {
    const questionResponses = (allResponses ?? []).filter(r => r.question_id === question.id);
    const answerKey = answerKeyMap.get(question.id);
    const totalResponses = questionResponses.length;

    const isCorrect = (response: { selected_choice_id: string | null; earned_points: number | null }) => {
      if (
        (question.question_type === 'multiple_choice' || question.question_type === 'true_false') &&
        answerKey?.correct_choice_id
      ) {
        return response.selected_choice_id === answerKey.correct_choice_id;
      }
      if (question.question_type === 'identification') {
        return response.earned_points !== null && response.earned_points > 0;
      }
      return false;
    };

    const correctCount = questionResponses.filter(isCorrect).length;
    const difficultyIndex = totalResponses > 0 ? correctCount / totalResponses : 0;
    const discriminationIndex = computeDiscriminationIndex(
      questionResponses.map(r => ({
        attemptId: r.attempt_id,
        correct: isCorrect(r),
      })),
      totalByAttempt
    );

    const distractorAnalysis: DistractorAnalysis[] = [];
    if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
      const choices = (choicesByQuestion.get(question.id) ?? [])
        .slice()
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.choice_key.localeCompare(b.choice_key));

      const selectionCounts = new Map<string, number>();
      for (const r of questionResponses) {
        if (r.selected_choice_id) {
          selectionCounts.set(r.selected_choice_id, (selectionCounts.get(r.selected_choice_id) ?? 0) + 1);
        }
      }

      for (const choice of choices) {
        const count = selectionCounts.get(choice.id) ?? 0;
        distractorAnalysis.push({
          choice_id: choice.id,
          choice_key: choice.choice_key,
          choice_text: choice.choice_text,
          selection_count: count,
          selection_percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0,
          is_correct: choice.id === answerKey?.correct_choice_id,
        });
      }
    }

    itemAnalysis.push({
      question_id: question.id,
      question_text: question.question_text,
      question_type: question.question_type,
      difficulty: question.difficulty,
      bloom_level: question.bloom_level,
      points: question.points,
      total_responses: totalResponses,
      correct_count: correctCount,
      difficulty_index: difficultyIndex,
      discrimination_index: discriminationIndex,
      distractor_analysis: distractorAnalysis,
    });
  }

  return {
    data: {
      deployment_id: deploymentId,
      assessment_title: assessmentTitle,
      total_enrolled: enrolledCount ?? 0,
      total_attempted: totalAttempted,
      total_submitted: totalSubmitted,
      completion_rate: completionRate,
      mean_score: meanScore,
      median_score: medianScore,
      highest_score: highestScore,
      lowest_score: lowestScore,
      standard_deviation: standardDeviation,
      pass_rate: passRate,
      score_distribution: scoreDistribution,
      item_analysis: itemAnalysis,
    },
  };
}
