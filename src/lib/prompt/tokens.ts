/**
 * Token estimation + context budgeting.
 *
 * Estimation is deliberately dependency-free: ~3.6 chars/token is a conservative
 * average for English prose on modern BPE tokenizers, and erring high keeps us
 * safely inside the context budget.
 *
 * Budgeting philosophy (SillyTavern-style, made adaptive):
 *   context window  =  reserved response tokens  +  everything we assemble
 *   everything      =  static prefix (system + persona + character + examples)
 *                      + recall blocks (summary, memories, lore)
 *                      + live chat history
 * The static prefix is measured, recall blocks are capped, and the *remainder*
 * goes to history — so a long, richly-detailed character never starves the
 * conversation, and a short one automatically gets more history.
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

/** Truncates from the *start*, keeping the tail — for rolling summaries where the newest beats matter most. */
export function truncateToTokensTail(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = Math.floor(maxTokens * 3.6);
  const slice = text.slice(text.length - maxChars);
  const boundary = Math.max(slice.indexOf('\n'), slice.indexOf('. '));
  return '… ' + (boundary > 0 && boundary < maxChars * 0.4 ? slice.slice(boundary + 1) : slice).trimStart();
}

/**
 * Keeps the head *and* the tail when over budget. Used for structured summaries,
 * where a plain tail cut would delete the closing sections (open threads, key facts).
 */
export function truncateToTokensMiddle(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = Math.floor(maxTokens * 3.6);
  const headChars = Math.floor(maxChars * 0.6);
  const tailChars = Math.floor(maxChars * 0.3);
  return `${text.slice(0, headChars).trimEnd()}\n…\n${text.slice(text.length - tailChars).trimStart()}`;
}

export interface ContextBudget {
  /** Total tokens the provider accepts for prompt + completion. */
  contextWindow: number;
  /** Tokens held back for the model's reply (and thinking, when enabled). */
  responseReserve: number;
  /** Tokens available for the assembled prompt. */
  promptBudget: number;
  /** Tokens available for the static system/prefix block. */
  prefixBudget: number;
  /** Tokens available for recall blocks (summary, memories, lore) combined. */
  recallBudget: number;
  /** Tokens available for the live chat history. */
  historyBudget: number;
}

/**
 * Known context windows. Specific model overrides must be checked before
 * generic family keywords so that models like qwen-max (32k) or deepseek-r1 (64k)
 * are not over-estimated by generic 'max' or 'r1' rules.
 */
const KNOWN_CONTEXT_WINDOWS: Array<[RegExp, number]> = [
  // Specific model overrides
  [/qwen.*max/i, 32_768],
  [/deepseek.*(?:r1|reasoner)/i, 65_536],
  // 200k window models (Claude 3+, OpenAI reasoning models o1/o3, GPT-5 / 4.1)
  [/claude-(?:3|4)|claude-sonnet|claude-opus|claude-haiku/i, 200_000],
  [/\b(?:o1|o3|o4)(?:-preview|-mini)?\b/i, 200_000],
  [/gpt-[56]|gpt-4\.1/i, 200_000],
  // 128k (131,072) window models
  [/gpt-4o|deepseek|claude|gemini|qwen|mistral|llama/i, 131_072],
  [/mini|flash|lite|haiku/i, 131_072],
  // Older or smaller models
  [/gpt-4-32k/i, 32_768],
  [/gpt-4(?!\.1|o)|gpt-3\.5/i, 16_384],
];

export const DEFAULT_CONTEXT_WINDOW = 131_072;
/** Never assume less than this, even for unknown providers. */
export const MIN_CONTEXT_WINDOW = 16_384;

/** Allowance added when reasoning/thinking is enabled, matching streamChatCompletions. */
export const THINKING_RESERVE_ALLOWANCE = 8192;

export function getContextWindow(model?: string | null): number {
  if (!model) return DEFAULT_CONTEXT_WINDOW;
  for (const [pattern, window] of KNOWN_CONTEXT_WINDOWS) {
    if (pattern.test(model)) return window;
  }
  // Unknown models (e.g. kimi, newer provider ids) get the common 128k window;
  // computeContextBudget still floors everything at MIN_CONTEXT_WINDOW.
  return DEFAULT_CONTEXT_WINDOW;
}

export interface BudgetInput {
  model?: string | null;
  /** Max completion tokens requested for this turn (from verbosity). */
  maxResponseTokens: number;
  /** Extra headroom when thinking/reasoning is enabled. */
  thinking?: boolean;
  /** Measured size of the static prefix block, in tokens. */
  prefixTokens: number;
  /** Sum of everything recall wants to inject (summary, memories, lore, notes). */
  requestedRecallTokens: number;
  /** Hard floor for history so a chat never collapses to one turn. */
  minHistoryTokens?: number;
}

export const MIN_HISTORY_TOKENS = 1200;
/**
 * Beyond this, more history stops improving continuity — the summary and the
 * recall blocks carry the long arc instead. Capping it keeps very long chats
 * cheap and fast instead of re-sending the whole transcript every turn.
 */
export const MAX_HISTORY_TOKENS = 16_000;

/**
 * Splits the context window between prefix / recall / history.
 *
 * Order of priority (highest first):
 *   1. the model's reply — the whole point of the turn
 *   2. the static prefix — canon, voice, and rules; without it quality collapses
 *   3. live history — continuity of the actual conversation
 *   4. recall blocks — summary, memories, lore; capped and gracefully dropped
 */
export function computeContextBudget(input: BudgetInput): ContextBudget {
  const contextWindow = Math.max(MIN_CONTEXT_WINDOW, getContextWindow(input.model));
  // Thinking tokens are billed against max_tokens — the request sends
  // Math.min(16384, Math.max(8192, baseMaxTokens + THINKING_TOKEN_ALLOWANCE)).
  // Reserve must match what is actually sent.
  const requestedResponseTokens = input.thinking
    ? Math.min(16384, Math.max(8192, input.maxResponseTokens + THINKING_RESERVE_ALLOWANCE))
    : input.maxResponseTokens;
  const responseReserve = Math.min(
    Math.floor(contextWindow * 0.45),
    requestedResponseTokens
  );

  const promptBudget = contextWindow - responseReserve;
  const minHistory = input.minHistoryTokens ?? MIN_HISTORY_TOKENS;

  // Prefix is what it is — but never more than 55% of the prompt budget.
  const prefixBudget = Math.min(input.prefixTokens, Math.floor(promptBudget * 0.55));

  // History gets first claim on what's left after prefix + a modest recall allowance,
  // but is capped: past a point extra history stops helping and just costs tokens.
  // The remainder is measured against the prefix AS SENT: when a huge card alone
  // blows past the 55% design target, budgeting off the capped figure would
  // over-allocate history + recall and push the prompt past the context window.
  const afterPrefix = Math.max(0, promptBudget - input.prefixTokens);
  const historyBudget = Math.min(
    MAX_HISTORY_TOKENS,
    Math.max(minHistory, Math.min(afterPrefix - Math.min(input.requestedRecallTokens, 2500), Math.floor(afterPrefix * 0.8)))
  );

  // Whatever genuinely remains can be spent on recall.
  const recallBudget = Math.max(0, Math.min(input.requestedRecallTokens, promptBudget - prefixBudget - historyBudget));

  return {
    contextWindow,
    responseReserve,
    promptBudget,
    prefixBudget,
    recallBudget,
    historyBudget,
  };
}
