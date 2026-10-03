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
 * Non-streaming JSON completion for background tasks (memory extraction, state updating)
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
    temperature: 0.3, // deterministic for extraction
    response_format: { type: 'json_object' },
    thinking: { type: 'disabled' },
    max_tokens: 1000,
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

  try {
    return JSON.parse(rawContent) as T;
  } catch (err) {
    // If wrapped in markdown ```json ... ```
    const cleaned = rawContent.replace(/```(?:json)?/g, '').trim();
    return JSON.parse(cleaned) as T;
  }
}
