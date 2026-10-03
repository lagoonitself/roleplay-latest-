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
}

export const DEFAULT_OPENCODE_ENDPOINT = 'https://opencode.ai/zen/go/v1/chat/completions';
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4.1-flash';

/**
 * Returns the effective API key (from parameter, env, or throws if missing)
 */
export function getLlmApiKey(explicitKey?: string): string {
  const key = explicitKey || process.env.OPENCODE_GO_API_KEY || '';
  return key.trim();
}

/**
 * Calls DeepSeek V4.1 Flash via OpenCode Go with streaming Server-Sent Events.
 */
export async function streamChatCompletions(
  messages: ChatMessage[],
  options: StreamChatOptions = {}
): Promise<Response> {
  const apiKey = getLlmApiKey(options.apiKey);
  if (!apiKey) {
    throw new Error('OPENCODE_GO_API_KEY is not configured. Please add it to your environment or settings.');
  }

  const endpoint = options.endpoint || process.env.OPENCODE_GO_ENDPOINT || DEFAULT_OPENCODE_ENDPOINT;
  const model = options.model || process.env.OPENCODE_GO_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const sessionId = options.sessionId || 'session-' + Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': 'cadenza-roleplay/1.0 (Next.js/16; Web)',
    'x-opencode-session': sessionId,
  };

  const payload: Record<string, any> = {
    model,
    messages,
    stream: true,
    temperature: options.temperature ?? 1.15,
    top_p: options.top_p ?? 0.95,
    presence_penalty: options.presence_penalty ?? 0.2,
    frequency_penalty: options.frequency_penalty ?? 0.3,
    max_tokens: options.max_tokens ?? 1200,
  };

  // DeepSeek V4 parameter for thinking control
  if (options.thinking === false || options.thinking === undefined) {
    payload.thinking = { type: 'disabled' };
  } else {
    payload.thinking = { type: 'enabled' };
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenCode Go API error (${response.status}): ${errorText}`);
  }

  return response;
}

/**
 * Robust JSON repair and parser that cleans markdown fences, fixes unescaped newlines
 * inside string literals, and auto-repairs truncated/unclosed strings & brackets.
 */
export function repairAndParseJson<T = any>(str: string): T {
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
 * Non-streaming JSON completion for background tasks (character generation, memory extraction)
 */
export async function jsonCompletion<T = any>(
  messages: ChatMessage[],
  options: StreamChatOptions = {}
): Promise<T> {
  const apiKey = getLlmApiKey(options.apiKey);
  if (!apiKey) {
    throw new Error('OPENCODE_GO_API_KEY is not configured.');
  }

  const endpoint = options.endpoint || process.env.OPENCODE_GO_ENDPOINT || DEFAULT_OPENCODE_ENDPOINT;
  const model = options.model || process.env.OPENCODE_GO_MODEL || DEFAULT_DEEPSEEK_MODEL;
  const sessionId = options.sessionId || 'bg-session-' + Date.now();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'User-Agent': 'cadenza-roleplay/1.0 (Next.js/16; Web)',
    'x-opencode-session': sessionId,
  };

  const payload: Record<string, any> = {
    model,
    messages,
    stream: false,
    temperature: options.temperature ?? 0.7,
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: options.max_tokens ?? 8192, // Full 8192 maximum generation window
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM JSON completion error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content || '{}';

  return repairAndParseJson<T>(rawContent);
}
