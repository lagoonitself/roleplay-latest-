/**
 * Shared helper to determine whether full prompt payloads (request_messages)
 * should be persisted to `llm_logs`.
 *
 * Persisted prompts can be disabled via LLM_LOG_FULL_PROMPTS=off|0|false|no (case-insensitive).
 */
export function shouldLogFullPrompts(): boolean {
  const val = process.env.LLM_LOG_FULL_PROMPTS;
  if (!val) return true;
  const normalized = val.trim().toLowerCase();
  return !['off', '0', 'false', 'no'].includes(normalized);
}
