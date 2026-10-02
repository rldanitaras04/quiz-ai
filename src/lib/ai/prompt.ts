import type { GenerateQuestionsParams } from '@/lib/ai/types';

/**
 * The question-generation prompt, shared by the Groq and OpenAI providers —
 * their builders were byte-identical copies before this module existed, and
 * the retrieval/provenance wording (scope §11/§12) now has exactly one home.
 *
 * With `sourceChunks` present every chunk is labelled `[chunk:<id>]` and the
 * model is asked to cite the ids that support each question; the route turns
 * that answer into the provenance record. `avoidQuestionTexts` carries the
 * candidates the duplicate gate rejected on an earlier round — the model must
 * test a different fact instead of rephrasing them (scope §13).
 */
export function buildQuestionPrompt(params: GenerateQuestionsParams): string {
  const {
    sourceTexts,
    sourceChunks,
    avoidQuestionTexts,
    topic,
    questionType,
    count,
    difficulty,
    bloomLevel,
    customInstructions,
  } = params;

  const sourceContent =
    sourceChunks && sourceChunks.length > 0
      ? sourceChunks.map((c) => `[chunk:${c.id}]\n${c.content}`).join('\n\n---\n\n')
      : sourceTexts.join('\n\n---\n\n');

  const sourceChunkInstruction =
    sourceChunks && sourceChunks.length > 0
      ? `- "sourceChunkIds" (array of strings): the [chunk:<id>] labels of the chunks that directly support the question — copy the ids exactly as shown above, or [] when no chunk applies`
      : `- "sourceChunkIds" (array of strings): leave as empty array []`;

  const difficultyInstruction = difficulty === 'mixed'
    ? 'Generate a mix of easy, moderate, and difficult questions.'
    : `Generate ${difficulty} difficulty questions.`;

  const typeInstruction =
    questionType === 'multiple_choice'
      ? `Each question must be multiple choice with exactly 4 choices (A, B, C, D), where exactly one is correct.`
      : questionType === 'true_false'
        ? `Each question must be a True/False statement (including Modified True or False style statements that may be partially incorrect). Exactly one of the two fixed choices "True" or "False" is correct.`
        : `Each question must be a theoretical identification/short-answer question. The answer MUST be a specific term, concept, or definition directly found in the source material. Questions should test knowledge of key terminology, definitions, or factual concepts.`;

  const duplicateAvoidance =
    avoidQuestionTexts && avoidQuestionTexts.length > 0
      ? `\nDUPLICATE AVOIDANCE: Previous attempts produced questions that already exist. Do not repeat or paraphrase any of the following — write questions that test a different fact or angle:\n${avoidQuestionTexts.map((t) => `- ${t}`).join('\n')}\n`
      : '';

  return `You are an expert assessment item writer for academic examinations.

TASK: Generate exactly ${count} high-quality examination questions about "${topic}".

SOURCE MATERIAL:
${sourceContent}

QUESTION TYPE: ${questionType}
${typeInstruction}

DIFFICULTY: ${difficultyInstruction}

BLOOM'S TAXONOMY LEVEL: ${bloomLevel}
- Focus questions at the "${bloomLevel}" cognitive level.

OUTPUT FORMAT: Return a JSON array. Each element must be an object with:
- "questionText" (string): The question stem
- "questionType" (string): "${questionType}"
- "difficulty" (string): one of "easy", "moderate", "difficult"
- "bloomLevel" (string): "${bloomLevel}"
- "points" (number): point value (1-5 based on difficulty)
${questionType === 'multiple_choice'
  ? `- "choices" (array of 4 objects): each with "key" (A/B/C/D), "text" (string), "isCorrect" (boolean, exactly one true)`
  : questionType === 'true_false'
    ? `- "choices" (array of 2 objects): [{ "key": "T", "text": "True", "isCorrect": boolean }, { "key": "F", "text": "False", "isCorrect": boolean }] with exactly one true`
    : `- "canonicalAnswer" (string): a specific term, concept, or short phrase directly from the source material as the correct answer`}
${sourceChunkInstruction}

GUIDELINES:
- Questions must be grounded in the source material provided.
- Avoid ambiguous questions or trick questions.
- Use clear, concise academic language.
- Ensure distractors (for MCQ) are plausible but clearly incorrect.
- Do not include the correct answer in the question text.
${questionType === 'identification'
  ? `- For identification questions: ask "What is...", "Define...", "Name the...", or "According to the source, what..." style questions.\n- The canonicalAnswer must be a specific term or concept that appears in the source material.\n- Do NOT ask open-ended or essay-style questions.`
  : ''}${duplicateAvoidance}
${customInstructions ? `\nADDITIONAL INSTRUCTIONS:\n${customInstructions}` : ''}

Return ONLY the JSON array, no additional text or markdown.`;
}
