/**
 * Exam question order for the attempt manifest.
 *
 * Strict document order: questions stay in their authored sequence (by
 * `position`) — never regrouped by type. When the deployment's
 * `question_order_mode` is 'shuffled', the whole list is shuffled instead.
 */
export function buildQuestionIdOrder<T extends { id: string; position?: number | null }>(
  questions: T[],
  options: { shuffle?: boolean } = {}
): string[] {
  const ordered = [...questions].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (options.shuffle) {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  return ordered.map((q) => q.id);
}
