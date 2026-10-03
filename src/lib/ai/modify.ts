// ---------------------------------------------------------------------------
// AI Modification Assistant — scope §16.
// ---------------------------------------------------------------------------
// "AI changes SHALL be proposed, not silently committed. Faculty can review
// diffs and accept/reject proposed modifications."
//
// Pure prompt/parse module with zero imports (node --test friendly, like
// tos.ts / recommendation.ts). Division of responsibility:
//   * this module — what to ask, how to read proposals, hard validation of
//     every field against what updateQuestion/addQuestion will accept;
//   * assessments/actions.ts — auth, loading question context, the provider
//     call, logAiUsage, and the apply step (per-proposal calls to
//     updateQuestion/addQuestion/deleteQuestion, including the locked-version
//     → createNewVersion path);
//   * AiModifyModal — the prompt → diff → accept/reject → apply UI.
//
// A proposal NEVER touches the database by itself; only the faculty's Apply
// does.

export type ModifyOp = 'update' | 'add' | 'delete';

export interface ModifyChoice {
  choice_key: string;
  choice_text: string;
}

export interface ModifyFields {
  question_type?: 'multiple_choice' | 'identification' | 'true_false';
  question_text?: string;
  difficulty?: 'easy' | 'moderate' | 'difficult';
  bloom_level?: 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
  points?: number;
  choices?: ModifyChoice[];
  correct_choice_key?: string;
  canonical_answer?: string;
  accepted_answers?: string[];
}

export interface ModifyProposal {
  op: ModifyOp;
  /** Required for update/delete; null for add. */
  question_id: string | null;
  fields: ModifyFields;
  rationale: string;
}

export interface DroppedProposal {
  reason: string;
  question_id?: string;
  op?: string;
}

/** Question shape handed to the model (ids are the model's handle). */
export interface ModifyQuestionContext {
  id: string;
  position: number;
  question_type: string;
  question_text: string;
  difficulty: string;
  bloom_level: string;
  points: number;
  choices?: { choice_key: string; choice_text: string; correct?: boolean }[];
  canonical_answer?: string | null;
}

const TYPE_SYNONYMS: Record<string, ModifyFields['question_type']> = {
  multiple_choice: 'multiple_choice',
  multiplechoice: 'multiple_choice',
  mcq: 'multiple_choice',
  identification: 'identification',
  id: 'identification',
  true_false: 'true_false',
  truefalse: 'true_false',
  tf: 'true_false',
};

const DIFFICULTY_SYNONYMS: Record<string, ModifyFields['difficulty']> = {
  easy: 'easy',
  moderate: 'moderate',
  medium: 'moderate',
  difficult: 'difficult',
  hard: 'difficult',
};

const BLOOM_SYNONYMS: Record<string, ModifyFields['bloom_level']> = {
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

const MAX_POINTS = 100;

function normalizeKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function buildModifyPrompt(input: {
  questions: ModifyQuestionContext[];
  instruction: string;
}): { system: string; user: string } {
  const system = [
    'You are an assessment-editing assistant for a faculty member.',
    'Given the current questions and one instruction, propose the MINIMAL set of changes that fulfills it.',
    'Reply with ONLY one JSON object — no prose, no code fences:',
    '{"proposals":[{"op":"update"|"add"|"delete","question_id":"<existing id or null for add>","fields":{...},"rationale":"<one sentence>"}]}',
    'Rules:',
    '- For "update", set question_id to an id from the list and include ONLY the fields that change.',
    '- Never change question_type in an update — propose a delete and an add instead.',
    '- multiple_choice/true_false updates that include "choices" MUST also include "correct_choice_key" naming exactly one of the new choice_keys.',
    '- identification updates use "canonical_answer" (and optionally "accepted_answers").',
    '- For "add", include question_type and question_text; difficulty/bloom_level/points optional (defaults: moderate/understand/1).',
    '- multiple_choice adds need "choices" (2-4) and "correct_choice_key"; identification adds need "canonical_answer".',
    '- Propose nothing if the instruction cannot be fulfilled with these operations.',
  ].join(' ');

  const lines = [`Instruction: ${input.instruction}`, '', 'Current questions:'];
  for (const q of input.questions) {
    const head = `#${q.position} id=${q.id} [${q.question_type}] difficulty=${q.difficulty} bloom=${q.bloom_level} points=${q.points}`;
    lines.push(`${head} ${truncate(q.question_text, 400)}`);
    if (q.choices && q.choices.length > 0) {
      lines.push(
        `  choices: ${q.choices
          .map((c) => `${c.choice_key}) ${truncate(c.choice_text, 150)}${c.correct ? ' (correct)' : ''}`)
          .join(' | ')}`
      );
    }
    if (q.canonical_answer) {
      lines.push(`  answer: ${truncate(q.canonical_answer, 200)}`);
    }
  }

  return { system, user: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

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

function parseChoices(raw: unknown): ModifyChoice[] | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const choices: ModifyChoice[] = [];
  const seenKeys = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return null;
    const c = entry as Record<string, unknown>;
    const key = typeof c.choice_key === 'string' ? c.choice_key.trim() : '';
    const text = typeof c.choice_text === 'string' ? c.choice_text.trim() : '';
    if (!key || !text || seenKeys.has(key)) return null;
    seenKeys.add(key);
    choices.push({ choice_key: key, choice_text: text });
  }
  return choices;
}

/**
 * Validate one proposal's fields against exactly what updateQuestion /
 * addQuestion accept. Returns the sanitized fields, or null (with `reason`)
 * when the proposal cannot be applied safely.
 */
function sanitizeFields(
  raw: unknown,
  op: 'update' | 'add',
  currentType?: string
): { fields: ModifyFields; reason?: undefined } | { fields?: undefined; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { reason: 'fields is not an object' };
  }
  const f = raw as Record<string, unknown>;
  const fields: ModifyFields = {};

  if (typeof f.question_text === 'string' && f.question_text.trim()) {
    fields.question_text = f.question_text.trim();
  } else if ('question_text' in f) {
    return { reason: 'question_text is empty' };
  }

  if ('difficulty' in f) {
    const d = DIFFICULTY_SYNONYMS[normalizeKey(f.difficulty)];
    if (!d) return { reason: `unknown difficulty "${String(f.difficulty)}"` };
    fields.difficulty = d;
  }
  if ('bloom_level' in f) {
    const b = BLOOM_SYNONYMS[normalizeKey(f.bloom_level)];
    if (!b) return { reason: `unknown bloom level "${String(f.bloom_level)}"` };
    fields.bloom_level = b;
  }
  if ('points' in f) {
    const p = Math.round(Number(f.points));
    if (!Number.isFinite(p) || p < 1 || p > MAX_POINTS) {
      return { reason: `points out of range: ${String(f.points)}` };
    }
    fields.points = p;
  }

  if ('question_type' in f) {
    // Type changes are deliberately unsupported (answer-key semantics change
    // with the type) — the prompt forbids them; drop rather than mis-apply.
    const t = TYPE_SYNONYMS[normalizeKey(f.question_type)];
    if (op === 'add') {
      if (!t) return { reason: `unknown question_type "${String(f.question_type)}"` };
      fields.question_type = t;
    } else if (t && currentType && t !== currentType) {
      return { reason: 'question_type changes are not supported in updates' };
    } else if (t && !currentType) {
      return { reason: 'cannot confirm question_type — proposal dropped' };
    } else if (t) {
      fields.question_type = t;
    }
  }

  const hasChoices = 'choices' in f;
  if (hasChoices) {
    const choices = parseChoices(f.choices);
    if (!choices) return { reason: 'choices need 2+ unique non-empty entries' };
    const correctKey =
      typeof f.correct_choice_key === 'string' && f.correct_choice_key.trim()
        ? f.correct_choice_key.trim()
        : null;
    if (!correctKey || !choices.some((c) => c.choice_key === correctKey)) {
      return { reason: 'choices are missing a valid correct_choice_key' };
    }
    fields.choices = choices;
    fields.correct_choice_key = correctKey;
  } else if (typeof f.correct_choice_key === 'string' && f.correct_choice_key.trim()) {
    // A correct key without the choice list would delete every choice.
    return { reason: 'correct_choice_key without choices' };
  }

  if ('canonical_answer' in f) {
    const canonical = typeof f.canonical_answer === 'string' ? f.canonical_answer.trim() : '';
    if (!canonical) return { reason: 'canonical_answer is empty' };
    fields.canonical_answer = canonical;
    if (Array.isArray(f.accepted_answers)) {
      fields.accepted_answers = f.accepted_answers
        .filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        .map((a) => a.trim());
    }
  }

  if (Object.keys(fields).length === 0) {
    return { reason: 'no usable fields' };
  }

  // Type-appropriate answer-key requirements for adds.
  if (op === 'add') {
    if (!fields.question_type) fields.question_type = 'multiple_choice';
    const type = fields.question_type;
    if (type === 'multiple_choice' && !fields.choices) {
      return { reason: 'multiple_choice adds need choices with a correct key' };
    }
    if (type === 'identification' && !fields.canonical_answer) {
      return { reason: 'identification adds need canonical_answer' };
    }
  }

  return { fields };
}

/**
 * Parse the model's reply into validated proposals. Unknown question ids,
 * unknown ops and unsafe field combinations are dropped with a reason the UI
 * can show the faculty — the model never gets to target a question outside
 * `validQuestionIds`. `currentTypes` (id → question_type) powers the
 * "updates cannot change question_type" guard. Throws only when the reply
 * itself is unreadable.
 */
export function parseModifyProposals(
  raw: string,
  validQuestionIds: string[],
  currentTypes: Record<string, string> = {}
): { proposals: ModifyProposal[]; dropped: DroppedProposal[] } {
  const cleaned = unwrapJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('AI response is not valid JSON');
  }

  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { proposals?: unknown }).proposals)
      ? (parsed as { proposals: unknown[] }).proposals
      : null;
  if (!list) {
    throw new Error('AI response does not contain a proposals array');
  }

  const validIds = new Set(validQuestionIds);
  const proposals: ModifyProposal[] = [];
  const dropped: DroppedProposal[] = [];
  const seen = new Set<string>();

  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) {
      dropped.push({ reason: 'proposal is not an object' });
      continue;
    }
    const p = entry as Record<string, unknown>;
    const op = normalizeKey(p.op) as ModifyOp;
    if (op !== 'update' && op !== 'add' && op !== 'delete') {
      dropped.push({ reason: `unknown op "${String(p.op)}"` });
      continue;
    }

    const questionId =
      typeof p.question_id === 'string' && p.question_id.trim() ? p.question_id.trim() : null;
    if (op !== 'add' && (!questionId || !validIds.has(questionId))) {
      dropped.push({ reason: 'references a question that does not exist', question_id: questionId ?? undefined, op });
      continue;
    }
    if (op === 'add' && questionId && !validIds.has(questionId)) {
      dropped.push({ reason: 'add proposals must not carry a question_id', question_id: questionId, op });
      continue;
    }

    const dedupeKey = `${op}|${questionId ?? 'new'}|${JSON.stringify(p.fields ?? {})}`;
    if (seen.has(dedupeKey)) {
      dropped.push({ reason: 'duplicate proposal', question_id: questionId ?? undefined, op });
      continue;
    }
    seen.add(dedupeKey);

    if (op === 'delete') {
      proposals.push({ op, question_id: questionId, fields: {}, rationale: stringRationale(p.rationale) });
      continue;
    }

    const result = sanitizeFields(p.fields, op, questionId ? currentTypes[questionId] : undefined);
    if (result.fields === undefined) {
      dropped.push({ reason: result.reason ?? 'invalid fields', question_id: questionId ?? undefined, op });
      continue;
    }
    proposals.push({ op, question_id: questionId, fields: result.fields, rationale: stringRationale(p.rationale) });
  }

  return { proposals, dropped };
}

function stringRationale(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 400) : '';
}
