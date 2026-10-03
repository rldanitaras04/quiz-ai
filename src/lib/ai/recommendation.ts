// ---------------------------------------------------------------------------
// Identification score recommendation — scope §26 (Automated Score and Item
// Information): "AI may recommend a judgment for ambiguous identification
// answers, but faculty confirms final scoring where confidence is
// insufficient."
// ---------------------------------------------------------------------------
// Pure module: prompt construction + response parsing only, with no imports,
// so it unit-tests directly under `node --test` (like identification-match.ts).
//
// Division of responsibility:
//   * this module  — what to ask and how to read the answer;
//   * ai/chat.ts   — the provider call + token accounting;
//   * review/actions.ts — auth gates, storing the advisory note in
//     scoring_metadata.ai, logAiUsage, and (separately) the ONLY write to
//     earned_points: the faculty's own scoreIdentificationResponse.
//
// The recommendation is advisory by construction: nothing in this feature
// path touches earned_points or scoring_status.

export interface ScoreRecommendation {
  verdict: 'correct' | 'incorrect' | 'uncertain';
  /** 0..1 — clamped; accepted from the model in either 0..1 or 0..100 form. */
  confidence: number;
  rationale: string;
}

export interface RecommendationPromptInput {
  questionText: string;
  points: number;
  canonicalAnswer: string | null;
  acceptedAnswers: string[];
  studentAnswer: string;
}

export function buildRecommendationPrompt(input: RecommendationPromptInput): {
  system: string;
  user: string;
} {
  const system = [
    'You are a grading assistant for short-answer identification questions in an exam.',
    'Decide whether the student answer conveys the same fact as the expected answer,',
    'allowing differences in capitalization, whitespace, punctuation, word order and',
    'minor spelling mistakes. Different concepts, reversed meanings, or answers that',
    'drop a key term do not match.',
    'Reply with ONLY one JSON object — no prose, no code fences:',
    '{"verdict":"correct"|"incorrect"|"uncertain","confidence":<number 0..1>,"rationale":"<one or two sentences>"}',
    'Use "uncertain" when the match is genuinely ambiguous and a human should decide.',
  ].join(' ');

  const user = [
    `Question: ${input.questionText}`,
    `Worth: ${input.points} point(s)`,
    `Expected answer: ${input.canonicalAnswer ?? '(no canonical answer on file)'}`,
    `Also accepted: ${input.acceptedAnswers.length > 0 ? input.acceptedAnswers.join('; ') : '(none)'}`,
    `Student answer: ${input.studentAnswer}`,
  ].join('\n');

  return { system, user };
}

/**
 * Verdict synonyms models actually emit. Unknown verdicts are a hard parse
 * error (fail loudly rather than silently guessing what the model meant).
 */
const VERDICT_SYNONYMS: Record<string, ScoreRecommendation['verdict']> = {
  correct: 'correct',
  right: 'correct',
  match: 'correct',
  yes: 'correct',
  incorrect: 'incorrect',
  wrong: 'incorrect',
  no: 'incorrect',
  uncertain: 'uncertain',
  review: 'uncertain',
  needs_review: 'uncertain',
  needsreview: 'uncertain',
  manual_review: 'uncertain',
  unsure: 'uncertain',
  ambiguous: 'uncertain',
};

/**
 * Parse the model's reply into a ScoreRecommendation. Tolerates markdown code
 * fences and surrounding prose (common with open-ended chat models), accepts
 * confidence as 0..1 or 0..100, clamps it into range, and defaults a missing
 * rationale to ''. Throws on anything it cannot interpret with confidence —
 * callers surface that as "the AI returned an unreadable recommendation".
 */
export function parseScoreRecommendation(raw: string): ScoreRecommendation {
  let cleaned = raw.trim();

  // Strip a markdown fence if present: ```json ... ```
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  }

  // Fall back to the outermost {...} block when the model wrapped the object
  // in prose ("Here is my evaluation: {...}").
  if (!cleaned.startsWith('{')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('No JSON object in the AI response');
    }
    cleaned = cleaned.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI response is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('AI response is not a JSON object');
  }

  const obj = parsed as Record<string, unknown>;

  const verdictKey =
    typeof obj.verdict === 'string'
      ? obj.verdict.trim().toLowerCase().replace(/[\s-]+/g, '_')
      : '';
  const verdict = VERDICT_SYNONYMS[verdictKey];
  if (!verdict) {
    throw new Error(`Unrecognized verdict: ${verdictKey || '(missing)'}`);
  }

  const rawConfidence = typeof obj.confidence === 'number' ? obj.confidence : NaN;
  if (!Number.isFinite(rawConfidence)) {
    throw new Error('Missing or non-numeric confidence');
  }
  // Accept both 0..1 and 0..100 encodings (models do both).
  const scaled = rawConfidence > 1 ? rawConfidence / 100 : rawConfidence;
  const confidence = Math.min(1, Math.max(0, scaled));

  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';

  return { verdict, confidence, rationale };
}
