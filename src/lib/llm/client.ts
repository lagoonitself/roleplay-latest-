export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  apiKey?: string;
  endpoint?: string;
  model?: string;
  sessionId?: string; // used for x-opencode-session caching
  temperature?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  max_tokens?: number;
  thinking?: boolean;
  stop?: string[];
  signal?: AbortSignal;
}

export const DEFAULT_OPENCODE_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4.1-flash';

/** Extra completion budget granted when reasoning ("thinking") is enabled, since reasoning tokens count toward max_tokens. */
export const THINKING_TOKEN_ALLOWANCE = 8192;

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/**
 * Returns the effective API key (from parameter or env). Empty string if missing.
 */
export function getLlmApiKey(explicitKey?: string): string {
  const key = explicitKey || process.env.OPENCODE_GO_API_KEY || '';
  return key.trim();
}

export function getLlmModel(explicitModel?: string): string {
  return explicitModel || process.env.OPENCODE_GO_MODEL || DEFAULT_DEEPSEEK_MODEL;
}

function resolveRequest(options: StreamChatOptions, fallbackSessionPrefix: string) {
  const apiKey = getLlmApiKey(options.apiKey);
  if (!apiKey) {
    throw new Error('OPENCODE_GO_API_KEY is not configured. Please add it to your environment or settings.');
  }

  const endpoint = options.endpoint || process.env.OPENCODE_GO_ENDPOINT || DEFAULT_OPENCODE_ENDPOINT;
  const model = getLlmModel(options.model);
  const sessionId = options.sessionId || `${fallbackSessionPrefix}-${Date.now()}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'User-Agent': 'cadenza-roleplay/1.0 (Next.js/16; Web)',
    'x-opencode-session': sessionId,
  };

  return { endpoint, model, headers };
}

/**
 * POST with a small exponential-backoff retry for transient gateway / rate-limit failures.
 * Only retries before any response body has been consumed, so it is safe for streaming.
 */
async function postWithRetry(
  endpoint: string,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
  { retries = 2, signal }: { retries?: number; signal?: AbortSignal } = {}
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } catch (err) {
      // Network-level failure (DNS, reset, etc.) — retryable unless aborted by the caller.
      const errName = (err as { name?: unknown } | null | undefined)?.name;
      if (errName === 'AbortError') throw err;
      lastError = err;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
      continue;
    }

    if (response.ok) return response;

    const errorText = await response.text().catch(() => '');
    lastError = new Error(`LLM API error (${response.status}): ${errorText.slice(0, 500)}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) break;

    await new Promise((r) => setTimeout(r, 600 * 2 ** attempt));
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function applyThinking(payload: Record<string, unknown>, thinking: boolean | undefined) {
  // DeepSeek V4 parameter for thinking control
  payload.thinking = { type: thinking ? 'enabled' : 'disabled' };
}

/**
 * Calls the chat model via OpenCode Go with streaming Server-Sent Events.
 */
export async function streamChatCompletions(
  messages: ChatMessage[],
  options: StreamChatOptions = {}
): Promise<Response> {
  const { endpoint, model, headers } = resolveRequest(options, 'session');

  const baseMaxTokens = options.max_tokens ?? 1200;
  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: options.temperature ?? 1.15,
    top_p: options.top_p ?? 0.95,
    presence_penalty: options.presence_penalty ?? 0.2,
    frequency_penalty: options.frequency_penalty ?? 0.3,
    // Reasoning tokens are billed against max_tokens — give thinking mode headroom (min 8192) so replies aren't truncated.
    max_tokens: options.thinking
      ? Math.min(16384, Math.max(8192, baseMaxTokens + THINKING_TOKEN_ALLOWANCE))
      : baseMaxTokens,
  };

  if (options.stop && options.stop.length > 0) {
    payload.stop = options.stop.slice(0, 16);
  }

  applyThinking(payload, options.thinking);

  return postWithRetry(endpoint, headers, payload, { signal: options.signal });
}

/**
 * Non-streaming plain-text completion for background tasks.
 */
export async function textCompletion(
  messages: ChatMessage[],
  options: StreamChatOptions = {}
): Promise<string> {
  const { endpoint, model, headers } = resolveRequest(options, 'bg-session');

  const payload: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    temperature: options.temperature ?? 0.5,
    max_tokens: options.max_tokens ?? 2048,
  };
  applyThinking(payload, false);

  const response = await postWithRetry(endpoint, headers, payload, { signal: options.signal });
  const data = await response.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Robust JSON repair and parser that cleans markdown fences, fixes unescaped newlines
 * inside string literals, and auto-repairs truncated/unclosed strings & brackets.
 */
export function repairAndParseJson<T = unknown>(str: string): T {
  let s = str.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

  // 1. Fast path: try standard parsing
  try {
    return JSON.parse(s) as T;
  } catch {}

  // 2. Locate starting JSON object
  const start = s.indexOf('{');
  if (start !== -1) {
    s = s.slice(start);
  }

  // 3. Scan character-by-character to sanitize unescaped control chars and track unclosed braces
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  let repaired = '';

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) {
      escaped = false;
      repaired += ch;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      repaired += ch;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      repaired += ch;
      continue;
    }
    if (inString) {
      if (ch === '\n') {
        repaired += '\\n';
      } else if (ch === '\r') {
        repaired += '\\r';
      } else if (ch === '\t') {
        repaired += '\\t';
      } else {
        repaired += ch;
      }
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
    } else if (ch === '}' || ch === ']') {
      if (stack.length > 0 && stack[stack.length - 1] === ch) {
        stack.pop();
      }
    }
    repaired += ch;
  }

  // If truncated mid-string, close the string
  if (inString) {
    repaired += '"';
  }
  // Close any unclosed object/array brackets
  while (stack.length > 0) {
    repaired += stack.pop();
  }

  // 4. Try parsing repaired string
  try {
    return JSON.parse(repaired) as T;
  } catch {
    // Clean up trailing comma before closing brace if present
    const cleaned = repaired.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(cleaned) as T;
  }
}

/**
 * Non-streaming JSON completion for background tasks (character generation, memory extraction).
 * Retries once at a lower temperature if the model returns unparseable JSON.
 */
export async function jsonCompletion<T = unknown>(
  messages: ChatMessage[],
  options: StreamChatOptions = {}
): Promise<T> {
  const { endpoint, model, headers } = resolveRequest(options, 'bg-session');

  const attempt = async (temperature: number): Promise<T> => {
    const payload: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      temperature,
      response_format: { type: 'json_object' },
      max_tokens: options.max_tokens ?? 8192,
    };
    applyThinking(payload, false);

    const response = await postWithRetry(endpoint, headers, payload, { signal: options.signal });
    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || '{}';
    return repairAndParseJson<T>(rawContent);
  };

  const temperature = options.temperature ?? 0.7;
  try {
    return await attempt(temperature);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return attempt(Math.max(0.2, temperature - 0.4));
    }
    throw err;
  }
}
