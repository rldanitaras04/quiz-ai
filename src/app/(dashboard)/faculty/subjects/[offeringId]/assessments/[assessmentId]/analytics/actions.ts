'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isFacultyOfOfferingOrSubject } from '@/lib/auth';
import { EVENT_TYPE_LABELS } from '@/lib/exam-security';
import { getSettings } from '@/lib/settings';
import {
  computeDiscriminationIndex,
  discriminationRating,
  itemFlags,
  passRate as computePassRate,
  type AnalysisThresholds,
  type DiscriminationRating,
  type ItemFlag,
} from '@/lib/item-analysis';

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
  /** The system_settings thresholds these numbers were interpreted against. */
  thresholds: AnalysisThresholds;
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
  /** Interpretation of D against the configured cut-offs (§29 guidance). */
  rating: DiscriminationRating;
  /** Item review flags against the configured thresholds (§29/§31). */
  flags: ItemFlag[];
}

export interface DistractorAnalysis {
  choice_id: string;
  choice_key: string;
  choice_text: string;
  selection_count: number;
  selection_percentage: number;
  is_correct: boolean;
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
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  // Interpretation thresholds from system_settings — scope §29: "Interpretation
  // thresholds must be configurable and treated as analytic guidance, not
  // unquestionable conclusions." Returned alongside the numbers so the UI can
  // label its legend with the values actually applied.
  const settings = await getSettings();
  const thresholds: AnalysisThresholds = {
    groupPercent: settings.analysis_group_percent,
    passMark: settings.analysis_pass_mark,
    easyP: settings.analysis_easy_p,
    hardP: settings.analysis_hard_p,
    minDisc: settings.analysis_min_disc,
    goodD: settings.analysis_good_d,
    fairD: settings.analysis_fair_d,
    lowDistractorPct: settings.analysis_low_distractor_pct,
  };

  // Get assessment title
  const { data: version } = await supabase
    .from('assessment_versions')
    .select('id, assessment_id, assessment:assessments!assessment_versions_assessment_id_fkey(title)')
    .eq('id', deployment.assessment_version_id)
    .single();

  const assessmentTitle = (version?.assessment as { title?: string })?.title ?? 'Unknown';

  // Get enrolled students
  const { count: enrolledCount } = await supabase
    .from('enrollments')
    .select('id', { count: 'exact', head: true })
    .eq('subject_offering_id', deployment.subject_offering_id)
    .eq('status', 'enrolled');

  // Get attempts
  const { data: attempts } = await supabase
    .from('exam_attempts')
    .select('id, student_id, status')
    .eq('deployment_id', deploymentId);

  const totalAttempted = new Set((attempts ?? []).map(a => a.student_id)).size;
  const submittedAttempts = (attempts ?? []).filter(a => a.status === 'submitted' || a.status === 'auto_submitted');
  const totalSubmitted = submittedAttempts.length;

  // Get results
  const attemptIds = submittedAttempts.map(a => a.id);
  const { data: results } = attemptIds.length > 0
    ? await supabase
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
  const passRate = computePassRate(scores, thresholds.passMark);

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
  const { data: questions } = await supabase
    .from('questions')
    .select('id, question_text, question_type, difficulty, bloom_level, points, position')
    .eq('assessment_version_id', deployment.assessment_version_id)
    .order('position', { ascending: true });

  const questionIds = (questions ?? []).map(q => q.id);

  const { data: answerKeys } = questionIds.length > 0
    ? await supabase
        .from('answer_keys')
        .select('question_id, correct_choice_id, canonical_answer, accepted_answers')
        .in('question_id', questionIds)
    : { data: [] };

  const answerKeyMap = new Map((answerKeys ?? []).map(ak => [ak.question_id, ak]));

  const { data: allChoices } = questionIds.length > 0
    ? await supabase
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

  // earned_points is no longer granted to the session role (migration
  // 20261005000000 — pre-release score leak). The faculty-of-offering gate
  // above has passed and attemptIds already come from session-scoped reads,
  // so this runs with the service-role client: gates-then-admin, the same
  // pattern loadAttemptBreakdown uses.
  const admin = createAdminClient();
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
      totalByAttempt,
      thresholds.groupPercent
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

    const rating = discriminationRating(discriminationIndex, thresholds);
    const flags = itemFlags(
      {
        responses: totalResponses,
        difficultyIndex,
        discriminationIndex,
        distractorPercentages: distractorAnalysis
          .filter(d => !d.is_correct)
          .map(d => d.selection_percentage),
      },
      thresholds
    );

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
      rating,
      flags,
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
      thresholds,
    },
  };
}

// ---------------------------------------------------------------------------
// Post-exam security summary
// ---------------------------------------------------------------------------

export interface SecurityEventTypeCount {
  type: string;
  label: string;
  count: number;
}

export interface SecuritySummaryAttemptRow {
  attemptId: string;
  studentName: string;
  studentNumber: string | null;
  status: string;
  sessionCount: number;
  sessionTransfers: number;
  reverificationRequired: boolean;
  counts: { info: number; warning: number; critical: number };
  notableEvents: SecurityEventTypeCount[];
}

export interface SecurityHistoryEntry {
  type: string;
  label: string;
  studentName: string;
  at: string;
  minutes?: number;
}

export interface SecuritySummary {
  deploymentId: string;
  totals: {
    attempts: number;
    started: number;
    inProgress: number;
    submitted: number;
    terminated: number;
    sessions: number;
    sessionTransfers: number;
    recoveredSessions: number;
    connectionLosses: number;
    fullscreenExits: number;
    focusLosses: number;
    concurrentSessionAttempts: number;
    reverificationRequests: number;
    reverificationFailures: number;
    facultyInterventions: number;
    extraTimeGrants: number;
    facultyTerminations: number;
    syncQueueEvents: number;
    events: { info: number; warning: number; critical: number };
  };
  commonEvents: SecurityEventTypeCount[];
  interventionHistory: SecurityHistoryEntry[];
  syncHistory: SecurityHistoryEntry[];
  attempts: SecuritySummaryAttemptRow[];
}

/**
 * Post-exam security summary for a deployment: session counts, transfers,
 * reverification requests, terminations and the factual event mix per student.
 *
 * These are operational records for faculty review — never an automated
 * finding of misconduct, and no response is derived from them automatically.
 */
export async function getSecuritySummary(
  deploymentId: string
): Promise<{ data: SecuritySummary | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id')
    .eq('id', deploymentId)
    .single();

  if (!deployment) return { data: null, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  const admin = createAdminClient();

  const [attemptsRes, sessionsRes, eventsRes] = await Promise.all([
    admin
      .from('exam_attempts')
      .select('id, student_id, status, started_at')
      .eq('deployment_id', deploymentId),
    admin
      .from('exam_sessions')
      .select('id, attempt_id, status, close_reason, reverification_required')
      .eq('deployment_id', deploymentId),
    admin
      .from('exam_events')
      .select('attempt_id, student_id, event_type, severity, metadata, recorded_at')
      .eq('deployment_id', deploymentId)
      .limit(5000),
  ]);

  const attempts = attemptsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];
  const events = eventsRes.data ?? [];

  const studentIds = Array.from(new Set(attempts.map((a) => a.student_id)));
  const [profilesRes, numbersRes] = await Promise.all([
    studentIds.length > 0
      ? admin.from('profiles').select('id, full_name').in('id', studentIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    studentIds.length > 0
      ? admin.from('student_profiles').select('user_id, student_number').in('user_id', studentIds)
      : Promise.resolve({ data: [] as { user_id: string; student_number: string }[] }),
  ]);
  const names = new Map(
    ((profilesRes.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
  );
  const numbers = new Map(
    ((numbersRes.data ?? []) as { user_id: string; student_number: string }[]).map((p) => [
      p.user_id,
      p.student_number,
    ])
  );

  const sessionsByAttempt = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = sessionsByAttempt.get(s.attempt_id) ?? [];
    list.push(s);
    sessionsByAttempt.set(s.attempt_id, list);
  }

  const eventsByAttempt = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsByAttempt.get(e.attempt_id) ?? [];
    list.push(e);
    eventsByAttempt.set(e.attempt_id, list);
  }

  const countByType = (list: typeof events): SecurityEventTypeCount[] => {
    const counts = new Map<string, number>();
    for (const e of list) counts.set(e.event_type, (counts.get(e.event_type) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([type, count]) => ({
        type,
        label: EVENT_TYPE_LABELS[type as keyof typeof EVENT_TYPE_LABELS] ?? type,
        count,
      }))
      .sort((a, b) => b.count - a.count);
  };

  const severityCounts = (list: typeof events) => ({
    info: list.filter((e) => e.severity === 'info').length,
    warning: list.filter((e) => e.severity === 'warning').length,
    critical: list.filter((e) => e.severity === 'critical').length,
  });

  const rows: SecuritySummaryAttemptRow[] = attempts.map((attempt) => {
    const attemptSessions = sessionsByAttempt.get(attempt.id) ?? [];
    const attemptEvents = eventsByAttempt.get(attempt.id) ?? [];
    const counts = severityCounts(attemptEvents);
    return {
      attemptId: attempt.id,
      studentName: names.get(attempt.student_id) ?? 'Unknown student',
      studentNumber: numbers.get(attempt.student_id) ?? null,
      status: attempt.status,
      sessionCount: attemptSessions.length,
      sessionTransfers: attemptSessions.filter(
        (s) => s.close_reason === 'transferred_to_new_session'
      ).length,
      reverificationRequired: attemptSessions.some((s) => s.reverification_required === true),
      counts,
      notableEvents: countByType(attemptEvents).slice(0, 5),
    };
  });

  // Students with notable events first, then by name.
  rows.sort((a, b) => {
    const score = (r: SecuritySummaryAttemptRow) => r.counts.critical * 100 + r.counts.warning;
    const d = score(b) - score(a);
    if (d !== 0) return d;
    return a.studentName.localeCompare(b.studentName);
  });

  const countType = (type: string) => events.filter((e) => e.event_type === type).length;
  const metaAction = (e: (typeof events)[number]) =>
    (e.metadata as { action?: string } | null)?.action ?? null;

  const historyEntry = (e: (typeof events)[number]): SecurityHistoryEntry => {
    const meta = (e.metadata as { action?: string; minutes?: number } | null) ?? null;
    const base = EVENT_TYPE_LABELS[e.event_type as keyof typeof EVENT_TYPE_LABELS] ?? e.event_type;
    const action = meta?.action ? meta.action.replace(/_/g, ' ') : null;
    return {
      type: e.event_type,
      label: action
        ? `${base} — ${action}${typeof meta?.minutes === 'number' ? ` +${meta.minutes} min` : ''}`
        : base,
      studentName: names.get(e.student_id) ?? 'Unknown student',
      at: e.recorded_at,
      minutes: typeof meta?.minutes === 'number' ? meta.minutes : undefined,
    };
  };
  const byTimeDesc = (a: SecurityHistoryEntry, b: SecurityHistoryEntry) =>
    b.at.localeCompare(a.at);

  const interventionHistory = events
    .filter(
      (e) => e.event_type === 'faculty_intervention' || e.event_type === 'attempt_terminated'
    )
    .map(historyEntry)
    .sort(byTimeDesc)
    .slice(0, 25);

  const SYNC_HISTORY_TYPES = new Set([
    'connection_lost',
    'connection_restored',
    'pending_sync_started',
    'pending_sync_completed',
    'session_recovered',
    'page_reloaded',
  ]);
  const syncHistory = events
    .filter((e) => SYNC_HISTORY_TYPES.has(e.event_type))
    .map(historyEntry)
    .sort(byTimeDesc)
    .slice(0, 25);

  return {
    data: {
      deploymentId,
      totals: {
        attempts: attempts.length,
        started: attempts.filter((a) => a.started_at).length,
        inProgress: attempts.filter((a) => a.status === 'in_progress').length,
        submitted: attempts.filter(
          (a) => a.status === 'submitted' || a.status === 'auto_submitted'
        ).length,
        terminated: attempts.filter((a) => a.status === 'invalidated').length,
        sessions: sessions.length,
        sessionTransfers: sessions.filter(
          (s) => s.close_reason === 'transferred_to_new_session'
        ).length,
        recoveredSessions: countType('session_recovered'),
        connectionLosses: countType('connection_lost'),
        fullscreenExits: countType('fullscreen_exited'),
        focusLosses: countType('window_blurred'),
        concurrentSessionAttempts: countType('concurrent_session_attempt'),
        reverificationRequests: countType('identity_reverification_required'),
        reverificationFailures: countType('identity_reverification_failed'),
        facultyInterventions: countType('faculty_intervention'),
        extraTimeGrants: events.filter(
          (e) => e.event_type === 'faculty_intervention' && metaAction(e) === 'extra_time'
        ).length,
        facultyTerminations: countType('attempt_terminated'),
        syncQueueEvents: countType('pending_sync_started') + countType('pending_sync_completed'),
        events: severityCounts(events),
      },
      commonEvents: countByType(events).slice(0, 8),
      interventionHistory,
      syncHistory,
      attempts: rows,
    },
  };
}

// ---------------------------------------------------------------------------
// Per-student answer review
// ---------------------------------------------------------------------------
// Faculty read a submitted attempt item by item, including the correct answer
// and the accepted alternatives. Faculty visibility is deliberately independent
// of the student-facing display flags (`show_correct_answers`,
// `show_item_correctness`): those govern what a *student* may see, never what an
// instructor may inspect. The gate is the same faculty-of-offering check as the
// rest of this module; score columns and the answer key are then read with the
// service-role client (gates-then-admin), because the session role cannot see
// earned_points (migration 20261005000000).

export interface ReviewableAttempt {
  attempt_id: string;
  student_id: string;
  student_name: string;
  student_email: string;
  attempt_number: number;
  status: string;
  submitted_at: string | null;
  raw_score: number | null;
  possible_score: number | null;
  percentage: number | null;
  released: boolean;
}

/** Submitted attempts in a deployment, newest first, ready for per-student review. */
export async function getAttemptsForAnswerReview(
  deploymentId: string
): Promise<{ data: ReviewableAttempt[] | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, subject_offering_id')
    .eq('id', deploymentId)
    .maybeSingle();

  if (!deployment) return { data: null, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  const { data: attempts } = await supabase
    .from('exam_attempts')
    .select('id, student_id, attempt_number, status, submitted_at, created_at')
    .eq('deployment_id', deploymentId)
    .in('status', ['submitted', 'auto_submitted', 'expired'])
    .order('created_at', { ascending: true });

  if (!attempts || attempts.length === 0) return { data: [] };

  const studentIds = [...new Set(attempts.map((a) => a.student_id))];
  const attemptIds = attempts.map((a) => a.id);

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('id', studentIds);

  const { data: results } = await supabase
    .from('assessment_results')
    .select('attempt_id, raw_score, possible_score, percentage, status')
    .in('attempt_id', attemptIds);

  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));
  const resultMap = new Map((results ?? []).map((r) => [r.attempt_id, r]));

  const toNumber = (value: unknown): number | null => {
    if (value == null) return null;
    const n = Number(value);
    return Number.isNaN(n) ? null : n;
  };

  const data: ReviewableAttempt[] = attempts.map((a) => {
    const profile = profileMap.get(a.student_id);
    const result = resultMap.get(a.id);
    return {
      attempt_id: a.id,
      student_id: a.student_id,
      student_name: profile?.full_name ?? 'Unknown student',
      student_email: profile?.email ?? '',
      attempt_number: a.attempt_number,
      status: a.status,
      submitted_at: a.submitted_at,
      raw_score: toNumber(result?.raw_score),
      possible_score: toNumber(result?.possible_score),
      percentage: toNumber(result?.percentage),
      released: result?.status === 'released',
    };
  });

  data.sort(
    (a, b) =>
      a.student_name.localeCompare(b.student_name) || a.attempt_number - b.attempt_number
  );

  return { data };
}

export interface FacultyAnswerReviewItem {
  question_id: string;
  position: number | null;
  question_text: string;
  question_type: string;
  points: number;
  image_url: string | null;
  /** The student's answer, rendered as text (choice key + text, or free text). */
  student_answer: string | null;
  /** The key's answer, rendered the same way; null when no key is on file. */
  correct_answer: string | null;
  accepted_answers: string[];
  earned_points: number | null;
  /** null when the response carries no score yet. */
  is_correct: boolean | null;
}

export interface FacultyAnswerReview {
  attempt_id: string;
  student_name: string;
  student_email: string;
  attempt_number: number;
  status: string;
  submitted_at: string | null;
  items: FacultyAnswerReviewItem[];
}

/** One attempt, item by item: the student's answer next to the correct one. */
export async function getAttemptAnswersForReview(
  attemptId: string
): Promise<{ data: FacultyAnswerReview | null; error?: string }> {
  const { supabase, userId } = await requireUser();

  const { data: attempt } = await supabase
    .from('exam_attempts')
    .select('id, student_id, deployment_id, attempt_number, status, submitted_at')
    .eq('id', attemptId)
    .maybeSingle();

  if (!attempt) return { data: null, error: 'Attempt not found' };
  // An attempt in flight has not settled; its answers must not be read out
  // mid-exam (loadAttemptBreakdown applies the same rule for students).
  if (attempt.status === 'in_progress') {
    return { data: null, error: 'Attempt is still in progress' };
  }

  const { data: deployment } = await supabase
    .from('assessment_deployments')
    .select('id, assessment_version_id, subject_offering_id')
    .eq('id', attempt.deployment_id)
    .maybeSingle();

  if (!deployment) return { data: null, error: 'Deployment not found' };
  if (!(await isFacultyOfOfferingOrSubject(supabase, userId, deployment.subject_offering_id))) {
    return { data: null, error: 'Not authorized' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('id', attempt.student_id)
    .maybeSingle();

  const { data: questions } = await supabase
    .from('questions')
    .select('id, question_text, question_type, points, position, image_url')
    .eq('assessment_version_id', deployment.assessment_version_id)
    .order('position', { ascending: true });

  const questionIds = (questions ?? []).map((q) => q.id);

  const { data: choices } =
    questionIds.length > 0
      ? await supabase
          .from('question_choices')
          .select('id, question_id, choice_key, choice_text')
          .in('question_id', questionIds)
      : { data: [] };

  const { data: answerKeys } =
    questionIds.length > 0
      ? await supabase
          .from('answer_keys')
          .select('question_id, correct_choice_id, canonical_answer, accepted_answers')
          .in('question_id', questionIds)
      : { data: [] };

  // earned_points is withheld from the session role (20261005000000), so the
  // responses read uses the service-role client after the gate above.
  const admin = createAdminClient();
  const { data: responses } = await admin
    .from('student_responses')
    .select('question_id, selected_choice_id, text_answer, earned_points')
    .eq('attempt_id', attemptId);

  const choicesByQuestion = new Map<
    string,
    { id: string; choice_key: string; choice_text: string }[]
  >();
  for (const choice of choices ?? []) {
    const list = choicesByQuestion.get(choice.question_id) ?? [];
    list.push({ id: choice.id, choice_key: choice.choice_key, choice_text: choice.choice_text });
    choicesByQuestion.set(choice.question_id, list);
  }

  const answerKeyMap = new Map((answerKeys ?? []).map((ak) => [ak.question_id, ak]));
  const responseMap = new Map((responses ?? []).map((r) => [r.question_id, r]));

  const items: FacultyAnswerReviewItem[] = (questions ?? []).map((q) => {
    const isChoiceBased = q.question_type === 'multiple_choice' || q.question_type === 'true_false';
    const answerKey = answerKeyMap.get(q.id);
    const response = responseMap.get(q.id);
    const questionChoices = choicesByQuestion.get(q.id) ?? [];

    const selected = response?.selected_choice_id
      ? questionChoices.find((c) => c.id === response.selected_choice_id)
      : undefined;
    const correct = answerKey?.correct_choice_id
      ? questionChoices.find((c) => c.id === answerKey.correct_choice_id)
      : undefined;

    const earned = response?.earned_points ?? null;
    let isCorrect: boolean | null = null;
    if (earned !== null) {
      isCorrect = isChoiceBased
        ? Boolean(answerKey?.correct_choice_id) && response?.selected_choice_id === answerKey?.correct_choice_id
        : earned > 0;
    }

    return {
      question_id: q.id,
      position: q.position,
      question_text: q.question_text,
      question_type: q.question_type,
      points: q.points,
      image_url: q.image_url ?? null,
      student_answer: isChoiceBased
        ? selected
          ? `${selected.choice_key}. ${selected.choice_text}`
          : null
        : response?.text_answer ?? null,
      correct_answer: isChoiceBased
        ? correct
          ? `${correct.choice_key}. ${correct.choice_text}`
          : null
        : answerKey?.canonical_answer ?? null,
      accepted_answers: (answerKey?.accepted_answers as string[] | null) ?? [],
      earned_points: earned,
      is_correct: isCorrect,
    };
  });

  return {
    data: {
      attempt_id: attempt.id,
      student_name: profile?.full_name ?? 'Unknown student',
      student_email: profile?.email ?? '',
      attempt_number: attempt.attempt_number,
      status: attempt.status,
      submitted_at: attempt.submitted_at,
      items,
    },
  };
}
