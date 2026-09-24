import type { QuestionType, Difficulty, BloomLevel } from '@/lib/types';

/** One ready-made exam item ready to insert into `question_bank`. */
export interface ParsedExamItem {
  question_type: QuestionType;
  question_text: string;
  difficulty: Difficulty;
  bloom_level: BloomLevel;
  points: number;
  choices?: { choice_key: string; choice_text: string }[];
  correct_choice_key?: string;
  canonical_answer?: string;
}

export interface ParseExamResult {
  items: ParsedExamItem[];
  errors: string[];
}

export interface ParseExamOptions {
  /**
   * Keep items that are missing an answer key (wizard flow lets the creator
   * fill them inline before continuing). Defaults to false (bank/modal skip them).
   */
  allowMissingAnswers?: boolean;
}

function normalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/ /g, ' ')
    .trim();
}

/** "1." / "Q1)" / "12 -" at line start → number, or null. */
function matchQuestionStart(line: string): string | null {
  const m = line.match(/^\s*(?:Q(?:uestion)?\s*)?(\d{1,3})\s*[.)\-–—:]\s*(.*)$/i);
  if (!m) return null;
  // Avoid treating "1990s..." or bare numbers as questions.
  if (m[2] === '' && !/^\s*(?:Q(?:uestion)?\s*)?\d+\s*[.)\-–—:]\s*$/i.test(line)) return null;
  return m[1];
}

/** "A) text" / "a. text" / "(A) text" → key, text. */
function matchChoice(line: string): { key: string; text: string } | null {
  const m = line.match(/^\s*[\(\[]?([A-Fa-f])[\)\].\-–—:]\s+(.+?)\s*$/);
  if (!m) return null;
  return { key: m[1].toUpperCase(), text: m[2].trim() };
}

function matchAnswerLine(line: string): string | null {
  const patterns = [
    /^\s*(?:correct\s+)?answer\s*[:\-–—]\s*(.+)$/i,
    /^\s*(?:ans|key)\s*[:\-–—]\s*(.+)$/i,
    /^\s*\*\s*(.+)$/,
  ];
  for (const re of patterns) {
    const m = line.match(re);
    if (m) return m[1].trim();
  }
  return null;
}

function stripNumberPrefix(line: string): string {
  return line.replace(/^\s*(?:Q(?:uestion)?\s*)?\d{1,3}\s*[.)\-–—:]\s*/i, '').trim();
}

function inferType(
  choices: { choice_key: string; choice_text: string }[],
  answer: string | null
): { type: QuestionType; correctKey?: string; canonical?: string } {
  const texts = choices.map((c) => c.choice_text.toLowerCase());
  const onlyTF =
    choices.length === 2 &&
    texts.some((t) => /^(true|t|yes)\b/.test(t)) &&
    texts.some((t) => /^(false|f|no)\b/.test(t));

  if (onlyTF || (!choices.length && answer && /^(true|false|t|f|yes|no)$/i.test(answer.trim()))) {
    let key = 'T';
    if (answer) {
      const a = answer.trim().toLowerCase();
      if (/^(false|f|no)/.test(a)) key = 'F';
      else if (/^(true|t|yes)/.test(a)) key = 'T';
      else {
        const letter = answer.trim().toUpperCase().match(/^[A-F]$/);
        if (letter) key = letter[0] === 'A' ? 'T' : letter[0] === 'B' ? 'F' : key;
      }
    }
    return { type: 'true_false', correctKey: key };
  }

  if (choices.length >= 2) {
    let correctKey: string | undefined;
    if (answer) {
      const a = answer.trim();
      const letter = a.match(/^[\(\[]?([A-Fa-f])[\)\].]?(?:\s|$)/);
      if (letter) correctKey = letter[1].toUpperCase();
      else {
        const byText = choices.find(
          (c) => c.choice_text.trim().toLowerCase() === a.toLowerCase()
        );
        if (byText) correctKey = byText.choice_key;
        else {
          const partial = choices.find((c) =>
            c.choice_text.trim().toLowerCase().includes(a.toLowerCase())
          );
          if (partial) correctKey = partial.choice_key;
        }
      }
    }
    return { type: 'multiple_choice', correctKey };
  }

  if (answer) {
    return { type: 'identification', canonical: answer.replace(/^\(|\)$/g, '').trim() };
  }
  // No choices, no answer → identification without key (importer will warn).
  return { type: 'identification' };
}

function finishItem(
  lines: string[],
  answer: string | null,
  trailingAnswers: Map<string, string>,
  number: string | null,
  errors: string[],
  allowMissing: boolean
): ParsedExamItem | null {
  if (lines.length === 0) return null;

  const choices: { choice_key: string; choice_text: string }[] = [];
  const questionLines: string[] = [];
  let inlineAnswer = answer;

  for (const line of lines) {
    if (!inlineAnswer) {
      const ans = matchAnswerLine(line);
      if (ans) {
        inlineAnswer = ans;
        continue;
      }
    }
    const ch = matchChoice(line);
    if (ch) {
      choices.push({ choice_key: ch.key, choice_text: ch.text });
      continue;
    }
    questionLines.push(line);
  }

  if (!inlineAnswer && number && trailingAnswers.has(number)) {
    inlineAnswer = trailingAnswers.get(number)!;
  }

  const questionText = questionLines.join(' ').replace(/\s+/g, ' ').trim();
  if (!questionText) return null;

  const { type, correctKey, canonical } = inferType(choices, inlineAnswer);

  if (type === 'multiple_choice' && choices.length < 2) {
    errors.push(`Skipped “${questionText.slice(0, 60)}…”: multiple-choice needs ≥2 choices.`);
    return null;
  }
  if (type === 'multiple_choice' && !correctKey) {
    if (!allowMissing) {
      errors.push(`Skipped “${questionText.slice(0, 60)}…”: no answer key found.`);
      return null;
    }
  }
  if (type === 'identification' && !canonical) {
    if (!allowMissing) {
      errors.push(`Skipped “${questionText.slice(0, 60)}…”: identification needs an answer.`);
      return null;
    }
  }

  const item: ParsedExamItem = {
    question_type: type,
    question_text: questionText,
    difficulty: 'moderate',
    bloom_level: 'understand',
    points: 1,
  };

  if (type === 'multiple_choice') {
    item.choices = choices;
    item.correct_choice_key = correctKey;
  } else if (type === 'true_false') {
    item.choices = [
      { choice_key: 'T', choice_text: 'True' },
      { choice_key: 'F', choice_text: 'False' },
    ];
    // Default to True only when the key must be complete; otherwise leave blank for inline entry.
    item.correct_choice_key = correctKey ?? (allowMissing ? undefined : 'T');
  } else {
    item.canonical_answer = canonical;
  }

  return item;
}

/** Parse a trailing answer-key block: "1. B", "2) Answer: Paris", etc. */
function parseTrailingKey(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text.split('\n');
  let inKey = false;

  for (const line of lines) {
    if (/^\s*(answer\s*key|key\s*to\s*answers|answers)\s*[:\-–—]?\s*$/i.test(line.trim())) {
      inKey = true;
      continue;
    }
    // Dense key lines: "1. A  2. B  3. C"
    if (inKey || /^\s*\d+\s*[.)]\s*[A-Fa-f1]\b/.test(line)) {
      const re = /(\d{1,3})\s*[.)\-–—:]\s*(?:answer\s*[:\-–—]?\s*)?([A-Fa-f](?![A-Za-z])|[A-Za-z][A-Za-z\s,/-]{0,40})/g;
      let m: RegExpExecArray | null;
      let any = false;
      while ((m = re.exec(line))) {
        const num = m[1];
        const val = m[2].trim().replace(/[.,;]+$/, '');
        if (val) {
          map.set(num, val);
          any = true;
        }
      }
      if (any) inKey = true;
    }
  }
  return map;
}

/**
 * Parse a ready-made exam (plain text) into bank items.
 *
 * Supports:
 * - Numbered questions with A–F choices and “Answer: B” / “Ans: Paris”
 * - True/False questions
 * - A trailing answer-key section (“Answer Key: 1. A 2. C …”)
 * - Simple CSV: question,type,choiceA…,answer
 */
export function parseExamText(raw: string, options: ParseExamOptions = {}): ParseExamResult {
  const allowMissing = options.allowMissingAnswers === true;
  const text = normalize(raw);
  const errors: string[] = [];
  const items: ParsedExamItem[] = [];

  if (!text) {
    return { items, errors: ['Nothing to parse.'] };
  }

  // CSV path (comma-separated, at least 3 columns).
  const csvLines = text.split('\n').filter((l) => l.trim());
  const looksCsv =
    csvLines.length > 1 &&
    csvLines[0].split(',').length >= 3 &&
    csvLines.filter((l) => l.includes(',')).length > csvLines.length * 0.7;

  if (looksCsv) {
    for (let i = 0; i < csvLines.length; i++) {
      const cols = parseCsvLine(csvLines[i]);
      if (cols.length < 2) continue;
      if (i === 0 && /^(question|q|item|text)$/i.test(cols[0].trim())) continue;

      // Formats:
      //   question, answer
      //   question, A, B, C, D, answer
      //   question, mcq, A-text, B-text, ..., answer
      const questionText = cols[0].trim();
      if (!questionText) continue;

      let typeHint = '';
      let rest = cols.slice(1);
      if (rest.length && /^(mcq|multiple[_ ]choice|tf|true[_ ]false|id|identification)$/i.test(rest[0].trim())) {
        typeHint = rest[0].trim().toLowerCase();
        rest = rest.slice(1);
      }

      const answer = rest.length ? rest[rest.length - 1].trim() : '';
      const choiceTexts = rest.slice(0, -1).map((c) => c.trim()).filter(Boolean);

      if (choiceTexts.length >= 2) {
        const choices = choiceTexts.map((t, idx) => ({
          choice_key: String.fromCharCode(65 + idx),
          choice_text: t,
        }));
        const { type, correctKey, canonical } = inferType(choices, answer);
        if (type === 'true_false') {
          items.push({
            question_type: 'true_false',
            question_text: questionText,
            difficulty: 'moderate',
            bloom_level: 'understand',
            points: 1,
            choices: [
              { choice_key: 'T', choice_text: 'True' },
              { choice_key: 'F', choice_text: 'False' },
            ],
            correct_choice_key: correctKey ?? (allowMissing ? undefined : 'T'),
          });
        } else if (correctKey) {
          items.push({
            question_type: 'multiple_choice',
            question_text: questionText,
            difficulty: 'moderate',
            bloom_level: 'understand',
            points: 1,
            choices,
            correct_choice_key: correctKey,
          });
        } else if (canonical || answer) {
          items.push({
            question_type: 'identification',
            question_text: questionText,
            difficulty: 'moderate',
            bloom_level: 'understand',
            points: 1,
            canonical_answer: canonical ?? answer,
          });
        } else if (allowMissing) {
          items.push({
            question_type: 'multiple_choice',
            question_text: questionText,
            difficulty: 'moderate',
            bloom_level: 'understand',
            points: 1,
            choices,
          });
        } else {
          errors.push(`Row ${i + 1}: no answer key.`);
        }
      } else if (answer || typeHint === 'id' || typeHint === 'identification' || allowMissing) {
        if (!answer && !allowMissing) {
          errors.push(`Row ${i + 1}: identification without answer.`);
          continue;
        }
        items.push({
          question_type: 'identification',
          question_text: questionText,
          difficulty: 'moderate',
          bloom_level: 'understand',
          points: 1,
          canonical_answer: answer || undefined,
        });
      } else {
        errors.push(`Row ${i + 1}: could not determine type/answer.`);
      }
    }

    if (items.length > 0) return { items, errors };
  }

  // Text path: split on numbered question starts.
  const trailingAnswers = parseTrailingKey(text);

  // Remove answer-key section from body so those lines are not treated as questions.
  let body = text;
  const keyMatch = body.match(
    /^\s*(?:answer\s*key|key\s*to\s*answers)\s*[:\-–—]?\s*$([\s\S]*)$/im
  );
  if (keyMatch && keyMatch.index !== undefined) {
    body = body.slice(0, keyMatch.index);
  }

  const lines = body.split('\n');
  type Block = { number: string | null; lines: string[]; answer: string | null };
  const blocks: Block[] = [];
  let current: Block | null = null;
  let looseAnswer: string | null = null;

  for (const line of lines) {
    const qNum = matchQuestionStart(line);
    if (qNum) {
      if (current) blocks.push(current);
      const rest = stripNumberPrefix(line);
      current = { number: qNum, lines: rest ? [rest] : [], answer: null };
      looseAnswer = null;
      continue;
    }

    const ans = matchAnswerLine(line);
    if (ans) {
      if (current) current.answer = ans;
      else looseAnswer = ans;
      continue;
    }

    if (!current) {
      // Content before first question number — ignore headers unless loose answer.
      continue;
    }
    if (line.trim() === '') {
      // Blank line ends a question only if we already have choices/question text.
      if (current.lines.length > 0 && current.lines.some((l) => matchChoice(l))) {
        blocks.push(current);
        current = null;
      }
      continue;
    }
    current.lines.push(line);
  }
  if (current) blocks.push(current);
  if (looseAnswer && blocks.length === 1 && !blocks[0].answer) {
    blocks[0].answer = looseAnswer;
  }

  // Fallback: no numbered questions but has "Answer:" + choices — treat whole text as one stream split by Answer lines.
  if (blocks.length === 0 && /answer\s*[:\-–—]/i.test(text)) {
    const chunks = text.split(/(?=^\s*(?:\d+\s*[.)\-–—:]|[A-F]\s*[.)\-–—:]))/im);
    for (const chunk of chunks) {
      if (!chunk.trim()) continue;
      const cLines = chunk.split('\n');
      let answer: string | null = null;
      const kept: string[] = [];
      for (const l of cLines) {
        const a = matchAnswerLine(l);
        if (a) answer = a;
        else kept.push(l);
      }
      if (kept.some((l) => matchChoice(l) || matchQuestionStart(l))) {
        blocks.push({ number: null, lines: kept, answer });
      }
    }
  }

  for (const block of blocks) {
    const item = finishItem(block.lines, block.answer, trailingAnswers, block.number, errors, allowMissing);
    if (item) items.push(item);
  }

  // Apply optional trailing tags: "Difficulty: easy" as last line of a block was already folded into text — skip.

  if (items.length === 0 && errors.length === 0) {
    errors.push(
      'No questions found. Use numbered questions with A–D choices and “Answer: B”, or CSV rows.'
    );
  }

  return { items, errors };
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** True when the item still needs an answer key (missing letter or canonical answer). */
export function itemMissingAnswer(item: ParsedExamItem): boolean {
  if (item.question_type === 'identification') return !(item.canonical_answer ?? '').trim();
  return !item.correct_choice_key?.trim();
}

/**
 * Parse a key-only file/text: lines or dense runs of “1. B”, “2 - Paris”, “3) Answer: C”.
 * Does not require question text — used by the optional second file in the upload wizard.
 */
export function parseAnswerKey(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  const text = normalize(raw);
  if (!text) return map;

  for (const line of text.split('\n')) {
    if (!/\d\s*[.)\-–—:]/.test(line)) continue;
    const re = /(\d{1,3})\s*[.)\-–—:]\s*(?:answer\s*[:\-–—]?\s*)?(.+?)(?=\s+\d{1,3}\s*[.)\-–—:]|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const num = m[1];
      const val = m[2].trim().replace(/[.;,]+$/, '').replace(/^[([]|[)\]]$/g, '').trim();
      if (val && !map.has(num)) map.set(num, val);
    }
  }
  return map;
}

/** Apply a raw key value (letter / True-False / free text) onto one parsed item. */
function applyKeyToItem(item: ParsedExamItem, rawVal: string): boolean {
  const v = rawVal.trim();
  if (!v) return false;

  if (item.question_type === 'identification') {
    item.canonical_answer = v;
    return true;
  }

  if (item.question_type === 'true_false') {
    const low = v.toLowerCase();
    if (/^(true|t|yes)\b/.test(low)) {
      item.correct_choice_key = 'T';
      return true;
    }
    if (/^(false|f|no)\b/.test(low)) {
      item.correct_choice_key = 'F';
      return true;
    }
    const letter = v.match(/^[\(\[]?([A-Fa-f])[\)\].]?$/);
    if (letter) {
      const key = letter[1].toUpperCase();
      if (key === 'A' || key === 'T') {
        item.correct_choice_key = 'T';
        return true;
      }
      if (key === 'B' || key === 'F') {
        item.correct_choice_key = 'F';
        return true;
      }
    }
    return false;
  }

  const choices = item.choices ?? [];
  const letter = v.match(/^[\(\[]?([A-Fa-f])[\)\].]?$/);
  if (letter) {
    const key = letter[1].toUpperCase();
    if (choices.some((c) => c.choice_key === key)) {
      item.correct_choice_key = key;
      return true;
    }
  }
  const lower = v.toLowerCase();
  const byText = choices.find((c) => c.choice_text.trim().toLowerCase() === lower);
  if (byText) {
    item.correct_choice_key = byText.choice_key;
    return true;
  }
  const partial = choices.find((c) => c.choice_text.trim().toLowerCase().includes(lower));
  if (partial) {
    item.correct_choice_key = partial.choice_key;
    return true;
  }
  if (letter && choices.length === 0) {
    item.correct_choice_key = letter[1].toUpperCase();
    return true;
  }
  return false;
}

export interface MergeAnswerKeyResult {
  items: ParsedExamItem[];
  applied: number;
  /** 1-based item numbers still missing a key after merge. */
  stillMissing: number[];
}

/**
 * Fill missing answers on parsed items from a separate key text (1-based item number → answer).
 * Items that already have a key are left unchanged.
 */
export function mergeAnswerKeyFile(items: ParsedExamItem[], keyText: string): MergeAnswerKeyResult {
  const keyMap = parseAnswerKey(keyText);
  let applied = 0;
  const stillMissing: number[] = [];

  const next = items.map((item, i) => {
    if (!itemMissingAnswer(item)) return item;
    const num = String(i + 1);
    const val = keyMap.get(num);
    if (!val) {
      stillMissing.push(i + 1);
      return item;
    }
    const copy: ParsedExamItem = { ...item };
    if (applyKeyToItem(copy, val) && !itemMissingAnswer(copy)) {
      applied += 1;
      return copy;
    }
    stillMissing.push(i + 1);
    return item;
  });

  return { items: next, applied, stillMissing };
}

/** Client-side file → text for .txt/.md/.csv (DOCX/PDF go through the server). */
export function isClientExtractable(fileName: string): boolean {
  return /\.(txt|md|csv)$/i.test(fileName);
}
