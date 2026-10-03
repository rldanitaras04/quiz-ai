// ---------------------------------------------------------------------------
// Table of Specifications — scope §10.
// ---------------------------------------------------------------------------
// Pure prompt/parse/validate module with zero imports (node --test friendly,
// like identification-match.ts and recommendation.ts). Division of
// responsibility:
//   * this module — what to ask the AI, how to read its proposal, and how to
//     validate totals/percentages;
//   * assessments/actions.ts — auth (requireOfferingFaculty), the provider
//     call, logAiUsage, and returning rows + validation to the wizard;
//   * the wizard (StepTos) — manual edit loop, approval, and syncing the
//     approved marginals back into the generation config;
//   * approveAssessment — persists the approved rows to
//     assessment_versions.tos_snapshot ("preserve the approved TOS with the
//     assessment version").

export type TosQuestionType = 'multiple_choice' | 'identification' | 'true_false';
export type TosDifficulty = 'easy' | 'moderate' | 'difficult';
export type TosBloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyze'
  | 'evaluate'
  | 'create';

export interface TosRow {
  topic: string;
  question_type: TosQuestionType;
  difficulty: TosDifficulty;
  bloom_level: TosBloomLevel;
  count: number;
}

export interface TosGenerationInput {
  topics: { title: string; description?: string | null }[];
  totalItems: number;
  countPerType: Record<TosQuestionType, number>;
  difficulty: Record<TosDifficulty, number>;
  bloom: Record<TosBloomLevel, number>;
  assessmentCategory?: string;
  sourceTitles?: string[];
}

export interface TosValidationTargets {
  countPerType?: Partial<Record<TosQuestionType, number>>;
  difficulty?: Partial<Record<TosDifficulty, number>>;
  bloom?: Partial<Record<TosBloomLevel, number>>;
}

export interface TosMarginals {
  totalItems: number;
  byType: Record<string, number>;
  byDifficulty: Record<string, number>;
  byBloom: Record<string, number>;
  byTopic: Record<string, number>;
}

export interface TosValidation {
  totalItems: number;
  /** Blocking issues — approval must be refused while any remain. */
  problems: string[];
  /** Divergence from the generation config (informational, not blocking). */
  warnings: string[];
}

const QUESTION_TYPES: TosQuestionType[] = ['multiple_choice', 'identification', 'true_false'];
const DIFFICULTIES: TosDifficulty[] = ['easy', 'moderate', 'difficult'];
const BLOOM_LEVELS: TosBloomLevel[] = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
];

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildTosPrompt(input: TosGenerationInput): {
  system: string;
  user: string;
} {
  const system = [
    'You are an assessment specialist building a Table of Specifications (TOS)',
    'for an exam blueprint. Allocate every planned item across the given topics',
    'so that the row counts reproduce ALL of these totals exactly:',
    'the per-question-type counts, the per-difficulty counts, the per-Bloom-level',
    'counts, and the grand total.',
    'Use only the provided topics. Each row is one combination of',
    'topic + question_type + difficulty + bloom_level with a positive whole-number',
    'count; merge combinations into separate rows rather than repeating one.',
    'Reply with ONLY one JSON object — no prose, no code fences:',
    '{"rows":[{"topic":"...","question_type":"multiple_choice"|"identification"|"true_false","difficulty":"easy"|"moderate"|"difficult","bloom_level":"remember"|"understand"|"apply"|"analyze"|"evaluate"|"create","count":<positive integer>}]}',
  ].join(' ');

  const lines: string[] = [];
  if (input.assessmentCategory) lines.push(`Assessment type: ${input.assessmentCategory}`);
  if (input.sourceTitles && input.sourceTitles.length > 0) {
    lines.push(`Source material covered: ${input.sourceTitles.join('; ')}`);
  }
  lines.push(`Topics: ${input.topics.map((t) => t.title).join('; ')}`);
  for (const t of input.topics) {
    if (t.description) lines.push(`${t.title} — ${t.description}`);
  }
  lines.push(`Grand total: ${input.totalItems} items`);
  lines.push(
    `By question type: ${QUESTION_TYPES.map((t) => `${t}=${input.countPerType[t] ?? 0}`).join(', ')}`
  );
  lines.push(
    `By difficulty: ${DIFFICULTIES.map((d) => `${d}=${input.difficulty[d] ?? 0}`).join(', ')}`
  );
  lines.push(`By Bloom level: ${BLOOM_LEVELS.map((b) => `${b}=${input.bloom[b] ?? 0}`).join(', ')}`);

  return { system, user: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Synonyms models actually emit, normalized to the canonical enums. */
const TYPE_SYNONYMS: Record<string, TosQuestionType> = {
  multiple_choice: 'multiple_choice',
  multiplechoice: 'multiple_choice',
  mcq: 'multiple_choice',
  choice: 'multiple_choice',
  identification: 'identification',
  id: 'identification',
  true_false: 'true_false',
  truefalse: 'true_false',
  tf: 'true_false',
};

const DIFFICULTY_SYNONYMS: Record<string, TosDifficulty> = {
  easy: 'easy',
  moderate: 'moderate',
  medium: 'moderate',
  difficult: 'difficult',
  hard: 'difficult',
};

const BLOOM_SYNONYMS: Record<string, TosBloomLevel> = {
  remember: 'remember',
  knowledge: 'remember',
  understand: 'understand',
  comprehension: 'understand',
  apply: 'apply',
  application: 'apply',
  analyze: 'analyze',
  analysis: 'analyze',
  evaluate: 'evaluate',
  evaluation: 'evaluate',
  create: 'create',
  synthesis: 'create',
};

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

function unwrapJson(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  }
  if (!cleaned.startsWith('{') && !cleaned.startsWith('[')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) {
      throw new Error('No JSON object in the AI response');
    }
    cleaned = cleaned.slice(start, end + 1);
  }
  return cleaned;
}

/**
 * Parse the model's TOS proposal into usable rows.
 *
 * Rows are silently dropped when the topic is not one of `allowedTopics` or
 * when an enum/count does not parse — a proposal that yields nothing usable
 * throws, so the caller can report "unreadable proposal" instead of silently
 * presenting an empty plan. Duplicate combinations are merged by summing
 * their counts.
 */
export function parseTosProposal(raw: string, allowedTopics: string[]): TosRow[] {
  const cleaned = unwrapJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI response is not valid JSON');
  }

  const rowsRaw = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { rows?: unknown }).rows)
      ? (parsed as { rows: unknown[] }).rows
      : null;
  if (!rowsRaw) {
    throw new Error('AI response does not contain a rows array');
  }

  // Case-insensitive topic lookup that resolves back to the canonical title.
  const canonicalByLower = new Map<string, string>();
  for (const t of allowedTopics) {
    const title = t.trim();
    if (title) canonicalByLower.set(title.toLowerCase(), title);
  }

  const merged = new Map<string, TosRow>();
  for (const entry of rowsRaw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;

    const rawTopic = typeof row.topic === 'string' ? row.topic.trim() : '';
    const topic = canonicalByLower.get(rawTopic.toLowerCase());
    if (!topic) continue; // unknown/invented topic — drop the row

    const questionType = TYPE_SYNONYMS[normalizeKey(row.question_type)];
    const difficulty = DIFFICULTY_SYNONYMS[normalizeKey(row.difficulty)];
    const bloomLevel = BLOOM_SYNONYMS[normalizeKey(row.bloom_level)];
    if (!questionType || !difficulty || !bloomLevel) continue;

    const count = Math.round(Number(row.count));
    if (!Number.isFinite(count) || count <= 0) continue;

    const key = `${topic}|${questionType}|${difficulty}|${bloomLevel}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count += count;
    } else {
      merged.set(key, { topic, question_type: questionType, difficulty, bloom_level: bloomLevel, count });
    }
  }

  const rows = Array.from(merged.values());
  if (rows.length === 0) {
    throw new Error('The AI proposal contained no usable rows');
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Totals, percentages, validation
// ---------------------------------------------------------------------------

export function tosMarginals(rows: TosRow[]): TosMarginals {
  const m: TosMarginals = {
    totalItems: 0,
    byType: {},
    byDifficulty: {},
    byBloom: {},
    byTopic: {},
  };
  for (const row of rows) {
    if (!Number.isFinite(row.count)) continue;
    m.totalItems += row.count;
    m.byType[row.question_type] = (m.byType[row.question_type] ?? 0) + row.count;
    m.byDifficulty[row.difficulty] = (m.byDifficulty[row.difficulty] ?? 0) + row.count;
    m.byBloom[row.bloom_level] = (m.byBloom[row.bloom_level] ?? 0) + row.count;
    m.byTopic[row.topic] = (m.byTopic[row.topic] ?? 0) + row.count;
  }
  return m;
}

/** Percentage with one decimal — used by the TOS totals panel. */
export function tosPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function compareDimension(
  label: string,
  actual: Record<string, number>,
  target: Partial<Record<string, number>> | undefined,
  warnings: string[]
): void {
  if (!target) return;
  const keys = new Set([...Object.keys(target), ...Object.keys(actual)]);
  const diffs: string[] = [];
  for (const key of keys) {
    const a = actual[key] ?? 0;
    const t = target[key] ?? 0;
    if (a !== t) diffs.push(`${key} ${a} ≠ ${t}`);
  }
  if (diffs.length > 0) {
    warnings.push(
      `${label} differs from the generation config (${diffs.join(', ')}) — approving will update the generation config.`
    );
  }
}

/**
 * Validate a TOS for approval (scope §10: "validate totals and
 * percentages"). Problems block approval; warnings only report divergence
 * from the generation config, which approval re-derives from the TOS.
 */
export function validateTos(rows: TosRow[], targets?: TosValidationTargets): TosValidation {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (rows.length === 0) {
    problems.push('The TOS has no rows — add or generate at least one.');
    return { totalItems: 0, problems, warnings };
  }

  const badRows = rows.filter(
    (r) => !Number.isInteger(r.count) || r.count < 0 || !r.topic || r.count === 0
  );
  if (badRows.length > 0) {
    problems.push(
      'Every row needs a topic and a whole-number count ≥ 1 (empty rows should be deleted).'
    );
  }

  const m = tosMarginals(rows);
  if (m.totalItems <= 0) {
    problems.push('Total item count is 0 — plan at least one item.');
  }

  if (targets) {
    compareDimension('Question types', m.byType, targets.countPerType, warnings);
    compareDimension('Difficulty', m.byDifficulty, targets.difficulty, warnings);
    compareDimension("Bloom's levels", m.byBloom, targets.bloom, warnings);
  }

  return { totalItems: m.totalItems, problems, warnings };
}
