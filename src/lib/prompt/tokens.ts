/**
 * Lightweight token estimation (no tokenizer dependency).
 * ~3.6 chars/token is a conservative average for English prose on modern BPE tokenizers;
 * erring high keeps us safely inside the context budget.
 */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.6);
}

/** Truncates text to roughly `maxTokens`, cutting at the last sentence/line boundary when possible. */
export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = Math.floor(maxTokens * 3.6);
  const slice = text.slice(0, maxChars);
  const boundary = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '));
  return (boundary > maxChars * 0.6 ? slice.slice(0, boundary + 1) : slice).trimEnd() + ' …';
}
