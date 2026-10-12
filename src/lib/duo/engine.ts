import type { SupabaseClient } from '@supabase/supabase-js';
import { assemblePrompt } from '@/lib/prompt/assembler';
import { VERBOSITY_GUIDE } from '@/lib/prompt/system-prompt';
import { formatRoleplayText } from '@/lib/prompt/macros';
import { estimateTokens } from '@/lib/prompt/tokens';
import { streamChatCompletions, getLlmApiKey, getLlmModel } from '@/lib/llm/client';
import { ThinkingStreamParser, SseEventParser, type SseMessage } from '@/lib/llm/stream-parser';
import { sanitizeModelOutput } from '@/lib/formatter/regex-engine';
import type { Character, Message } from '@/lib/supabase/types';
import { agentAsCharacter, agentAsPersona, otherLabel, ratingFloor, type LoadedAgent } from './agents';
import { otherSide, parseDuo, type DuoAgentRef, type DuoSession, type DuoSide } from './types';

const BUSY_MS = 70_000;
const WRITE_EVERY_MS = 450;
const HISTORY_LIMIT = 40;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadOwnedAgent(
  supabase: SupabaseClient,
  userId: string,
  ref: DuoAgentRef
): Promise<LoadedAgent | null> {
  if (ref.kind === 'character') {
    const { data } = await supabase
      .from('characters')
      .select('*')
      .eq('id', ref.id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return null;
    return {
      kind: 'character',
      id: data.id,
      name: data.name || 'Character',
      avatar_url: data.avatar_url || null,
      character: data as Character,
      persona: null,
    };
  }

  const { data } = await supabase
    .from('personas')
    .select('*')
    .eq('id', ref.id)
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    kind: 'persona',
    id: data.id,
    name: data.name || 'Persona',
    avatar_url: data.avatar_url || null,
    character: null,
    persona: data,
  };
}

async function readChat(supabase: SupabaseClient, chatId: string, userId: string) {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as { id: string; user_id: string; settings: Record<string, unknown>; updated_at: string };
}

export async function claimTurn(
  supabase: SupabaseClient,
  chatId: string,
  userId: string,
  runId: string
): Promise<DuoSession | null> {
  const chat = await readChat(supabase, chatId, userId);
  if (!chat) return null;
  const duo = parseDuo(chat.settings);
  if (!duo || duo.status !== 'running' || duo.runId !== runId) return null;
  if (duo.turn >= duo.maxTurns) {
    await mergeDuo(supabase, chatId, userId, () => ({ ...duo, status: 'done', busyUntil: null }));
    return null;
  }
  if (duo.busyUntil && Date.parse(duo.busyUntil) > Date.now()) return null;

  const claimed: DuoSession = {
    ...duo,
    busyUntil: new Date(Date.now() + BUSY_MS).toISOString(),
  };
  const { data } = await supabase
    .from('chats')
    .update({ settings: { ...(chat.settings || {}), duo: claimed } })
    .eq('id', chatId)
    .eq('user_id', userId)
    .eq('updated_at', chat.updated_at)
    .select('settings')
    .maybeSingle();

  return data ? parseDuo(data.settings) : null;
}

export async function mergeDuo(
  supabase: SupabaseClient,
  chatId: string,
  userId: string,
  patch: (current: DuoSession) => DuoSession
): Promise<DuoSession | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const chat = await readChat(supabase, chatId, userId);
    if (!chat) return null;
    const current = parseDuo(chat.settings);
    if (!current) return null;
    const next = patch(current);
    const { data } = await supabase
      .from('chats')
      .update({ settings: { ...(chat.settings || {}), duo: next } })
      .eq('id', chatId)
      .eq('user_id', userId)
      .eq('updated_at', chat.updated_at)
      .select('settings')
      .maybeSingle();
    if (data) return parseDuo(data.settings);
  }
  return null;
}

function tooSimilar(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/\s+/g, ' ').trim();
  const nb = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (na.length < 40 || nb.length < 40) return na === nb && na.length > 0;
  if (na === nb) return true;
  const [shorter, longer] = na.length < nb.length ? [na, nb] : [nb, na];
  return longer.includes(shorter) && shorter.length / longer.length > 0.92;
}

function cutAtOtherName(text: string, otherName: string): string {
  const escaped = otherName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.search(new RegExp(`\\n\\s*${escaped}\\s*:`, 'i'));
  return match > 0 ? text.slice(0, match).trim() : text;
}

async function settleStaleStreaming(supabase: SupabaseClient, chatId: string, userId: string) {
  await supabase
    .from('messages')
    .update({ status: 'stopped' })
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .eq('status', 'streaming');
}

async function insertMessage(
  supabase: SupabaseClient,
  input: {
    chatId: string;
    userId: string;
    parentId: string | null;
    content: string;
    status: Message['status'];
    side: DuoSide;
    agent: LoadedAgent;
    model?: string;
  }
) {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      chat_id: input.chatId,
      user_id: input.userId,
      parent_id: input.parentId,
      role: 'assistant',
      content: input.content,
      status: input.status,
      meta: {
        model: input.model,
        duo: {
          side: input.side,
          kind: input.agent.kind,
          id: input.agent.id,
          name: input.agent.name,
        },
      },
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message || 'Could not save the line.');
  return data.id as string;
}

async function consumeStream(
  response: Response,
  onText: (text: string) => void
): Promise<{ text: string; reasoning: string; promptTokens: number; completionTokens: number; cachedTokens: number }> {
  if (!response.body) throw new Error('The model returned an empty stream.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new ThinkingStreamParser();
  const sse = new SseEventParser();
  let text = '';
  let reasoning = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let done = false;

  const handleEvent = (msg: SseMessage) => {
    if (done) return;
    if (msg.data.trim() === '[DONE]') {
      done = true;
      return;
    }
    let data: {
      error?: { message?: string } | string;
      usage?: {
        prompt_tokens?: number;
        input_tokens?: number;
        completion_tokens?: number;
        output_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        prompt_cache_hit_tokens?: number;
      };
      choices?: {
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          reasoning?: string | null;
        };
      }[];
    };
    try {
      data = JSON.parse(msg.data);
    } catch {
      return;
    }
    // An error event (or an error payload) must surface, not vanish into a
    // silently-truncated reply.
    if (msg.event === 'error' || data?.error) {
      const errPayload = data?.error;
      const detail =
        typeof errPayload === 'string'
          ? errPayload
          : (errPayload as { message?: string } | undefined)?.message || 'The model stream failed.';
      throw new Error(detail.slice(0, 240));
    }
    const usage = data?.usage;
    if (usage && typeof usage === 'object') {
      const p = usage.prompt_tokens ?? usage.input_tokens ?? 0;
      const c = usage.completion_tokens ?? usage.output_tokens ?? 0;
      const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0;
      if (Number(p) > 0) promptTokens = Math.floor(Number(p));
      if (Number(c) > 0) completionTokens = Math.floor(Number(c));
      // Only record a cache count when the provider actually reported one —
      // an absent value must not overwrite an earlier real count with 0.
      if (Number.isFinite(Number(cached)) && Number(cached) > 0) cachedTokens = Math.floor(Number(cached));
    }
    const delta = data.choices?.[0]?.delta;
    if (!delta) return;
    for (const chunk of parser.process({
      content: delta.content,
      reasoning_content: delta.reasoning_content,
      reasoning: delta.reasoning,
    })) {
      if (chunk.reasoning) reasoning += chunk.reasoning;
      if (chunk.text) {
        text += chunk.text;
        onText(text);
      }
    }
  };

  while (!done) {
    const { done: readDone, value } = await reader.read();
    if (readDone) break;
    for (const msg of sse.push(decoder.decode(value, { stream: true }))) {
      handleEvent(msg);
    }
  }
  // Flush decoder + parser tails so text that ended exactly at the stream edge
  // is not lost.
  for (const msg of sse.push(decoder.decode())) handleEvent(msg);
  for (const msg of sse.flush()) handleEvent(msg);

  return { text, reasoning, promptTokens, completionTokens, cachedTokens };
}

export async function executeClaimedTurn(opts: {
  supabase: SupabaseClient;
  userId: string;
  chatId: string;
  runId: string;
  apiKey?: string;
}): Promise<{ chain: boolean }> {
  const { supabase, userId, chatId, runId } = opts;
  const chat = await readChat(supabase, chatId, userId);
  const duo = chat ? parseDuo(chat.settings) : null;
  if (!duo || duo.runId !== runId || duo.status !== 'running') {
    return { chain: false };
  }

  if (duo.turn > 0 && duo.turnDelayMs > 0) {
    await sleep(Math.min(duo.turnDelayMs, 6000));
    const afterWait = parseDuo((await readChat(supabase, chatId, userId))?.settings);
    if (!afterWait || afterWait.runId !== runId || afterWait.status !== 'running') {
      await mergeDuo(supabase, chatId, userId, (current) =>
        current.runId === runId ? { ...current, busyUntil: null } : current
      );
      return { chain: false };
    }
  }

  const speakerSide = duo.nextSpeaker;
  const listenerSide = otherSide(speakerSide);
  const [speaker, listener] = await Promise.all([
    loadOwnedAgent(supabase, userId, duo.agents[speakerSide]),
    loadOwnedAgent(supabase, userId, duo.agents[listenerSide]),
  ]);

  if (!speaker || !listener) {
    await mergeDuo(supabase, chatId, userId, (current) => ({
      ...current,
      status: 'error',
      busyUntil: null,
      lastError: 'One of the people in this scene is no longer available.',
    }));
    return { chain: false };
  }

  const listenerName = otherLabel(speaker.name, listener.name);
  // Only this speaker's own secret is loaded here — the other side's
  // secret stays in the database and never enters this prompt.
  const speakerSecret = (duo.secrets?.[speakerSide] || '').trim();
  await settleStaleStreaming(supabase, chatId, userId);

  const { data: recent } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT);
  const done = ((recent || []) as Message[])
    .reverse()
    .filter((m) => m.status === 'done' && m.content?.trim() && m.meta?.duo?.side);

  if (duo.turn === 0 && speaker.character?.first_message?.trim() && !duo.seed.trim()) {
    const opening = formatRoleplayText(speaker.character.first_message, speaker.name, listenerName).trim();
    const parentId = done.length ? done[done.length - 1].id : null;
    const messageId = await insertMessage(supabase, {
      chatId,
      userId,
      parentId,
      content: opening,
      status: 'done',
      side: speakerSide,
      agent: speaker,
    });
    await supabase.from('chats').update({ leaf_id: messageId }).eq('id', chatId).eq('user_id', userId);
    const next = await advance(supabase, chatId, userId, runId, speakerSide, opening, done);
    return { chain: next?.status === 'running' };
  }

  const prior = done.slice();
  let latest = '';
  const last = prior[prior.length - 1];
  if (last && last.meta?.duo?.side !== speakerSide) {
    latest = last.content;
    prior.pop();
  }
  if (!latest) {
    latest = `(The scene begins. ${listenerName} is here. Reply only as ${speaker.name}. Do not write ${listenerName}'s words.)`;
  }

  const floor = ratingFloor(speaker, listener);
  const speakingAs = agentAsCharacter(speaker, {
    scene: duo.seed,
    otherName: listenerName,
    ratingFloor: floor,
  });
  const heardAs = agentAsPersona(listener);
  heardAs.name = listenerName;

  const note = [
    duo.seed.trim() ? `Scene: ${duo.seed.trim()}` : '',
    speakerSecret
      ? `[Private direction for ${speaker.name} only — ${listenerName} cannot hear this. Follow it naturally without revealing that you received a secret instruction: ${speakerSecret}]`
      : '',
    `Write only ${speaker.name}'s next message. ${listenerName} replies on their own turn.`,
  ]
    .filter(Boolean)
    .join('\n');

  const assembled = assemblePrompt({
    character: speakingAs,
    persona: heardAs,
    history: prior.map((m) => ({
      ...m,
      role: m.meta?.duo?.side === speakerSide ? 'assistant' : 'user',
    })),
    authorsNote: note,
    latestUserMessage: latest,
    historyTokenBudget: 5000,
  });

  const parentId = done.length ? done[done.length - 1].id : null;
  const model = getLlmModel(undefined, opts.apiKey);
  const messageId = await insertMessage(supabase, {
    chatId,
    userId,
    parentId,
    content: '',
    status: 'streaming',
    side: speakerSide,
    agent: speaker,
    model,
  });

  const verbosity = speakingAs.behavior?.verbosity || 'medium';
  const maxTokens = Math.min((VERBOSITY_GUIDE[verbosity] ?? VERBOSITY_GUIDE.medium).maxTokens, 1000);
  const started = Date.now();

  let raw = '';
  let reasoning = '';
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let lastWritten = '';
  let lastWriteAt = 0;
  let writeChain: Promise<void> = Promise.resolve();

  const flush = (text: string, force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteAt < WRITE_EVERY_MS) return;
    if (text === lastWritten) return;
    lastWritten = text;
    lastWriteAt = now;
    writeChain = writeChain.then(async () => {
      await supabase.from('messages').update({ content: text }).eq('id', messageId).eq('user_id', userId);
    }).catch(() => undefined);
  };

  try {
    if (!getLlmApiKey(opts.apiKey)) {
      throw new Error('Add an API key in Settings so the scene can run.');
    }
    const response = await streamChatCompletions(assembled, {
      apiKey: opts.apiKey,
      sessionId: `${chatId}:${speakerSide}`,
      temperature: speakingAs.behavior?.temperature ?? 1,
      thinking: false,
      max_tokens: maxTokens,
      presence_penalty: speakingAs.behavior?.presence_penalty,
      frequency_penalty: speakingAs.behavior?.frequency_penalty,
      stop: [`\n${listenerName}:`, `\n${listenerName.toUpperCase()}:`],
      signal: AbortSignal.timeout(45_000),
    });
    const consumed = await consumeStream(response, (text) => {
      raw = text;
      flush(sanitizeModelOutput(text, speaker.name));
    });
    raw = consumed.text || raw;
    reasoning = consumed.reasoning;
    promptTokens = consumed.promptTokens;
    completionTokens = consumed.completionTokens;
    cachedTokens = consumed.cachedTokens;
  } catch (err) {
    await writeChain;
    const partial = cutAtOtherName(sanitizeModelOutput(raw, speaker.name), listenerName);
    if (partial.trim().length > 24) {
      await supabase
        .from('messages')
        .update({ content: partial, status: 'done', reasoning: reasoning || null })
        .eq('id', messageId)
        .eq('user_id', userId);
      const next = await advance(supabase, chatId, userId, runId, speakerSide, partial, done);
      return { chain: next?.status === 'running' };
    }
    await supabase
      .from('messages')
      .update({ status: 'error', content: partial })
      .eq('id', messageId)
      .eq('user_id', userId);
    const message = err instanceof Error ? err.message : 'The model failed on this turn.';
    await mergeDuo(supabase, chatId, userId, (current) => ({
      ...current,
      status: 'error',
      busyUntil: null,
      lastError: message.slice(0, 240),
    }));
    return { chain: false };
  }

  await writeChain;
  const cleaned = cutAtOtherName(sanitizeModelOutput(raw, speaker.name), listenerName);
  if (!cleaned) {
    await supabase.from('messages').update({ status: 'error' }).eq('id', messageId).eq('user_id', userId);
    await mergeDuo(supabase, chatId, userId, (current) => ({
      ...current,
      status: 'error',
      busyUntil: null,
      lastError: `${speaker.name} didn't say anything. Resume to try that turn again.`,
    }));
    return { chain: false };
  }

  const finalPrompt = promptTokens || estimateTokens(assembled.map((m) => m.content).join('\n'));
  const finalCompletion = completionTokens || estimateTokens(cleaned);
  await supabase
    .from('messages')
    .update({
      content: cleaned,
      status: 'done',
      reasoning: reasoning || null,
      meta: {
        model,
        tokens_in: finalPrompt,
        tokens_out: finalCompletion,
        cached_tokens: cachedTokens,
        duo: { side: speakerSide, kind: speaker.kind, id: speaker.id, name: speaker.name },
      },
    })
    .eq('id', messageId)
    .eq('user_id', userId);
  await supabase.from('chats').update({ leaf_id: messageId }).eq('id', chatId).eq('user_id', userId);

  void supabase
    .from('usage_events')
    .insert({
      user_id: userId,
      chat_id: chatId,
      kind: 'chat',
      model: 'chat-completion',
      prompt_tokens: finalPrompt,
      completion_tokens: finalCompletion,
      cached_tokens: cachedTokens,
    })
    .then(() => undefined, () => undefined);

  // The per-side secret is private direction for one model only. It travels in
  // the prompt, so before anything is persisted to llm_logs (viewable alongside
  // the other side's turns) every copy of it is redacted.
  const redactSecret = (s: string) =>
    speakerSecret ? s.split(speakerSecret).join('[private direction redacted]') : s;
  const logMessages = speakerSecret
    ? assembled.map((m) => ({ ...m, content: redactSecret(m.content) }))
    : assembled;

  void supabase
    .from('llm_logs')
    .insert({
      user_id: userId,
      chat_id: chatId,
      character_id: speaker.kind === 'character' ? speaker.id : null,
      kind: 'chat',
      model,
      params: { temperature: speakingAs.behavior?.temperature ?? 1, max_tokens: maxTokens, thinking: false, duo: true },
      request_messages: logMessages,
      user_message: latest,
      output: redactSecret(cleaned),
      reasoning: reasoning ? redactSecret(reasoning) : null,
      prompt_tokens: finalPrompt,
      completion_tokens: finalCompletion,
      cached_tokens: cachedTokens,
      latency_ms: Date.now() - started,
    })
    .then(() => undefined, () => undefined);

  const next = await advance(supabase, chatId, userId, runId, speakerSide, cleaned, done);
  return { chain: next?.status === 'running' };
}

async function advance(
  supabase: SupabaseClient,
  chatId: string,
  userId: string,
  runId: string,
  speakerSide: DuoSide,
  text: string,
  priorDone: Message[]
) {
  const previous = [...priorDone].reverse().find((m) => m.meta?.duo?.side === speakerSide);
  const repeated = previous ? tooSimilar(text, previous.content) : false;

  return mergeDuo(supabase, chatId, userId, (current) => {
    if (current.runId !== runId) return { ...current, busyUntil: null };
    const turn = current.turn + 1;
    let status = current.status;
    let lastError = current.lastError;
    if (status === 'running') {
      if (repeated) {
        status = 'paused';
        lastError = 'Paused — the same line was coming back.';
      } else if (turn >= current.maxTurns) {
        status = 'done';
        lastError = null;
      }
    }
    return {
      ...current,
      turn,
      nextSpeaker: otherSide(speakerSide),
      status,
      lastError,
      busyUntil: null,
    };
  });
}
