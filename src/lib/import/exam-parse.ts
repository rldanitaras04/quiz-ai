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

/** "A) text" / "a. text" / "(A) text" / "A.text" → lettered choice. */
function matchLetterChoice(line: string): { key: string; text: string } | null {
  // Dot/bracket markers allow tight spacing ("A.text"); dash/colon require a
  // space so hyphenated words ("A-level") never match.
  const m = line.match(/^\s*[\(\[]?([A-Fa-f])(?:[\)\].]\s*|[\-–—:]\s+)(.+?)\s*$/);
  if (!m) return null;
  return { key: m[1].toUpperCase(), text: m[2].trim() };
}

/** "1. text" / "2) text" / "(3) text" → numbered choice (single digit 1–9). */
function matchNumberedChoice(line: string): { num: number; text: string } | null {
  const m = line.match(/^\s*[\(\[]?([1-9])(?:[\)\].]\s*|[\-–—:]\s+)(.+?)\s*$/);
  if (!m) return null;
  return { num: parseInt(m[1], 10), text: m[2].trim() };
}

/** "• text" / "‣ text" → bullet choice. */
function matchBulletChoice(line: string): string | null {
  const m = line.match(/^\s*[•▪◦‣]\s+(.+?)\s*$/);
  return m ? m[1].trim() : null;
}

interface ChoiceMatch {
  /** Letter key when the source was lettered (A–F). */
  key?: string;
  /** Original number when the source was numbered (1–9). */
  num?: number;
  text: string;
}

function matchChoice(line: string): ChoiceMatch | null {
  const letter = matchLetterChoice(line);
  if (letter) return { key: letter.key, text: letter.text };
  const numbered = matchNumberedChoice(line);
  if (numbered) return { num: numbered.num, text: numbered.text };
  const bullet = matchBulletChoice(line);
  if (bullet) return { text: bullet };
  return null;
}

/**
 * Split a line that packs several choices onto one row — a common artifact of
 * DOCX/PDF extraction, e.g. "A. dog  B. cat  C. bird", "1. dog 2. cat" or
 * "• dog • cat". Segments keep their markers so matchChoice can recover the
 * original keys. Numbered runs must start at 1 and increment (so prose like
 * "1990. The …" never splits); lettered/bulleted runs just need ≥2 markers.
 * Returns null otherwise.
 */
function splitInlineChoices(line: string): { lead: string; choices: string[] } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const matches = [
    ...trimmed.matchAll(/[•▪◦‣]\s+|(?:[\(\[]?[A-Fa-f]|[\(\[]?[1-9])[)\].\-–—:]\s+/g),
  ];
  if (matches.length < 2) return null;

  const kindOf = (m: string): 'bullet' | 'num' | 'letter' => {
    if (/^[•▪◦‣]/.test(m)) return 'bullet';
    const bare = m.replace(/[[\]()]/g, '');
    return /^[0-9]/.test(bare) ? 'num' : 'letter';
  };
  const kinds = matches.map((m) => kindOf(m[0]));
  const firstKind = kinds[0];
  if (kinds.some((k) => k !== firstKind)) return null;
  const firstIndex = matches[0].index ?? 0;
  const lead = trimmed.slice(0, firstIndex).trim();
  // Lettered/numbered runs may sit at the line start or follow a
  // question-like lead ("What is 2+2? 1. 3 2. 4"); bare prose leads
  // ("…2021. X 2022. Y") never split. Bullets are unambiguous anywhere.
  if (firstKind !== 'bullet' && firstIndex !== 0 && !/[?:.]$/.test(lead)) return null;
  if (firstKind === 'num') {
    // Numbered inline run: must count 1, 2, 3, …
    const nums = matches.map((m) => parseInt(m[0].replace(/[[\]()]/g, ''), 10));
    if (nums[0] !== 1 || !nums.every((n, i) => n === i + 1)) return null;
  }

  const choices: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? trimmed.length) : trimmed.length;
    const text = trimmed.slice(start, end).trim();
    if (!text) return null;
    choices.push(text);
  }
  return { lead, choices };
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
      if (!correctKey) {
        // "Answer: 2" → the second choice (numbered source documents).
        const num = a.match(/^\(?(\d{1,2})\)?$/);
        if (num) {
          const idx = parseInt(num[1], 10) - 1;
          if (idx >= 0 && idx < choices.length) correctKey = choices[idx].choice_key;
        }
      }
      if (!correctKey) {
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

  const rawChoices: ChoiceMatch[] = [];
  const questionLines: string[] = [];
  let inlineAnswer = answer;

  const pushLine = (line: string) => {
    if (!inlineAnswer) {
      const ans = matchAnswerLine(line);
      if (ans) {
        inlineAnswer = ans;
        return;
      }
    }
    const inline = splitInlineChoices(line);
    if (inline) {
      if (inline.lead) questionLines.push(inline.lead);
      for (const segment of inline.choices) {
        const ch = matchChoice(segment);
        if (ch) rawChoices.push(ch);
        else questionLines.push(segment);
      }
      return;
    }
    const ch = matchChoice(line);
    if (ch) {
      rawChoices.push(ch);
      return;
    }
    questionLines.push(line);
  };

  for (const line of lines) {
    let text = line;
    if (!inlineAnswer) {
      // "What is X? A. foo B. bar Answer: bar" — the answer sits at the end of
      // a line that also carries choices (never at the very start, which the
      // normal answer-line path already handles).
      const trailing = line.match(
        /^(?!\s*(?:correct\s+)?answer\b)(.+?)\s+(?:correct\s+)?answer\s*[:\-–—]\s*(\S.*)$/i
      );
      if (trailing) {
        inlineAnswer = trailing[2].trim();
        text = trailing[1];
      }
    }
    pushLine(text);
  }

  if (!inlineAnswer && number && trailingAnswers.has(number)) {
    inlineAnswer = trailingAnswers.get(number)!;
  }

  const questionText = questionLines.join(' ').replace(/\s+/g, ' ').trim();
  if (!questionText) {
    errors.push('Skipped an item with no question text.');
    return null;
  }

  // Numbered/bulleted sources are re-keyed A, B, C… by position so every
  // downstream consumer (UI labels, answer resolution) keeps letter keys.
  const needsLetterKeys = rawChoices.some((c) => c.key === undefined);
  const choices = needsLetterKeys
    ? rawChoices.map((c, i) => ({ choice_key: String.fromCharCode(65 + i), choice_text: c.text }))
    : rawChoices.map((c) => ({ choice_key: c.key as string, choice_text: c.text }));

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

  for (let line of lines) {
    if (/^\s*(answer\s*key|key\s*to\s*answers|answers)\s*[:\-–—]?\s*$/i.test(line.trim())) {
      inKey = true;
      continue;
    }
    // Inline header: "Answer Key: 1. A 2. B 3. C" on one line.
    const inlineHeader = line.match(/^\s*(?:answer\s*key|key\s*to\s*answers|answers)\s*[:\-–—]\s*(\S.*)$/i);
    if (inlineHeader) {
      inKey = true;
      line = inlineHeader[1];
    }
    // Dense key lines: "1. A  2. B  3. C" (letters or bare numbers)
    if (inKey || /^\s*\d{1,3}\s*[.)\-–—:]\s*(?:answer\s*[:\-–—]?\s*)?(?:[A-Fa-f](?![A-Za-z])|\d)/.test(line)) {
      const re = /(\d{1,3})\s*[.)\-–—:]\s*(?:answer\s*[:\-–—]?\s*)?([A-Fa-f](?![A-Za-z])|[A-Za-z][A-Za-z\s,/-]{0,40}|\d{1,4}(?!\d))/g;
      // Bare-digit values are only trusted inside a key section or on lines
      // that are keys only — so a question like "1. 5 kingdoms" never becomes
      // an answer key.
      const keysOnly = /^\s*(?:\d{1,3}\s*[.)\-–—:]\s*(?:answer\s*[:\-–—]?\s*)?(?:[A-Fa-f](?![A-Za-z])|\d{1,4})\s*)+$/i.test(line);
      let m: RegExpExecArray | null;
      let any = false;
      while ((m = re.exec(line))) {
        const num = m[1];
        const val = m[2].trim().replace(/[.,;]+$/, '');
        if (!val) continue;
        if (/^\d+$/.test(val) && !inKey && !keysOnly) continue;
        map.set(num, val);
        any = true;
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
 * - Numbered questions with lettered (A–F), numbered (1–9) or bulleted choices
 *   and “Answer: B” / “Answer: 2” / “Ans: Paris”
 * - Choices packed onto one row (“A. dog  B. cat  C. bird”), common in DOCX/PDF
 * - True/False questions
 * - A trailing answer-key section, with or without an “Answer Key:” header
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

  // Remove answer-key section from body so those lines are not treated as
  // questions — handles both a header line and an inline header with keys
  // on the same line ("Answer Key: 1. A 2. B").
  let body = text;
  const keyMatch = body.match(
    /^\s*(?:answer\s*key|key\s*to\s*answers)(?:\s*[:\-–—]\s*|\s*$)([\s\S]*)$/im
  );
  if (keyMatch && keyMatch.index !== undefined) {
    body = body.slice(0, keyMatch.index);
  }

  // Strip a trailing answer-key run even without a header ("1. B 2. C 3. A"
  // as the final lines) so key rows never become fake questions. Headerless
  // stripping only trusts uppercase A–F values (the key convention), on ≥2
  // lines or one dense line — so choice lines like "4. A"/"3. e" or numeric
  // choice texts never get eaten.
  const keyToken = String.raw`\s*\d{1,3}\s*[.)\-–—:]\s*(?:[Aa]nswer\s*[:\-–—]?\s*)?[A-F](?![A-Za-z])`;
  const keyRunRe = new RegExp(`^(?:${keyToken})+$`);
  {
    const bodyLines = body.split('\n');
    let end = bodyLines.length;
    let run = 0;
    let dense = false;
    while (end > 0 && keyRunRe.test(bodyLines[end - 1])) {
      if ((bodyLines[end - 1].match(/\d{1,3}\s*[.)\-–—:]/g) ?? []).length >= 2) dense = true;
      run++;
      end--;
    }
    if (run >= 2 || dense) body = bodyLines.slice(0, end).join('\n');
  }

  const lines = body.split('\n');
  type Block = {
    number: string | null;
    lines: string[];
    answer: string | null;
    /** Last numbered-choice value accepted in this block (run tracking). */
    choiceRunLast: number | null;
    /** A "1." choice was seen — a second "1." starts a new (sectioned) question. */
    seenChoice1: boolean;
  };
  const blocks: Block[] = [];
  let current: Block | null = null;
  let looseAnswer: string | null = null;

  /**
   * Disambiguate "2. …" inside an active block: it is a numbered CHOICE when
   * it continues the choice run or sits at/below the question's own number.
   * It is the NEXT QUESTION when the block already has its answer, the line
   * reads like a question ("…?"), or the number moves past the question
   * sequence. Blank lines end blocks separately below.
   *
   * The hard case is when the run continuation equals the next question
   * number (Q1's choice "2." vs question "2."). There the immediate next
   * line decides: another numbered line that continues the run → choice;
   * a blank or an answer line → choice; "1." or anything else → question.
   * Defaulting to question on end-of-doc keeps mistakes visible (a skipped
   * item surfaces as an import error) instead of silently swallowing text.
   */
  const isChoiceLine = (block: Block, n: number, rawLine: string, idx: number): boolean => {
    if (block.answer !== null) return false;
    if (/\?\s*$/.test(rawLine)) return false;
    if (n === 1 && block.seenChoice1) return false; // sectioned restart

    const run = block.choiceRunLast;
    const qNum = block.number ? parseInt(block.number, 10) : null;
    if (run !== null && n === run + 1) {
      if (qNum !== null && n === qNum + 1) {
        const next = lines[idx + 1];
        if (next === undefined) return false; // end of doc → question
        if (!next.trim()) return true; // blank ends the block after a choice
        if (matchAnswerLine(next)) return true;
        const m = matchQuestionStart(next);
        if (m) {
          const mn = parseInt(m, 10);
          if (mn === 1) return false; // next question's "1." choice or sectioned stem
          if (mn === n || mn === n + 1) return true; // run continues / next question shares number
          return false;
        }
        return false; // prose follows → this line was the question stem
      }
      return true; // unambiguous run continuation
    }
    if (n === 1) return true;
    if (qNum !== null && n <= qNum) return true;
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qNum = matchQuestionStart(line);
    if (qNum) {
      const n = parseInt(qNum, 10);
      if (current && isChoiceLine(current, n, line, i)) {
        current.lines.push(line);
        if (n === 1) current.seenChoice1 = true;
        current.choiceRunLast = n;
        continue;
      }
      if (current) blocks.push(current);
      const rest = stripNumberPrefix(line);
      current = {
        number: qNum,
        lines: rest ? [rest] : [],
        answer: null,
        choiceRunLast: null,
        seenChoice1: false,
      };
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

  // Fallback: no numbered questions but has "Answer:" + choices — stream the
  // lines instead. Prose before a choice line is that question's stem; an
  // answer line or a blank between choice runs ends the current question.
  if (blocks.length === 0 && /answer\s*[:\-–—]/i.test(text)) {
    let pending: string[] = [];
    let cur: Block | null = null;
    const flush = () => {
      if (cur) {
        blocks.push(cur);
        cur = null;
      }
    };
    const newBlock = (): Block => ({
      number: null,
      lines: [],
      answer: null,
      choiceRunLast: null,
      seenChoice1: false,
    });
    const attachPending = (block: Block) => {
      if (pending.length) {
        block.lines.push(...pending);
        pending = [];
      }
    };

    for (const line of text.split('\n')) {
      if (!line.trim()) {
        if (cur && cur.lines.some((l) => matchChoice(l))) flush();
        continue;
      }
      const ans = matchAnswerLine(line);
      if (ans) {
        if (cur) cur.answer = ans;
        continue;
      }
      const inline = splitInlineChoices(line);
      if (inline && inline.lead) {
        flush();
        cur = newBlock();
        attachPending(cur);
        cur.lines.push(line);
        continue;
      }
      if (inline || matchChoice(line)) {
        if (!cur) {
          if (!pending.length) continue; // orphan choice — drop
          cur = newBlock();
          attachPending(cur);
        }
        // Kept raw so finishItem can split inline runs and recover keys.
        cur.lines.push(line);
        continue;
      }
      if (cur) flush();
      pending.push(line);
    }
    flush();
    // Trailing prose that reads like a question survives as its own item;
    // footers ("End of exam") are dropped.
    if (pending.length && /\?/.test(pending.join(' '))) {
      const block = newBlock();
      block.lines.push(...pending);
      blocks.push(block);
    }
  }

  for (const block of blocks) {
    const item = finishItem(block.lines, block.answer, trailingAnswers, block.number, errors, allowMissing);
    if (item) items.push(item);
  }

  // Apply optional trailing tags: "Difficulty: easy" as last line of a block was already folded into text — skip.

  if (items.length === 0 && errors.length === 0) {
    errors.push(
      'No questions found. Use numbered questions with A–D or 1–4 choices and “Answer: B” (or “Answer: 2”), or CSV rows.'
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
  // Numbered key from a source document: "2" → the second choice.
  const num = v.match(/^\(?(\d{1,2})\)?$/);
  if (num) {
    const idx = parseInt(num[1], 10) - 1;
    if (idx >= 0 && idx < choices.length) {
      item.correct_choice_key = choices[idx].choice_key;
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
