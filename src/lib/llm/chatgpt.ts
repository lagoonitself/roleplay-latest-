/**
 * ChatGPT subscription provider ("Sign in with ChatGPT", the same login the Codex CLI uses).
 *
 * The browser keeps the OAuth tokens; every request carries them inside the ordinary
 * `apiKey` string as `chatgpt:<base64url JSON>`, so the existing plumbing (request bodies,
 * the duo `x-llm-key` header, background memory passes) needs no new fields.
 *
 * The Codex backend speaks the Responses API, not Chat Completions. `streamChatgpt`
 * translates both ways and re-emits Chat Completions SSE chunks, so the stream readers in
 * the chat route and duo engine work unchanged.
 */
import { LlmError, type ChatMessage } from './client';

export const CHATGPT_ISSUER = 'https://auth.openai.com';
export const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CHATGPT_DEVICE_VERIFICATION_URL = `${CHATGPT_ISSUER}/codex/device`;
export const CHATGPT_RESPONSES_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
export const DEFAULT_CHATGPT_MODEL = 'gpt-5.5';

/** Models the Codex backend lists for ChatGPT plans (codex-rs/models-manager/models.json). */
export const CHATGPT_MODELS = [
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gpt-6-luna',
  'gpt-6-sol',
  'gpt-6.1-sol',
] as const;

const KEY_PREFIX = 'chatgpt:';

export interface ChatgptCredential {
  /** OAuth access token (JWT). */
  t: string;
  /** ChatGPT account id, sent as `chatgpt-account-id`. */
  a: string;
  /** Model slug. */
  m?: string;
}

function toBase64Url(s: string): string {
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(s, 'utf8').toString('base64') : btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : decodeURIComponent(escape(atob(b64)));
}

export function encodeChatgptKey(cred: ChatgptCredential): string {
  return KEY_PREFIX + toBase64Url(JSON.stringify(cred));
}

export function isChatgptKey(key: string | undefined | null): boolean {
  return !!key && key.startsWith(KEY_PREFIX);
}

export function parseChatgptKey(key: string): ChatgptCredential | null {
  if (!isChatgptKey(key)) return null;
  try {
    const cred = JSON.parse(fromBase64Url(key.slice(KEY_PREFIX.length))) as ChatgptCredential;
    return cred?.t ? cred : null;
  } catch {
    return null;
  }
}

/** Decodes a JWT payload without verifying it (we only read our own token's claims). */
export function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(fromBase64Url(part));
  } catch {
    return null;
  }
}

/** Reads the ChatGPT account id, plan and email from an id/access token. */
export function readChatgptClaims(jwt: string): { accountId: string; plan: string; email: string; exp: number } {
  const payload = decodeJwtPayload(jwt) || {};
  const auth = (payload['https://api.openai.com/auth'] || {}) as Record<string, unknown>;
  const profile = (payload['https://api.openai.com/profile'] || {}) as Record<string, unknown>;
  return {
    accountId: String(auth.chatgpt_account_id || ''),
    plan: String(auth.chatgpt_plan_type || ''),
    email: String(payload.email || profile.email || ''),
    exp: Number(payload.exp) || 0,
  };
}

interface ChatgptRequestOptions {
  model?: string;
  sessionId?: string;
  thinking?: boolean;
  stop?: string[];
  json?: boolean;
  signal?: AbortSignal;
}

function toResponsesInput(messages: ChatMessage[], json: boolean) {
  const input = messages.map((m) => ({
    type: 'message',
    // The Responses API's equivalent of a system message is a developer message.
    role: m.role === 'system' ? 'developer' : m.role,
    content: [{ type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content }],
  }));
  if (json) {
    input.push({
      type: 'message',
      role: 'developer',
      content: [{ type: 'input_text', text: 'Respond with a single valid JSON object and nothing else.' }],
    });
  }
  return input;
}

async function postChatgpt(messages: ChatMessage[], cred: ChatgptCredential, opts: ChatgptRequestOptions): Promise<Response> {
  // The Codex backend rejects sampling knobs (temperature, top_p, max tokens, stop), so
  // only the fields it accepts are sent; stop sequences are enforced while streaming.
  const payload: Record<string, unknown> = {
    model: cred.m || opts.model || DEFAULT_CHATGPT_MODEL,
    input: toResponsesInput(messages, !!opts.json),
    stream: true,
    store: false,
    tool_choice: 'auto',
    parallel_tool_calls: false,
    include: [],
    reasoning: opts.thinking ? { effort: 'medium', summary: 'auto' } : { effort: 'low' },
  };
  if (opts.sessionId) payload.prompt_cache_key = opts.sessionId;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
    Authorization: `Bearer ${cred.t}`,
    'OpenAI-Beta': 'responses=experimental',
    originator: 'codex_cli_rs',
  };
  if (cred.a) headers['chatgpt-account-id'] = cred.a;
  if (opts.sessionId) headers.session_id = opts.sessionId;

  const response = await fetch(CHATGPT_RESPONSES_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: opts.signal,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new LlmError(response.status, body, 'chatgpt');
  }
  return response;
}

/**
 * Streams a ChatGPT completion, re-emitted as Chat Completions SSE
 * (`data: {"choices":[{"delta":{...}}]}` … `data: [DONE]`).
 */
export async function streamChatgpt(messages: ChatMessage[], cred: ChatgptCredential, opts: ChatgptRequestOptions = {}): Promise<Response> {
  const upstream = await postChatgpt(messages, cred, opts);
  const stops = (opts.stop || []).filter(Boolean);
  const holdBack = stops.reduce((n, s) => Math.max(n, s.length - 1), 0);

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, data: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = '';
      // Text not yet emitted, held back so a stop sequence split across deltas is caught.
      let pending = '';
      let stopped = false;

      const flushText = (final: boolean) => {
        if (!pending) return;
        for (const s of stops) {
          const idx = pending.indexOf(s);
          if (idx !== -1) {
            if (idx > 0) emit(controller, { choices: [{ index: 0, delta: { content: pending.slice(0, idx) } }] });
            pending = '';
            stopped = true;
            return;
          }
        }
        const cut = final ? pending.length : Math.max(0, pending.length - holdBack);
        if (cut > 0) {
          emit(controller, { choices: [{ index: 0, delta: { content: pending.slice(0, cut) } }] });
          pending = pending.slice(cut);
        }
      };

      try {
        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            let event: { type?: string; delta?: string; response?: { usage?: Record<string, unknown>; error?: { message?: string } }; message?: string };
            try {
              event = JSON.parse(trimmed.slice(5).trim());
            } catch {
              continue;
            }
            switch (event.type) {
              case 'response.output_text.delta':
                pending += event.delta || '';
                flushText(false);
                break;
              case 'response.reasoning_summary_text.delta':
              case 'response.reasoning_text.delta':
                emit(controller, { choices: [{ index: 0, delta: { reasoning_content: event.delta || '' } }] });
                break;
              case 'response.completed':
              case 'response.incomplete': {
                flushText(true);
                const u = event.response?.usage as { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } } | undefined;
                emit(controller, {
                  choices: [{ index: 0, delta: {}, finish_reason: event.type === 'response.completed' ? 'stop' : 'length' }],
                  ...(u
                    ? {
                        usage: {
                          prompt_tokens: u.input_tokens ?? 0,
                          completion_tokens: u.output_tokens ?? 0,
                          prompt_tokens_details: { cached_tokens: u.input_tokens_details?.cached_tokens ?? 0 },
                        },
                      }
                    : {}),
                });
                break;
              }
              case 'response.failed':
              case 'error':
                throw new Error(event.response?.error?.message || event.message || 'ChatGPT stopped the response.');
            }
            if (stopped) break;
          }
        }
        if (!stopped) flushText(true);
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        if (stopped) reader.cancel().catch(() => undefined);
      }
    },
  });

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

/** Runs a ChatGPT completion to the end and returns the reply text. */
export async function completeChatgpt(messages: ChatMessage[], cred: ChatgptCredential, opts: ChatgptRequestOptions = {}): Promise<string> {
  const response = await streamChatgpt(messages, cred, opts);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        text += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content || '';
      } catch {}
    }
  }
  return text.trim();
}
