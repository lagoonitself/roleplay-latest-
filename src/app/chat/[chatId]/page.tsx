'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Sparkles,
  Send,
  Square,
  ChevronDown,
  Trash2,
  Brain,
  Bookmark,
  X,
  User,
  MoreVertical,
  ExternalLink,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { makeCharacter } from '@/lib/cards/card-parser';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { RegexManagerModal } from '@/components/chat/regex-manager-modal';
import { useRegexScripts } from '@/lib/store/regex-store';
import { useKeyboardViewport } from '@/lib/hooks/use-keyboard-viewport';
import { processPromptTime, sanitizeModelOutput } from '@/lib/formatter/regex-engine';
import { formatRoleplayText, joinContinuation } from '@/lib/prompt/macros';
import { extractThinking } from '@/lib/llm/stream-parser';
import { recordLocalUsage } from '@/lib/usage/tokens';
import { saveLocalLog, makeLogId, type LlmLogEntry } from '@/lib/logs/llm-log-store';
import {
  saveLocalChat,
  getLocalChat,
  deleteChat,
  getLocalMessages,
  saveLocalMessages,
  getLocalMemories,
  saveLocalMemories,
  getLocalChatState,
  saveLocalChatState,
  getLocalSummary,
  saveLocalSummary,
  getLocalAuthorsNote,
  saveLocalAuthorsNote,
  type LocalAuthorsNote,
} from '@/lib/chats/chat-manager';
import { SillyTavernContextInspector } from '@/components/chat/sillytavern-context-inspector';
import { SillyTavernQuickActions } from '@/components/chat/sillytavern-quick-actions';
import { useSoundEffects, playSendSound, playReceiveSound } from '@/lib/audio/sound-effects';
import { DEFAULT_PRESET_ID, SILLY_TAVERN_SYSTEM_PROMPT_PRESETS } from '@/lib/prompt/presets';
import { toast } from 'sonner';
import type { Chat, Character, Persona, Message, Memory, Summary, ChatState } from '@/lib/supabase/types';
import { resolveLlmKey, hasLlmCredentials, missingCredentialsMessage } from '@/lib/llm/credentials';
import { MessageRow } from '@/components/chat/message-row';
import { MessageActionsSheet } from '@/components/chat/message-actions-sheet';
import { useEvent, useVisualViewportVars } from '@/lib/hooks';
import { MEMORY_COLUMNS, MEMORY_LIST_LIMIT } from '@/lib/memory/queries';

// Local temp ids (usr-/ast-/msg-) are never valid Supabase UUIDs.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (id?: string | null): boolean => Boolean(id && UUID_REGEX.test(id));

async function getAuthHeaders(supabaseClient: ReturnType<typeof createClient>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data } = await supabaseClient.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  } catch {}
  return headers;
}

// Unknown-safe AbortError check for stream/fetch failure branches.
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

// Smooth scrolling is motion too: honour prefers-reduced-motion for
// programmatic scrolls (CSS scroll-behavior does not cover JS scroll APIs).
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// ── Developer LLM log persistence (module scope, not a hook) ──
// The server ships the COMPLETE assembled prompt per turn as an `llmLog`
// SSE event (system + history + turn_context + params + raw output).
// Stored in localStorage from now on; server also keeps a Supabase row.
function persistLlmLog(payload: unknown) {
  if (!payload || typeof payload !== 'object') return;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.requestMessages)) return;
  try {
    const entry: LlmLogEntry = {
      id: makeLogId(),
      createdAt: new Date().toISOString(),
      chatId: String(p.chatId || ''),
      characterId: String(p.characterId || ''),
      characterName: String(p.characterName || ''),
      kind:
        p.kind === 'swipe' || p.kind === 'regen' || p.kind === 'continue' || p.kind === 'impersonate'
          ? p.kind
          : 'chat',
      model: String(p.model || ''),
      params: (p.params || { temperature: 0, max_tokens: 0, thinking: false, top_p: 0 }) as LlmLogEntry['params'],
      requestMessages: p.requestMessages as LlmLogEntry['requestMessages'],
      userMessage: String(p.userMessage || ''),
      output: String(p.output || ''),
      reasoning: (p.reasoning as string | null) ?? null,
      usage: (p.usage || { input: 0, output: 0, total: 0 }) as LlmLogEntry['usage'],
      latencyMs: Number(p.latencyMs) || 0,
      serverId: (p.serverId as string | number | null) ?? null,
    };
    saveLocalLog(entry);
  } catch {}
}

// ── Edit-rewind SSE consumer (module scope, not a hook) ──
// Consumes the /api/chat event stream for Feature 3 regeneration and returns a
// deterministic result. Callers persist from the returned value instead of
// re-reading React state (updater closures can be stale/batched, which would
// risk saving the wrong timeline to localStorage/Supabase).
interface StreamRegenResult {
  text: string;
  reasoning: string;
  reasoningDuration: number;
  aborted: boolean;
  failed: boolean;
  metaSync?: {
    chatId?: string;
    userMsgId?: string;
    assistantMsgId?: string;
    reasoning_duration_seconds?: number;
  };
}

async function streamRegeneratedReply(
  response: Response,
  opts: {
    charName: string;
    userName: string;
    onReasoning: (fullReasoning: string) => void;
    onThinkingDone: (seconds: number) => void;
    onText: (formattedLive: string) => void;
    onMetaSync?: (metaSync: NonNullable<StreamRegenResult['metaSync']>) => void;
  }
): Promise<StreamRegenResult> {
  const { charName, userName, onReasoning, onThinkingDone, onText, onMetaSync } = opts;
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let streamedContent = '';
  let streamedReasoning = '';
  let thinkingEnded = false;
  let reasoningDuration = 0;
  let receivedMetaSync: StreamRegenResult['metaSync'] = undefined;
  const genStartTime = Date.now();

  const finishThinking = () => {
    if (thinkingEnded) return reasoningDuration;
    thinkingEnded = true;
    reasoningDuration = Math.max(1, Math.round((Date.now() - genStartTime) / 1000));
    onThinkingDone(reasoningDuration);
    return reasoningDuration;
  };

  try {
    if (reader) {
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const lineTrimmed = line.trim();
          if (lineTrimmed.startsWith('data: ') && lineTrimmed !== 'data: [DONE]') {
            try {
              const parsed = JSON.parse(lineTrimmed.slice(6));
              // Feature 2 (additive): instant local token ledger — ignores text/reasoning.
              if (parsed.usage) {
                const uIn = Math.max(0, Math.floor(Number(parsed.usage.input) || 0));
                const uOut = Math.max(0, Math.floor(Number(parsed.usage.output) || 0));
                if (uIn > 0 || uOut > 0) recordLocalUsage(uIn, uOut);
              }
              if (parsed.llmLog) persistLlmLog(parsed.llmLog);
              if (parsed.metaSync) {
                receivedMetaSync = parsed.metaSync;
                if (parsed.metaSync.reasoning_duration_seconds && !reasoningDuration) {
                  reasoningDuration = parsed.metaSync.reasoning_duration_seconds;
                }
                onMetaSync?.(parsed.metaSync);
              }
              if (parsed.reasoning) {
                streamedReasoning += parsed.reasoning;
                onReasoning(streamedReasoning);
              }
              if (parsed.reasoningDone) finishThinking();
              if (parsed.text) {
                if (!thinkingEnded && streamedReasoning) finishThinking();
                streamedContent += parsed.text;
                onText(formatRoleplayText(streamedContent, charName, userName));
              }
            } catch {
              // ignore malformed SSE lines
            }
          }
        }
      }
    }
  } catch (err) {
    if (isAbortError(err)) {
      return { text: streamedContent, reasoning: streamedReasoning, reasoningDuration, aborted: true, failed: false, metaSync: receivedMetaSync };
    }
    // Non-abort read failure: hand the partial transcript back so the caller
    // can persist it as an error bubble instead of dropping it.
    return { text: streamedContent, reasoning: streamedReasoning, reasoningDuration, aborted: false, failed: true, metaSync: receivedMetaSync };
  }

  if (!reasoningDuration && streamedReasoning) {
    finishThinking();
  }
  return { text: streamedContent, reasoning: streamedReasoning, reasoningDuration, aborted: false, failed: false, metaSync: receivedMetaSync };
}

// Older builds saved a fake "[Connection interrupted…]" line as the reply text.
// Failed replies are a status now; strip the legacy text so the error card shows.
const LEGACY_ERROR_TEXT = /^\*?\[Connection interrupted\. Tap retry to continue\.\]\*?$/;
function healLegacyErrors(list: Message[]): Message[] {
  return list.map((m) =>
    m.role === 'assistant' && LEGACY_ERROR_TEXT.test((m.content || '').trim())
      ? { ...m, status: 'error' as const, content: '', meta: { ...m.meta, swipes: [''], active_swipe_index: 0 } }
      : m
  );
}

const isTempId = (id: string) => id.startsWith('usr-') || id.startsWith('ast-') || id === 'msg-greeting';

// A cached `streaming` bubble belongs to a request this page no longer owns (the user
// left mid-reply). Empty ones are dropped; partial ones are shown as stopped.
function settleInterrupted(list: Message[]): Message[] {
  return list
    .filter((m) => !(m.status === 'streaming' && !m.content?.trim() && !m.reasoning))
    .map((m) => (m.status === 'streaming' ? { ...m, status: 'stopped' as const } : m));
}

// Cached messages the cloud does not have yet. Temporary assistant bubbles are always
// superseded by the server's saved row (or were never generated), so only unsent user
// turns and a trailing error card survive.
function pendingLocalMessages(local: Message[], cloud: Message[]): Message[] {
  const cloudIds = new Set(cloud.map((m) => m.id));
  const cloudUserTexts = new Set(cloud.filter((m) => m.role === 'user').map((m) => m.content));
  return local.filter((m, i) => {
    if (cloudIds.has(m.id)) return false;
    if (!isTempId(m.id) || m.id === 'msg-greeting') return false;
    if (m.role === 'user') return !cloudUserTexts.has(m.content);
    return m.role === 'assistant' && m.status === 'error' && i === local.length - 1;
  });
}

// The request only needs what the prompt uses. Shipping every swipe, reasoning
// trace and meta blob of a long chat on each turn was pure payload weight.
const HISTORY_PAYLOAD_LIMIT = 100;
function slimHistory(list: Message[]): Array<Pick<Message, 'id' | 'role' | 'content' | 'status'>> {
  return list
    .filter((m) => m.status !== 'error' && m.status !== 'streaming' && m.content?.trim())
    .slice(-HISTORY_PAYLOAD_LIMIT)
    .map((m) => ({ id: m.id, role: m.role, content: m.content, status: m.status }));
}

// Builds the streaming assistant placeholder for edit-rewind regeneration.
// Module scope so id/timestamp creation stays out of the component body.
function makeRegenPlaceholder(chatId: string, parentId: string | null): Message {
  const nowIso = new Date().toISOString();
  return {
    id: 'ast-' + Date.now(),
    chat_id: chatId,
    user_id: 'assistant',
    parent_id: parentId,
    role: 'assistant',
    content: '',
    reasoning: null,
    status: 'streaming',
    meta: {
      swipes: [''],
      active_swipe_index: 0,
      reasoning_swipes: [''],
      reasoning_durations: [],
    },
    created_at: nowIso,
    updated_at: nowIso,
  };
}

// Realtime events arrive in bursts; JSON.stringify-ing the whole transcript
// per event is wasted main-thread work. Coalesce writes to one per 250ms.
let localSaveTimer: ReturnType<typeof setTimeout> | null = null;
let localSavePending: { chatId: string; messages: Message[] } | null = null;
function scheduleLocalSave(chatId: string, messages: Message[]) {
  localSavePending = { chatId, messages };
  if (localSaveTimer) return;
  localSaveTimer = setTimeout(() => {
    localSaveTimer = null;
    const pending = localSavePending;
    localSavePending = null;
    if (pending) saveLocalMessages(pending.chatId, pending.messages);
  }, 250);
}

export default function ChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const chatId = params?.chatId as string;
  const charIdParam = searchParams.get('charId');

  const [settings, updateSettings] = useSettings();
  const supabase = createClient();

  const [character, setCharacter] = useState<Character | null>(null);
  const [activePersona, setActivePersona] = useState<Persona | null>(null);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Memory & Inspector Panel
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [currentSummary, setCurrentSummary] = useState<Summary | null>(null);
  const [chatState, setChatState] = useState<ChatState['state']>({});
  const [inspectorRecall, setInspectorRecall] = useState<Array<{ content: string; score?: number }>>([]);
  const [inspectorLore, setInspectorLore] = useState<Array<{ id: string; title: string; keys: string[]; content: string }>>([]);
  const [currentPresetId, setCurrentPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [isImpersonating, setIsImpersonating] = useState(false);

  // Refresh the memory context shown in the inspector whenever it opens: one call
  // returns the memory bank, summary, scene state, and what recall would surface.
  useEffect(() => {
    if (!inspectorOpen) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/chat/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list',
            chatId,
            character,
            persona: activePersona,
            history: messages,
            memories,
            summary: currentSummary,
            state: chatState,
            includeRecall: true,
          }),
        });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        if (Array.isArray(data.memories)) setMemories(data.memories);
        if (data.summary) setCurrentSummary(data.summary);
        if (data.state) setChatState(data.state);
        if (Array.isArray(data.recalled)) setInspectorRecall(data.recalled);
        if (Array.isArray(data.lore)) setInspectorLore(data.lore);
      } catch {
        // The panel still works with whatever is already loaded.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh on open only
  }, [inspectorOpen]);

  // Editing in-place
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  // Two-step confirm for destructive "delete from here" truncation
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Author's note (SillyTavern Floating Prompt)
  const [authorsNote, setAuthorsNote] = useState<LocalAuthorsNote>({
    prompt: '',
    depth: 4,
    interval: 1,
    role: 'system',
    position: 'in_chat',
  });
  const [showAuthorsNote, setShowAuthorsNote] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

  // Regex Scripts & Output Formatters
  const { scripts: regexScripts } = useRegexScripts();
  const [regexModalOpen, setRegexModalOpen] = useState(false);
  const regexActiveCount = useMemo(() => regexScripts.filter((s) => s.enabled).length, [regexScripts]);

  const handleDeleteCurrentChat = async () => {
    if (confirm('Delete this entire chat session? This cannot be undone.')) {
      try {
        const ok = await deleteChat(chatId);
        if (ok) {
          toast.success('Chat deleted');
        } else {
          toast.error('Could not delete the chat — please try again');
        }
      } catch {
        toast.error('Could not delete the chat — please try again');
      }
      router.push('/?tab=chats');
    }
  };

  // Streaming renders: tokens arrive far faster than the screen refreshes. Updates
  // are composed and applied once per animation frame instead of once per token.
  const pendingStreamUpdate = useRef<((prev: Message[]) => Message[]) | null>(null);
  const streamFrame = useRef<number | null>(null);
  const queueStreamUpdate = (updater: (prev: Message[]) => Message[]) => {
    const previous = pendingStreamUpdate.current;
    pendingStreamUpdate.current = previous ? (list) => updater(previous(list)) : updater;
    if (streamFrame.current !== null) return;
    streamFrame.current = requestAnimationFrame(() => {
      streamFrame.current = null;
      const pending = pendingStreamUpdate.current;
      pendingStreamUpdate.current = null;
      if (pending) setMessages(pending);
    });
  };
  const flushStreamUpdate = () => {
    if (streamFrame.current !== null) {
      cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
    }
    const pending = pendingStreamUpdate.current;
    pendingStreamUpdate.current = null;
    if (pending) setMessages(pending);
  };

  // Latest timeline, readable synchronously. React runs setState updaters lazily, so
  // reading a value assigned inside one right after the call often saw `[]` — and
  // that empty list was then written over the local cache. It also keeps working
  // after the page unmounts (user navigated away mid-reply), so the reply still lands.
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const commitMessages = (updater: (prev: Message[]) => Message[]): Message[] => {
    if (streamFrame.current !== null) {
      cancelAnimationFrame(streamFrame.current);
      streamFrame.current = null;
    }
    const pending = pendingStreamUpdate.current;
    pendingStreamUpdate.current = null;
    const base = pending ? pending(messagesRef.current) : messagesRef.current;
    const next = updater(base);
    messagesRef.current = next;
    setMessages(next);
    return next;
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Web Audio sound effects
  const [soundEnabled, toggleSound] = useSoundEffects();

  // Quick insertion & formatting for roleplay composer
  const handleFormatInput = (prefix: string, suffix: string = prefix, defaultPlaceholder: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const current = inputText;
    const selected = current.substring(start, end) || defaultPlaceholder;
    const replacement = `${prefix}${selected}${suffix}`;
    const updated = current.substring(0, start) + replacement + current.substring(end);
    setInputText(updated);
    setTimeout(() => {
      textarea.focus();
      if (start === end && !defaultPlaceholder) {
        const newPos = start + prefix.length;
        textarea.setSelectionRange(newPos, newPos);
      } else {
        const newPos = start + replacement.length;
        textarea.setSelectionRange(newPos, newPos);
      }
    }, 10);
  };

  const scrollToBottom = (smooth = true) => {
    const behavior: ScrollBehavior = smooth && !prefersReducedMotion() ? 'smooth' : 'instant';
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior,
      });
      setIsAtBottom(true);
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
      setIsAtBottom(true);
    }
  };

  // Keep the latest turn in view when the keyboard shrinks the transcript.
  const { keyboardOpen, height: keyboardViewportHeight } = useKeyboardViewport();
  useEffect(() => {
    if (keyboardOpen && isAtBottom) scrollToBottom(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on viewport changes
  }, [keyboardOpen, keyboardViewportHeight]);

  const handleChatScroll = () => {
    const el = chatContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsAtBottom(distanceFromBottom < 120);
  };

  // 1. Load Persona, Character, Messages, State
  useEffect(() => {
    // Guards against a slower stale load clobbering a newer chat (rapid
    // navigation between chats used to cross-wire their transcripts) and
    // against setting state after unmount.
    let cancelled = false;

    async function initChat() {
      const isCloudChat = isUuid(chatId);

      // Paint the cached transcript right away; the cloud copy reconciles below.
      const cachedMsgs = healLegacyErrors(getLocalMessages(chatId));
      if (cachedMsgs.length > 0) setMessages(settleInterrupted(cachedMsgs));

      // Everything the page needs from the cloud is independent — fetch it all at once
      // instead of one round trip after another.
      const dbChatPromise = isCloudChat
        ? Promise.resolve(
            supabase.from('chats').select('*, character:characters(*)').eq('id', chatId).maybeSingle()
          ).then(
            ({ data }) => (data as Chat) || null,
            (e) => {
              console.error('Error fetching Supabase chat:', e);
              return null;
            }
          )
        : Promise.resolve(null);
      const dbMsgsPromise = isCloudChat
        ? Promise.resolve(
            supabase.from('messages').select('*').eq('chat_id', chatId).order('created_at', { ascending: true })
          ).then(
            ({ data, error }) => (error ? null : ((data as Message[]) || [])),
            (e) => {
              console.error('Error fetching Supabase messages:', e);
              return null;
            }
          )
        : Promise.resolve(null);
      const memoryContextPromise = isCloudChat
        ? Promise.all([
            supabase
              .from('memories')
              .select(MEMORY_COLUMNS)
              .eq('chat_id', chatId)
              .is('superseded_by', null)
              .order('importance', { ascending: false })
              .limit(MEMORY_LIST_LIMIT),
            supabase
              .from('summaries')
              .select('*')
              .eq('chat_id', chatId)
              .eq('superseded', false)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),
            supabase.from('chat_state').select('*').eq('chat_id', chatId).maybeSingle(),
          ]).catch(() => null)
        : Promise.resolve(null);
      // The session is read from local storage — no network round trip like getUser().
      const sessionPromise = supabase.auth.getSession().then(
        ({ data }) => data.session?.user?.id,
        () => undefined
      );
      const personasPromise = sessionPromise.then((uid) =>
        uid
          ? Promise.resolve(
              supabase.from('personas').select('*').order('created_at', { ascending: false })
            ).then(
              ({ data }) => (data as Persona[]) || [],
              () => [] as Persona[]
            )
          : ([] as Persona[])
      );

      // 0. Load any existing local or Supabase chat metadata
      let existingChat: Chat | null = getLocalChat(chatId);
      const dbChat = await dbChatPromise;
      if (dbChat) existingChat = dbChat;

      // Duo scenes live on /duo/[id] — bounce if this chat is one.
      if (cancelled) return;
      if (
        existingChat &&
        ((existingChat as Chat).mode === 'duo' || (existingChat.settings as Record<string, unknown>)?.duo)
      ) {
        router.replace(`/duo/${chatId}`);
        return;
      }

      // A. Load Active Persona
      let resolvedPersona: Persona | null = null;
      let localPersonas: Persona[] = [];
      try {
        localPersonas = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
      } catch {}

      const userId = await sessionPromise;
      const targetPersonaId = existingChat?.persona_id || settings.activePersonaId;

      if (userId) {
        const dbPersonas = await personasPromise;

        if (dbPersonas.length > 0) {
          const list = dbPersonas;
          resolvedPersona =
            list.find((p) => p.id === targetPersonaId) ||
            list.find((p) => p.is_default) ||
            list[0];
        }
      }

      if (!resolvedPersona && localPersonas.length > 0) {
        resolvedPersona =
          localPersonas.find((p) => p.id === targetPersonaId) ||
          localPersonas.find((p) => p.is_default) ||
          localPersonas[0];
      }

      if (!resolvedPersona) {
        resolvedPersona = {
          id: 'persona-default-alexander',
          user_id: userId || 'guest',
          name: 'Alexander Vance',
          avatar_url: null,
          description: 'A sharp, composed, yet deeply observant companion.',
          is_default: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        try {
          localStorage.setItem('cadenza_local_personas', JSON.stringify([resolvedPersona]));
        } catch {}
      }

      if (cancelled) return;
      setActivePersona(resolvedPersona);

      // B. Load Character - Multi-tier reliable resolution
      let charObj: Character | null = null;

      // 1. If existing chat already has a valid character object with a name
      if (
        existingChat?.character &&
        existingChat.character.name &&
        existingChat.character.name !== 'Roleplay Partner' &&
        existingChat.character.name !== 'Unnamed Character'
      ) {
        charObj = existingChat.character as Character;
      }

      // 2. Identify target character identifier (from charIdParam, chat.character_id, or chat.character.id)
      const targetCharIdentifier =
        charIdParam ||
        existingChat?.character_id ||
        (existingChat?.character?.id && existingChat.character.id !== 'char-fallback' ? existingChat.character.id : null);

      // 3. Search local characters roster in localStorage
      let localChars: Character[] = [];
      try {
        localChars = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      } catch {}

      if (!charObj && targetCharIdentifier) {
        const decodedTarget = decodeURIComponent(targetCharIdentifier).toLowerCase();
        const found = localChars.find(
          (c) =>
            c.id === targetCharIdentifier ||
            c.id.toLowerCase() === decodedTarget ||
            c.name.toLowerCase() === decodedTarget
        );
        if (found) charObj = found;
      }

      // 4. Search Supabase characters
      if (!charObj && targetCharIdentifier) {
        try {
          if (isUuid(targetCharIdentifier)) {
            const { data: dbC } = await supabase
              .from('characters')
              .select('*')
              .eq('id', targetCharIdentifier)
              .maybeSingle();

            if (dbC) charObj = dbC as Character;
          } else {
            const { data: dbC } = await supabase
              .from('characters')
              .select('*')
              .ilike('name', targetCharIdentifier)
              .maybeSingle();

            if (dbC) charObj = dbC as Character;
          }
        } catch {}
      }

      // 5. Match by chat title (e.g. "Chat with Cassandra \"Cass\" Miller" -> Cassandra "Cass" Miller)
      if (!charObj && existingChat?.title) {
        const titleCharName = existingChat.title.replace(/^Chat with\s+/i, '').trim();
        if (
          titleCharName &&
          titleCharName !== 'Roleplay Partner' &&
          titleCharName !== 'Unnamed Character' &&
          titleCharName !== 'Character'
        ) {
          const lowerTitleName = titleCharName.toLowerCase();
          // Check local chars
          const foundInLocal = localChars.find(
            (c) =>
              c.name.toLowerCase() === lowerTitleName ||
              c.name.toLowerCase().includes(lowerTitleName) ||
              lowerTitleName.includes(c.name.toLowerCase())
          );
          if (foundInLocal) {
            charObj = foundInLocal;
          } else {
            // Check DB
            try {
              const { data: dbMatches } = await supabase
                .from('characters')
                .select('*')
                .ilike('name', `%${titleCharName}%`)
                .limit(1);
              if (dbMatches && dbMatches[0]) {
                charObj = dbMatches[0] as Character;
              }
            } catch {}
          }
        }
      }

      // 6. Enrich avatar if character object is missing avatar_url
      if (charObj && !charObj.avatar_url) {
        const match = localChars.find((c) => c.name.toLowerCase() === charObj?.name.toLowerCase());
        if (match?.avatar_url) {
          charObj = { ...charObj, avatar_url: match.avatar_url };
        }
      }

      // 7. Dynamic fallback ONLY if completely unresolved
      if (!charObj) {
        const cleanName = charIdParam
          ? decodeURIComponent(charIdParam).replace(/^local-char-\d+-?/, '').replace(/-/g, ' ')
          : existingChat?.title
          ? existingChat.title.replace(/^Chat with\s+/i, '').trim()
          : 'Roleplay Partner';

        charObj = makeCharacter({
          id: targetCharIdentifier || `char-${Date.now()}`,
          user_id: userId || 'guest',
          name: cleanName || 'Roleplay Partner',
          tagline: 'Custom Roleplay Character',
          description: 'An evocative roleplay partner.',
          personality: 'Immersive, observant, deeply engaging.',
          scenario: 'An ongoing interactive narrative.',
          first_message: `*I look at you quietly, taking in your arrival.* "You're finally here," I murmur softly.`,
          speech_style: 'Descriptive, evocative prose.',
          tags: ['Custom'],
          content_rating: 'mature',
        });
      }

      if (cancelled) return;
      setCharacter(charObj);

      // C. Load Messages & History
      const charName = charObj.name || 'Character';
      const userName = resolvedPersona.name || 'User';

      let loadedMessages: Message[] = [];
      // Re-read the cache: a reply that finished after the first paint may have landed.
      const localMsgs = settleInterrupted(healLegacyErrors(getLocalMessages(chatId)));

      // 1. Fetch from Supabase if not a local chat
      const dbMsgs = await dbMsgsPromise;
      if (dbMsgs && dbMsgs.length > 0) {
        loadedMessages = dbMsgs;
      }

      // 2. Reconcile with LocalStorage. The cloud is the source of truth (it is what
      // other devices see); the cache only contributes what never reached it.
      if (loadedMessages.length === 0) {
        if (localMsgs.length > 0) {
          loadedMessages = localMsgs;
        }
      } else if (localMsgs.length > 0) {
        // A. Heal inflated reasoning timers: if local recorded e.g. 8s and DB has 140s, use the accurate live duration
        const localById = new Map(localMsgs.map((m) => [m.id, m]));
        loadedMessages = loadedMessages.map((dbMsg) => {
          const localMatch = localById.get(dbMsg.id) || localMsgs.find((lm) => lm.role === dbMsg.role && lm.content === dbMsg.content);
          if (localMatch?.meta?.reasoning_duration_seconds) {
            const localDur = localMatch.meta.reasoning_duration_seconds;
            const dbDur = dbMsg.meta?.reasoning_duration_seconds;
            if (!dbDur || (localDur < dbDur && dbDur > 30)) {
              return {
                ...dbMsg,
                meta: {
                  ...dbMsg.meta,
                  reasoning_duration_seconds: localDur,
                },
              };
            }
          }
          return dbMsg;
        });

        // B. Preserve local messages that never reached the DB — but not the temporary
        // copies of rows the server already saved under their real ids (those showed up
        // twice), nor rows another device deleted.
        const unsavedLocal = pendingLocalMessages(localMsgs, loadedMessages);
        if (unsavedLocal.length > 0) {
          loadedMessages = [...loadedMessages, ...unsavedLocal];
        }
      }

      if (loadedMessages.length > 0) {
        const cleanedMsgs = loadedMessages.map((m) => {
          let reasoning = m.reasoning;
          let content = m.content || '';
          if (!reasoning && (content.includes('<think>') || content.includes('<thought>'))) {
            const extracted = extractThinking(content);
            content = extracted.text;
            reasoning = extracted.reasoning;
          }
          return {
            ...m,
            reasoning: reasoning || null,
            content: formatRoleplayText(content, charName, userName),
          };
        });
        setMessages(cleanedMsgs);
        saveLocalMessages(chatId, cleanedMsgs);
      } else {
        // ONLY if no messages exist anywhere, seed the character's initial greeting
        const rawFirst = charObj.first_message || '*I look at you with quiet attention.*';
        const formattedFirst = formatRoleplayText(rawFirst, charName, userName);

        const rawSwipes = [rawFirst, ...(charObj.alternate_greetings || [])];
        const formattedSwipes = rawSwipes.map((s) => formatRoleplayText(s, charName, userName));

        const initialMsg: Message = {
          id: 'msg-greeting',
          chat_id: chatId,
          user_id: 'system',
          parent_id: null,
          role: 'assistant',
          content: formattedFirst,
          reasoning: null,
          status: 'done',
          meta: {
            swipes: formattedSwipes,
            active_swipe_index: 0,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        setMessages([initialMsg]);
        if (localMsgs.length === 0) {
          saveLocalMessages(chatId, [initialMsg]);
        }

        // Persist opening greeting to Supabase on turn 0 so history is never empty in cloud
        if (userId && isUuid(chatId)) {
          Promise.resolve(
            supabase
              .from('messages')
              .insert({
                chat_id: chatId,
                user_id: userId,
                parent_id: null,
                role: 'assistant',
                content: formattedFirst,
                status: 'done',
                meta: {
                  swipes: formattedSwipes,
                  active_swipe_index: 0,
                },
              })
              .select('id')
              .single()
          )
            .then(({ data: dbGreeting }) => {
              if (cancelled) return;
              if (dbGreeting?.id) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === 'msg-greeting' ? { ...m, id: dbGreeting.id } : m))
                );
                saveLocalMessages(chatId, [{ ...initialMsg, id: dbGreeting.id }]);
              }
            })
            .catch(() => {});
        }
      }

      // D. Load Memories, Summary & State
      const memoryContext = await memoryContextPromise;
      if (memoryContext) {
        const [{ data: memData }, { data: sumData }, { data: stateData }] = memoryContext;
        if (memData) setMemories(memData as Memory[]);
        if (sumData) setCurrentSummary(sumData as Summary);
        if (stateData?.state) setChatState(stateData.state);
      }

      // Also load local summary, memories, authors note, and state
      const localSum = getLocalSummary(chatId);
      if (localSum) {
        setCurrentSummary((prev) => prev || localSum);
      }

      const localNote = getLocalAuthorsNote(chatId);
      if (localNote) {
        setAuthorsNote(localNote);
      } else if (existingChat?.authors_note) {
        const noteSettings = (existingChat.settings as Record<string, unknown>) || {};
        setAuthorsNote({
          prompt: existingChat.authors_note,
          depth: typeof noteSettings.authors_note_depth === 'number' ? noteSettings.authors_note_depth : 4,
          interval: typeof noteSettings.authors_note_interval === 'number' ? noteSettings.authors_note_interval : 1,
          role: (noteSettings.authors_note_role as LocalAuthorsNote['role']) || 'system',
          position: (noteSettings.authors_note_position as LocalAuthorsNote['position']) || 'in_chat',
        });
      }

      const localPreset = typeof window !== 'undefined' ? localStorage.getItem(`cadenza_preset_${chatId}`) : null;
      if (localPreset) {
        setCurrentPresetId(localPreset);
      } else if (existingChat && (existingChat.settings as Record<string, unknown>)?.system_prompt_preset) {
        setCurrentPresetId((existingChat.settings as Record<string, unknown>).system_prompt_preset as string);
      }

      const localMems = getLocalMemories(chatId);
      if (localMems.length > 0) {
        setMemories((prev) => (prev.length > 0 ? prev : localMems));
      }

      const localSt = getLocalChatState(chatId);
      if (localSt && Object.keys(localSt).length > 0) {
        setChatState((prev) => (Object.keys(prev).length > 0 ? prev : localSt));
      }

      // E. Persist / Refresh local chat metadata with the verified character
      if (charObj && (chatId.startsWith('local-') || !existingChat)) {
        saveLocalChat({
          id: chatId,
          user_id: userId || 'guest',
          character_id: charObj.id,
          character: charObj,
          persona_id: resolvedPersona?.id || null,
          title: existingChat?.title || `Chat with ${charObj.name}`,
          leaf_id: null,
          memory_cursor_id: null,
          authors_note: existingChat?.authors_note || '',
          settings: {},
          pinned: existingChat?.pinned || false,
          archived: false,
          message_count: loadedMessages.length || 1,
          last_message_at: existingChat?.last_message_at || new Date().toISOString(),
          created_at: existingChat?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    initChat();
    return () => {
      cancelled = true;
    };
    // initChat is a mount-time chat initializer; re-running it when the router or the active
    // persona changes would reload and rewrite the conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, charIdParam, supabase]);

  // Real-time synchronization: subscribe to message inserts/updates across devices
  useEffect(() => {
    if (!chatId || !isUuid(chatId)) return;

    const channel = supabase
      .channel(`chat-messages-${chatId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'messages',
          filter: `chat_id=eq.${chatId}`,
        },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newMsg = payload.new as Message;
            setMessages((prev) => {
              if (prev.some((m) => m.id === newMsg.id)) return prev;
              // Ignore our own assistant echo while locally streaming:
              // the active SSE loop owns the `ast-` placeholder and `metaSync`
              // renames it to the real UUID. Appending here rendered the
              // same AI reply twice.
              if (
                newMsg.role === 'assistant' &&
                prev.some((m) => m.role === 'assistant' && m.status === 'streaming')
              )
                return prev;
              const tempMatch = prev.find(
                (m) =>
                  (m.id.startsWith('usr-') || m.id.startsWith('ast-')) &&
                  m.role === newMsg.role &&
                  (m.content === newMsg.content ||
                    !m.content ||
                    // A reply this page stopped following (user left mid-stream) —
                    // the server's finished row replaces the partial bubble.
                    (m.role === 'assistant' && m.status === 'stopped'))
              );
              let updated: Message[];
              if (tempMatch) {
                updated = prev.map((m) => (m.id === tempMatch.id ? newMsg : m));
              } else {
                updated = [...prev, newMsg];
              }
              scheduleLocalSave(chatId, updated);
              return updated;
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedMsg = payload.new as Message;
            setMessages((prev) => {
              // Don't clobber an actively streaming bubble with stale DB content.
              const local = prev.find((m) => m.id === updatedMsg.id);
              if (local && local.status === 'streaming') return prev;
              const updated = prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
              scheduleLocalSave(chatId, updated);
              return updated;
            });
          } else if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as Message)?.id;
            if (oldId) {
              setMessages((prev) => {
                const updated = prev.filter((m) => m.id !== oldId);
                scheduleLocalSave(chatId, updated);
                return updated;
              });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [chatId, supabase]);

  // Catch up with other devices. Phones drop the realtime socket while the app is in
  // the background, so anything sent elsewhere in the meantime is pulled on return.
  const isGeneratingRef = useRef(false);
  useEffect(() => {
    isGeneratingRef.current = isGenerating;
  }, [isGenerating]);
  useEffect(() => {
    if (!chatId || !isUuid(chatId)) return;
    let inFlight = false;
    const resync = async () => {
      if (document.visibilityState !== 'visible' || inFlight || isGeneratingRef.current) return;
      inFlight = true;
      try {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true });
        if (error || !data || data.length === 0 || isGeneratingRef.current) return;
        const cloud = data as Message[];
        setMessages((prev) => {
          const prevById = new Map(prev.map((m) => [m.id, m]));
          const unchanged =
            cloud.length === prev.length &&
            cloud.every((m) => {
              const p = prevById.get(m.id);
              return p && p.updated_at === m.updated_at;
            });
          if (unchanged) return prev;
          // Keep the already-formatted local copy of rows that did not change.
          const merged = cloud.map((m) => {
            const p = prevById.get(m.id);
            return p && p.updated_at === m.updated_at ? p : m;
          });
          const next = [...merged, ...pendingLocalMessages(prev, cloud)];
          saveLocalMessages(chatId, next);
          return next;
        });
      } catch {
        // offline — the next return to the tab tries again
      } finally {
        inFlight = false;
      }
    };
    document.addEventListener('visibilitychange', resync);
    window.addEventListener('focus', resync);
    window.addEventListener('online', resync);
    return () => {
      document.removeEventListener('visibilitychange', resync);
      window.removeEventListener('focus', resync);
      window.removeEventListener('online', resync);
    };
  }, [chatId, supabase]);

  // Intelligent auto-scroll: locks to bottom only when user is near bottom
  useEffect(() => {
    if (!chatContainerRef.current) return;
    if (isAtBottom) {
      if (isGenerating) {
        // Fast hardware-accelerated follow during streaming (zero smooth-scroll lockouts)
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
      } else {
        // Smooth scroll for completed turns
        scrollToBottom(true);
      }
    }
  }, [messages, isGenerating, isAtBottom]);

  // Abort any in-flight generation when the chat unmounts (navigating away
  // must not leave a stream writing into a dead page), and when the tracked
  // controller is swapped out.
  useEffect(() => {
    return () => {
      abortController?.abort();
    };
  }, [abortController]);

  // Auto-resize textarea
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  };

  // 2. Send Message Handler
  const handleSendMessage = async (customPrompt?: string) => {
    const rawToSend = (customPrompt ?? inputText).trim();
    if (!rawToSend || isGenerating || !character) return;

    if (!hasLlmCredentials(settings)) {
      toast.error(missingCredentialsMessage(settings));
      return;
    }

    const charName = character.name || 'Character';
    const userName = activePersona?.name || 'User';

    // Apply prompt-time transformations (macros like {{roll::2d6}}, prompt regexes)
    const textToSend = processPromptTime(rawToSend, regexScripts, {
      charName,
      userName,
    });

    const userMsgId = 'usr-' + Date.now();
    const newUserMsg: Message = {
      id: userMsgId,
      chat_id: chatId,
      user_id: 'user',
      parent_id: messages.length > 0 ? messages[messages.length - 1].id : null,
      role: 'user',
      content: textToSend,
      reasoning: null,
      status: 'done',
      meta: {
        persona_name: userName,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const assistantMsgId = 'ast-' + (Date.now() + 1);
    const newAssistantMsg: Message = {
      id: assistantMsgId,
      chat_id: chatId,
      user_id: 'assistant',
      parent_id: userMsgId,
      role: 'assistant',
      content: '',
      reasoning: null,
      status: 'streaming',
      meta: {
        swipes: [''],
        active_swipe_index: 0,
        reasoning_swipes: [''],
        reasoning_durations: [],
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const initialUpdatedMsgs = [...messages, newUserMsg, newAssistantMsg];
    setMessages(initialUpdatedMsgs);
    saveLocalMessages(chatId, initialUpdatedMsgs);
    setInputText('');
    playSendSound();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsGenerating(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const reqHeaders = await getAuthHeaders(supabase);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: reqHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          chatId,
          characterId: character.id,
          personaId: activePersona?.id,
          persona: activePersona,
          character,
          userMessage: textToSend,
          parentMessageId: (newUserMsg.parent_id && isUuid(newUserMsg.parent_id)) ? newUserMsg.parent_id : null,
          apiKey: await resolveLlmKey(settings),
          temperature: settings.defaultTemperature,
          thinking: settings.thinkingEnabled,
          authorsNote: authorsNote.prompt?.trim() || undefined,
          authorsNoteDepth: authorsNote.depth,
          stylePreset: SILLY_TAVERN_SYSTEM_PROMPT_PRESETS[currentPresetId]?.content || '',
          clientMemories: memories,
          clientSummary: currentSummary,
          clientState: chatState,
          history: slimHistory(messages),
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json();
        throw new Error(errorJson.error || 'Failed to generate response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let streamedContent = '';
      let streamedReasoning = '';
      let thinkingEnded = false;
      let reasoningDuration = 0;
      let resolvedUserMsgId = userMsgId;
      let resolvedAssistantMsgId = assistantMsgId;
      let resolvedChatId = chatId;
      const genStartTime = Date.now();

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                // Feature 2 (additive): instant local token ledger — ignores text/reasoning.
                if (parsed.usage) {
                  const uIn = Math.max(0, Math.floor(Number(parsed.usage.input) || 0));
                  const uOut = Math.max(0, Math.floor(Number(parsed.usage.output) || 0));
                  if (uIn > 0 || uOut > 0) recordLocalUsage(uIn, uOut);
                }
                if (parsed.llmLog) persistLlmLog(parsed.llmLog);

                if (parsed.metaSync) {
                  if (parsed.metaSync.chatId && parsed.metaSync.chatId !== chatId) {
                    resolvedChatId = parsed.metaSync.chatId;
                  }
                  if (parsed.metaSync.userMsgId) resolvedUserMsgId = parsed.metaSync.userMsgId;
                  if (parsed.metaSync.assistantMsgId) resolvedAssistantMsgId = parsed.metaSync.assistantMsgId;
                  if (parsed.metaSync.reasoning_duration_seconds && !reasoningDuration) {
                    reasoningDuration = parsed.metaSync.reasoning_duration_seconds;
                  }
                }

                if (parsed.reasoning) {
                  streamedReasoning += parsed.reasoning;
                  queueStreamUpdate((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantMsgId) return m;
                      const rList = m.meta?.reasoning_swipes ? [...m.meta.reasoning_swipes] : [streamedReasoning];
                      const sIdx = m.meta?.active_swipe_index ?? 0;
                      rList[sIdx] = streamedReasoning;
                      return {
                        ...m,
                        reasoning: streamedReasoning,
                        meta: {
                          ...m.meta,
                          reasoning_swipes: rList,
                        },
                      };
                    })
                  );
                }

                if (parsed.reasoningDone && !thinkingEnded) {
                  thinkingEnded = true;
                  reasoningDuration = Math.max(1, Math.round((Date.now() - genStartTime) / 1000));
                  queueStreamUpdate((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantMsgId) return m;
                      const dList = m.meta?.reasoning_durations ? [...(m.meta.reasoning_durations || [])] : [];
                      const sIdx = m.meta?.active_swipe_index ?? 0;
                      dList[sIdx] = reasoningDuration;
                      return {
                        ...m,
                        meta: {
                          ...m.meta,
                          reasoning_duration_seconds: reasoningDuration,
                          reasoning_durations: dList,
                        },
                      };
                    })
                  );
                }

                if (parsed.text) {
                  if (!thinkingEnded && streamedReasoning) {
                    thinkingEnded = true;
                    reasoningDuration = Math.max(1, Math.round((Date.now() - genStartTime) / 1000));
                  }
                  streamedContent += parsed.text;
                  const formattedLive = formatRoleplayText(streamedContent, charName, userName);

                  queueStreamUpdate((prev) =>
                    prev.map((m) => {
                      if (m.id !== assistantMsgId) return m;
                      const sList = m.meta?.swipes ? [...m.meta.swipes] : [formattedLive];
                      const sIdx = m.meta?.active_swipe_index ?? 0;
                      sList[sIdx] = formattedLive;
                      return {
                        ...m,
                        content: formattedLive,
                        meta: {
                          ...m.meta,
                          swipes: sList,
                          active_swipe_index: sIdx,
                          reasoning_duration_seconds: reasoningDuration || m.meta?.reasoning_duration_seconds,
                        },
                      };
                    })
                  );
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }

      if (!reasoningDuration && streamedReasoning) {
        reasoningDuration = Math.max(1, Math.round((Date.now() - genStartTime) / 1000));
      }

      const finalMessages = commitMessages((prev) => {
        const mapped: Message[] = prev.map((m) => {
          if (m.id === userMsgId && resolvedUserMsgId !== userMsgId) {
            return { ...m, id: resolvedUserMsgId };
          }
          if (m.id !== assistantMsgId && m.id !== resolvedAssistantMsgId) return m;
          const sList = m.meta?.swipes ? [...m.meta.swipes] : [m.content];
          const sIdx = m.meta?.active_swipe_index ?? 0;
          const finalVal = formatRoleplayText(m.content, charName, userName);
          sList[sIdx] = finalVal;

          const rList = m.meta?.reasoning_swipes ? [...m.meta.reasoning_swipes] : [streamedReasoning];
          rList[sIdx] = streamedReasoning || m.reasoning || null;

          const dList = m.meta?.reasoning_durations ? [...(m.meta.reasoning_durations || [])] : [];
          dList[sIdx] = reasoningDuration || m.meta?.reasoning_duration_seconds || undefined;

          return {
            ...m,
            id: resolvedAssistantMsgId,
            parent_id: resolvedUserMsgId,
            status: 'done' as const,
            content: finalVal,
            reasoning: streamedReasoning || m.reasoning || null,
            meta: {
              ...m.meta,
              swipes: sList,
              active_swipe_index: sIdx,
              reasoning_swipes: rList,
              reasoning_duration_seconds: reasoningDuration || m.meta?.reasoning_duration_seconds,
              reasoning_durations: dList,
            },
          };
        });
        // Dedupe by id (heals timelines corrupted by the pre-fix double-append).
        const seen = new Map<string, Message>();
        for (const m of mapped) {
          const existing = seen.get(m.id);
          if (!existing || (m.content?.length || 0) > (existing.content?.length || 0)) {
            seen.set(m.id, m);
          }
        }
        return Array.from(seen.values());
      });
      saveLocalMessages(chatId, finalMessages);
      playReceiveSound();

      // A browser-only chat that the server just created in the cloud (signed-in user):
      // move the transcript to the real id and continue there, so the next turn lands
      // in the same cloud chat instead of spawning a new one each time.
      if (resolvedChatId !== chatId && isUuid(resolvedChatId)) {
        const migrated = finalMessages.map((m) => ({ ...m, chat_id: resolvedChatId }));
        saveLocalMessages(resolvedChatId, migrated);
        const prevNote = getLocalAuthorsNote(chatId);
        if (prevNote) saveLocalAuthorsNote(resolvedChatId, prevNote);
        deleteChat(chatId);
        router.replace(`/chat/${resolvedChatId}`);
        return;
      }

      // Update chat message count & timestamp for "My Chats"
      if (character) {
        const nowIso = new Date().toISOString();
        if (chatId.startsWith('local-')) {
          saveLocalChat({
            id: chatId,
            user_id: 'guest',
            character_id: character.id,
            character: character,
            persona_id: activePersona?.id || null,
            title: `Chat with ${character.name}`,
            leaf_id: null,
            memory_cursor_id: null,
            authors_note: authorsNote.prompt.trim(),
            settings: {},
            pinned: false,
            archived: false,
            message_count: finalMessages.length,
            last_message_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          });
        } else {
          supabase
            .from('chats')
            .update({
              last_message_at: nowIso,
              message_count: finalMessages.length,
            })
            .eq('id', chatId)
            .then();
        }
      }

      // Refresh memory a few seconds after the reply, giving the background memory
      // pass time to fold the new exchange in. Local (guest) chats run the same pass
      // on demand and keep the result in this browser.
      setTimeout(async () => {
        if (chatId.startsWith('local-')) {
          try {
            const res = await fetch('/api/chat/memory', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'regenerate',
                chatId,
                charName: character.name,
                userName: activePersona?.name || 'User',
                history: finalMessages,
                memories,
                summary: currentSummary,
                state: chatState,
                force: false,
                apiKey: await resolveLlmKey(settings),
              }),
            });
            const data = await res.json();
            if (!res.ok) return;
            if (Array.isArray(data.memories)) {
              setMemories(data.memories);
              saveLocalMemories(chatId, data.memories);
            }
            if (data.summary) {
              setCurrentSummary(data.summary);
              saveLocalSummary(chatId, data.summary);
            }
            if (data.state) {
              setChatState(data.state);
              saveLocalChatState(chatId, data.state);
            }
          } catch {
            // Guest memory is best-effort; the story still plays without it.
          }
          return;
        }

        const { data: memData } = await supabase
          .from('memories')
          .select(MEMORY_COLUMNS)
          .eq('chat_id', chatId)
          .is('superseded_by', null)
          .limit(MEMORY_LIST_LIMIT);
        if (memData) setMemories(memData as Memory[]);

        const { data: stData } = await supabase
          .from('chat_state')
          .select('*')
          .eq('chat_id', chatId)
          .maybeSingle();
        if (stData?.state) setChatState(stData.state);
      }, 3500);
    } catch (err) {
      if ((err as { name?: unknown } | null | undefined)?.name !== 'AbortError') {
        const errMessages = commitMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  status: 'error',
                  meta: { ...m.meta, error: (err instanceof Error && err.message) || 'The reply could not be generated.' },
                }
              : m
          )
        );
        saveLocalMessages(chatId, errMessages);
      } else {
        // Stopped by the user: keep what arrived. The server saves the same partial reply.
        const stoppedMessages = commitMessages((prev) =>
          prev
            .filter((m) => !(m.id === assistantMsgId && !m.content?.trim() && !m.reasoning))
            .map((m) => (m.id === assistantMsgId ? { ...m, status: 'stopped' as const } : m))
        );
        saveLocalMessages(chatId, stoppedMessages);
      }
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  const handleStop = () => {
    if (abortController) {
      abortController.abort();
      setIsGenerating(false);
      setAbortController(null);
      toast.info('Generation paused');
    }
  };

  // Swipes (navigate between alternative greetings/responses)
  const handleSwipe = (msgIndex: number, direction: 'prev' | 'next') => {
    // Swiping mid-stream would redirect the live stream into another swipe
    // slot and corrupt both versions — same guard as edit/delete.
    if (isGenerating) {
      toast.error('Stop generation before switching versions');
      return;
    }
    const msg = messages[msgIndex];
    if (!msg) return;
    const swipes = msg.meta?.swipes || [msg.content];
    const reasoningSwipes = msg.meta?.reasoning_swipes || [];
    const reasoningDurations = msg.meta?.reasoning_durations || [];
    let currentIndex = msg.meta?.active_swipe_index ?? 0;

    if (direction === 'prev' && currentIndex > 0) {
      currentIndex--;
    } else if (direction === 'next' && currentIndex < swipes.length - 1) {
      currentIndex++;
    }

    const currentReasoning =
      reasoningSwipes[currentIndex] !== undefined
        ? reasoningSwipes[currentIndex]
        : currentIndex === 0
        ? msg.reasoning
        : null;

    const currentDuration =
      reasoningDurations[currentIndex] !== undefined
        ? reasoningDurations[currentIndex]
        : currentIndex === 0
        ? msg.meta?.reasoning_duration_seconds
        : undefined;

    const updatedMsgs = commitMessages((prev) =>
      prev.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              content: swipes[currentIndex],
              reasoning: currentReasoning || null,
              meta: {
                ...m.meta,
                active_swipe_index: currentIndex,
                reasoning_duration_seconds: currentDuration,
              },
            }
          : m
      )
    );
    saveLocalMessages(chatId, updatedMsgs);

    if (!chatId.startsWith('local-') && isUuid(msg.id)) {
      supabase
        .from('messages')
        .update({
          content: swipes[currentIndex],
          reasoning: currentReasoning || null,
          meta: {
            ...msg.meta,
            active_swipe_index: currentIndex,
            reasoning_duration_seconds: currentDuration,
          },
        })
        .eq('id', msg.id)
        .then();
    }
  };

  // Regenerate alternate response (Multi-swipe generation)
  const handleRegenerate = async (assistantMsgIndex: number) => {
    if (isGenerating || !character) return;
    const targetMsg = messages[assistantMsgIndex];
    if (!targetMsg || targetMsg.role !== 'assistant') return;

    if (!hasLlmCredentials(settings)) {
      toast.error(missingCredentialsMessage(settings));
      return;
    }

    const charName = character.name || 'Character';
    const userName = activePersona?.name || 'User';

    // Find the user prompt that triggered this response
    let triggerUserMessage = '';
    const historyBeforeAssistant: Message[] = [];
    for (let i = 0; i < assistantMsgIndex; i++) {
      historyBeforeAssistant.push(messages[i]);
      if (messages[i].role === 'user') {
        triggerUserMessage = messages[i].content;
      }
    }

    if (!triggerUserMessage) {
      triggerUserMessage = '*Continues the story naturally*';
    }

    // Add a new swipe slot — or, when retrying a reply that failed before writing
    // anything, reuse its empty slot so the failure doesn't leave a blank swipe.
    const prevSwipes = targetMsg.meta?.swipes || [targetMsg.content];
    const prevReasoningSwipes = targetMsg.meta?.reasoning_swipes || [targetMsg.reasoning || ''];
    const activeSlot = targetMsg.meta?.active_swipe_index ?? prevSwipes.length - 1;
    const retryInPlace = targetMsg.status === 'error' && !prevSwipes[activeSlot]?.trim();
    const newSwipeIndex = retryInPlace ? activeSlot : prevSwipes.length;
    const updatedSwipes = retryInPlace ? prevSwipes.map((v, i) => (i === activeSlot ? '' : v)) : [...prevSwipes, ''];
    const updatedReasoningSwipes = retryInPlace
      ? prevReasoningSwipes.map((v, i) => (i === activeSlot ? '' : v))
      : [...prevReasoningSwipes, ''];

    setMessages((prev) =>
      prev.map((m, i) =>
        i === assistantMsgIndex
          ? {
              ...m,
              content: '',
              reasoning: null,
              status: 'streaming',
              meta: {
                ...m.meta,
                error: undefined,
                swipes: updatedSwipes,
                reasoning_swipes: updatedReasoningSwipes,
                active_swipe_index: newSwipeIndex,
              },
            }
          : m
      )
    );

    setIsGenerating(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      const reqHeaders = await getAuthHeaders(supabase);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: reqHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          chatId,
          characterId: character.id,
          personaId: activePersona?.id,
          persona: activePersona,
          character,
          userMessage: triggerUserMessage,
          isSwipe: true,
          existingAssistantMessageId: isUuid(targetMsg.id) ? targetMsg.id : undefined,
          swipeIndex: newSwipeIndex,
          apiKey: await resolveLlmKey(settings),
          temperature: settings.defaultTemperature,
          thinking: settings.thinkingEnabled,
          authorsNote: authorsNote.prompt?.trim() || undefined,
          authorsNoteDepth: authorsNote.depth,
          stylePreset: SILLY_TAVERN_SYSTEM_PROMPT_PRESETS[currentPresetId]?.content || '',
          clientMemories: memories,
          clientSummary: currentSummary,
          clientState: chatState,
          history: slimHistory(historyBeforeAssistant.filter((m) => m.content !== triggerUserMessage)),
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || 'Failed to generate alternate response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let streamedContent = '';
      let streamedReasoning = '';
      let thinkingEnded = false;
      let reasoningDuration = 0;
      let adoptedId: string | null = null;
      const genStartTime = Date.now();

      if (reader) {
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                // Feature 2 (additive): instant local token ledger — ignores text/reasoning.
                if (parsed.usage) {
                  const uIn = Math.max(0, Math.floor(Number(parsed.usage.input) || 0));
                  const uOut = Math.max(0, Math.floor(Number(parsed.usage.output) || 0));
                  if (uIn > 0 || uOut > 0) recordLocalUsage(uIn, uOut);
                }
                if (parsed.llmLog) persistLlmLog(parsed.llmLog);
                if (parsed.metaSync) {
                  if (parsed.metaSync.reasoning_duration_seconds && !reasoningDuration) {
                    reasoningDuration = parsed.metaSync.reasoning_duration_seconds;
                  }
                  // A reply that only existed locally (e.g. a failed one) now has a
                  // real row — adopt its id so later swipes update it, not duplicate it.
                  if (parsed.metaSync.assistantMsgId && !isUuid(targetMsg.id)) {
                    adoptedId = parsed.metaSync.assistantMsgId;
                  }
                }

                if (parsed.reasoning) {
                  streamedReasoning += parsed.reasoning;
                  queueStreamUpdate((prev) =>
                    prev.map((m, i) => {
                      if (i !== assistantMsgIndex) return m;
                      const rList = m.meta?.reasoning_swipes ? [...m.meta.reasoning_swipes] : [streamedReasoning];
                      rList[newSwipeIndex] = streamedReasoning;
                      return {
                        ...m,
                        reasoning: streamedReasoning,
                        meta: {
                          ...m.meta,
                          reasoning_swipes: rList,
                        },
                      };
                    })
                  );
                }

                if (parsed.reasoningDone && !thinkingEnded) {
                  thinkingEnded = true;
                  reasoningDuration = Math.max(1, Math.round((Date.now() - genStartTime) / 1000));
                  queueStreamUpdate((prev) =>
                    prev.map((m, i) => {
                      if (i !== assistantMsgIndex) return m;
                      const dList = m.meta?.reasoning_durations ? [...(m.meta.reasoning_durations || [])] : [];
                      dList[newSwipeIndex] = reasoningDuration;
                      return {
                        ...m,
                        meta: {
                          ...m.meta,
                          reasoning_duration_seconds: reasoningDuration,
                          reasoning_durations: dList,
                        },
                      };
                    })
                  );
                }

                if (parsed.text) {
                  if (!thinkingEnded && streamedReasoning) {
                    thinkingEnded = true;
                    reasoningDuration = Math.max(1, Math.round((Date.now() - genStartTime) / 1000));
                  }
                  streamedContent += parsed.text;
                  const formattedLive = formatRoleplayText(streamedContent, charName, userName);

                  queueStreamUpdate((prev) =>
                    prev.map((m, i) => {
                      if (i !== assistantMsgIndex) return m;
                      const sList = m.meta?.swipes ? [...m.meta.swipes] : [formattedLive];
                      sList[newSwipeIndex] = formattedLive;
                      return {
                        ...m,
                        content: formattedLive,
                        meta: {
                          ...m.meta,
                          swipes: sList,
                          active_swipe_index: newSwipeIndex,
                          reasoning_duration_seconds: reasoningDuration || m.meta?.reasoning_duration_seconds,
                        },
                      };
                    })
                  );
                }
              } catch {}
            }
          }
        }
      }

      if (!reasoningDuration && streamedReasoning) {
        reasoningDuration = Math.max(1, Math.round((Date.now() - genStartTime) / 1000));
      }

      const finalMessages = commitMessages((prev) =>
        prev.map((m, i) => {
          if (i !== assistantMsgIndex) return m;
          const sList = m.meta?.swipes ? [...m.meta.swipes] : [m.content];
          const finalVal = formatRoleplayText(m.content, charName, userName);
          sList[newSwipeIndex] = finalVal;

            const rList = m.meta?.reasoning_swipes ? [...m.meta.reasoning_swipes] : [streamedReasoning];
            rList[newSwipeIndex] = streamedReasoning || m.reasoning || null;

            const dList = m.meta?.reasoning_durations ? [...(m.meta.reasoning_durations || [])] : [];
            dList[newSwipeIndex] = reasoningDuration || m.meta?.reasoning_duration_seconds || undefined;

          return {
            ...m,
            id: adoptedId || m.id,
            status: 'done',
            content: finalVal,
            reasoning: streamedReasoning || m.reasoning || null,
            meta: {
              ...m.meta,
              error: undefined,
              swipes: sList,
              active_swipe_index: newSwipeIndex,
              reasoning_swipes: rList,
              reasoning_duration_seconds: reasoningDuration || m.meta?.reasoning_duration_seconds,
              reasoning_durations: dList,
            },
          };
        })
      );
      saveLocalMessages(chatId, finalMessages);

      if (!chatId.startsWith('local-') && isUuid(targetMsg.id)) {
        const updatedTarget = finalMessages[assistantMsgIndex];
        if (updatedTarget) {
          supabase
            .from('messages')
            .update({
              content: updatedTarget.content,
              reasoning: updatedTarget.reasoning,
              meta: updatedTarget.meta,
            })
            .eq('id', targetMsg.id)
            .then();
        }
      }

      playReceiveSound();
    } catch (err) {
      flushStreamUpdate();
      if ((err as { name?: unknown } | null | undefined)?.name !== 'AbortError') {
        const reason = (err instanceof Error && err.message) || 'The reply could not be generated.';
        if (retryInPlace) {
          // Still failing: keep the error card (with its retry) instead of a blank reply.
          const failed = commitMessages((prev) =>
            prev.map((m, i) =>
              i === assistantMsgIndex ? { ...m, status: 'error' as const, meta: { ...m.meta, error: reason } } : m
            )
          );
          if (failed) saveLocalMessages(chatId, failed);
        } else {
          toast.error(reason);
          const restored = commitMessages((prev) =>
            prev.map((m, i) =>
              i === assistantMsgIndex
                ? {
                    ...m,
                    status: 'done' as const,
                    content: prevSwipes[prevSwipes.length - 1] || m.content,
                    meta: {
                      ...m.meta,
                      swipes: prevSwipes,
                      active_swipe_index: Math.max(0, prevSwipes.length - 1),
                    },
                  }
                : m
            )
          );
          if (restored) saveLocalMessages(chatId, restored);
        }
      } else {
        // Stopped by the user: keep any partial retry as a finished message,
        // otherwise restore the previous swipe — never leave a spinner up.
        const stopped = commitMessages((prev) =>
          prev.map((m, i) => {
            if (i !== assistantMsgIndex) return m;
            const partial = m.meta?.swipes?.[newSwipeIndex];
            if (partial?.trim() || m.reasoning?.trim()) {
              return { ...m, status: 'stopped' as const };
            }
            return {
              ...m,
              status: 'done' as const,
              content: prevSwipes[prevSwipes.length - 1] || m.content,
              meta: {
                ...m.meta,
                swipes: prevSwipes,
                active_swipe_index: Math.max(0, prevSwipes.length - 1),
              },
            };
          })
        );
        if (stopped) saveLocalMessages(chatId, stopped);
      }
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  // ── Truncation persistence helpers (dual-write: local cache + Supabase) ──

  // Write the kept message list to the local cache and refresh the local chat
  // row's count/timestamp. Never creates a stub local chat for cloud chats.
  const persistTruncationLocal = (kept: Message[]) => {
    saveLocalMessages(chatId, kept);
    const nowIso = new Date().toISOString();
    if (chatId.startsWith('local-') || getLocalChat(chatId)) {
      saveLocalChat({
        id: chatId,
        message_count: kept.length,
        last_message_at: kept.length > 0 ? kept[kept.length - 1].created_at : nowIso,
      });
    }
  };

  // Push count/timestamp/leaf pointer to the Supabase chats row (cloud chats only).
  // Returns false when the cloud write fails so callers can warn instead of
  // claiming full sync (local cache is still updated first).
  const syncChatMetaToCloud = async (kept: Message[]): Promise<boolean> => {
    if (chatId.startsWith('local-')) return true;
    const nowIso = new Date().toISOString();
    const lastKept = kept.length > 0 ? kept[kept.length - 1] : null;
    try {
      const { error } = await supabase
        .from('chats')
        .update({
          message_count: kept.length,
          last_message_at: lastKept?.created_at || nowIso,
          leaf_id: lastKept && isUuid(lastKept.id) ? lastKept.id : null,
        })
        .eq('id', chatId);
      if (error) {
        console.warn('Failed to sync chat meta to Supabase:', error);
        return false;
      }
      return true;
    } catch (err) {
      console.warn('Failed to sync chat meta to Supabase:', err);
      return false;
    }
  };

  // Delete the target message and everything after it from Supabase.
  // Resolves the cutoff by reading the DB ordering first so local temp ids,
  // clock skew, and server-generated UUIDs can never leave stale rows behind
  // (stale rows would otherwise leak back into /api/chat history).
  // Returns false when the cloud delete fails so callers can warn — the local
  // cache is still truncated first and stays the UI source of truth.
  const deleteRangeFromCloud = async (fromIndex: number, snapshot: Message[]): Promise<boolean> => {
    if (chatId.startsWith('local-')) return true;
    try {
      const target = snapshot[fromIndex];
      if (!target) return true;
      const { data: dbRows, error: fetchErr } = await supabase
        .from('messages')
        .select('id,created_at')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });
      if (fetchErr) {
        console.warn('Failed to list cloud messages for truncation:', fetchErr);
        return false;
      }
      if (!dbRows || dbRows.length === 0) return true;

      let cutoff = -1;
      if (isUuid(target.id)) {
        cutoff = dbRows.findIndex((r) => r.id === target.id);
      }
      if (cutoff === -1) {
        const t = new Date(target.created_at).getTime();
        cutoff = dbRows.findIndex((r) => new Date(r.created_at).getTime() >= t);
      }
      if (cutoff === -1) {
        // No timestamp match (e.g. target is a local-only row newer than the
        // DB tip): still remove any downstream rows we can address by UUID.
        const uuids = snapshot.slice(fromIndex).map((m) => m.id).filter(isUuid);
        if (uuids.length > 0) {
          const { error } = await supabase.from('messages').delete().eq('chat_id', chatId).in('id', uuids);
          if (error) {
            console.warn('Cloud truncation delete failed:', error);
            return false;
          }
        }
        return true;
      }
      const idsToDelete = dbRows.slice(cutoff).map((r) => r.id);
      let ok = true;
      for (let i = 0; i < idsToDelete.length; i += 50) {
        const chunk = idsToDelete.slice(i, i + 50);
        const { error } = await supabase
          .from('messages')
          .delete()
          .eq('chat_id', chatId)
          .in('id', chunk);
        if (error) {
          console.warn('Cloud truncation delete failed:', error);
          ok = false;
        }
      }
      return ok;
    } catch (err) {
      console.warn('Failed to truncate cloud messages:', err);
      return false;
    }
  };

  // Inline Message Editing
  const handleStartEdit = (msg: Message) => {
    if (isGenerating) {
      toast.error('Stop generation before editing');
      return;
    }
    setDeleteConfirmId(null);
    setEditingMsgId(msg.id);
    setEditingText(msg.content);
  };

  const handleCancelEdit = () => {
    setEditingMsgId(null);
    setEditingText('');
  };

  // Feature 3 — Edit with rewind & auto-regeneration.
  // User message: truncate everything after it, update it, stream a fresh reply.
  // Assistant message: in-place text fix only (swipes/history preserved).
  const handleSaveEdit = async () => {
    if (!editingMsgId || isGenerating) return;
    const trimmed = editingText.trim();
    if (!trimmed) {
      toast.error('Message cannot be empty');
      return;
    }
    const idx = messages.findIndex((m) => m.id === editingMsgId);
    if (idx === -1) {
      handleCancelEdit();
      return;
    }
    const target = messages[idx];
    const charName = character?.name || 'Character';
    const userName = activePersona?.name || 'User';
    const formatted = formatRoleplayText(trimmed, charName, userName);

    // ── Assistant edit: in-place only, no rewind, no regen ──
    if (target.role !== 'user') {
      if (trimmed === target.content) {
        handleCancelEdit();
        return;
      }
      const updatedMsgs = messages.map((m) => {
        if (m.id !== editingMsgId) return m;
        const currentSwipes = m.meta?.swipes ? [...m.meta.swipes] : [formatted];
        const swipeIdx = m.meta?.active_swipe_index ?? 0;
        currentSwipes[swipeIdx] = formatted;
        return {
          ...m,
          content: formatted,
          updated_at: new Date().toISOString(),
          meta: { ...m.meta, swipes: currentSwipes },
        };
      });
      setMessages(updatedMsgs);
      persistTruncationLocal(updatedMsgs);

      if (!chatId.startsWith('local-') && isUuid(editingMsgId)) {
        try {
          await supabase
            .from('messages')
            .update({ content: formatted })
            .eq('id', editingMsgId)
            .eq('chat_id', chatId);
        } catch (err) {
          console.warn('Failed to update message in Supabase:', err);
        }
      }

      setEditingMsgId(null);
      setEditingText('');
      toast.success('Response updated');
      return;
    }

    // ── User edit: rewind + auto-regenerate ──
    if (trimmed === target.content) {
      handleCancelEdit();
      return;
    }
    if (!character) return;
    if (!hasLlmCredentials(settings)) {
      toast.error(missingCredentialsMessage(settings));
      return;
    }

    const snapshot = [...messages];
    const downstreamCount = snapshot.length - idx - 1;
    const baseBefore = snapshot.slice(0, idx);
    const nowIso = new Date().toISOString();
    const updatedTarget: Message = {
      ...target,
      content: formatted,
      updated_at: nowIso,
      meta: { ...target.meta, persona_name: userName },
    };
    const truncatedBase = [...baseBefore, updatedTarget];

    const placeholder: Message = makeRegenPlaceholder(chatId, updatedTarget.id);
    const assistantMsgId = placeholder.id;

    const optimistic = [...truncatedBase, placeholder];
    setMessages(optimistic);
    persistTruncationLocal(optimistic);
    setEditingMsgId(null);
    setEditingText('');
    setDeleteConfirmId(null);
    if (downstreamCount > 0) {
      toast.info(`Rewound ${downstreamCount} message${downstreamCount === 1 ? '' : 's'} — regenerating reply`);
    }
    setIsGenerating(true);
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Remove the stale target + downstream rows from the cloud BEFORE
      // generating, so /api/chat history cannot resurrect them. The edited
      // user message is re-inserted by /api/chat as a fresh row.
      const rangeOk = await deleteRangeFromCloud(idx, snapshot);
      if (!rangeOk) {
        toast.warning('Cloud cleanup failed — the new reply may still see removed context');
      }

      const parentForServer =
        baseBefore.length > 0 && isUuid(baseBefore[baseBefore.length - 1].id)
          ? baseBefore[baseBefore.length - 1].id
          : null;

      const reqHeaders = await getAuthHeaders(supabase);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: reqHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          chatId,
          characterId: character.id,
          personaId: activePersona?.id,
          persona: activePersona,
          character,
          userMessage: trimmed,
          parentMessageId: parentForServer,
          apiKey: await resolveLlmKey(settings),
          temperature: settings.defaultTemperature,
          thinking: settings.thinkingEnabled,
          authorsNote: authorsNote.prompt?.trim() || undefined,
          authorsNoteDepth: authorsNote.depth,
          stylePreset: SILLY_TAVERN_SYSTEM_PROMPT_PRESETS[currentPresetId]?.content || '',
          clientMemories: memories,
          clientSummary: currentSummary,
          clientState: chatState,
          history: baseBefore,
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || 'Failed to regenerate response');
      }

      // Stream via the module helper; live bubbles update through callbacks
      // batched via rAF while the deterministic result below drives both stores.
      const streamResult = await streamRegeneratedReply(response, {
        charName,
        userName,
        onReasoning: (full) =>
          queueStreamUpdate((prev) =>
            prev.map((m) =>
              m.id !== assistantMsgId
                ? m
                : {
                    ...m,
                    reasoning: full,
                    meta: { ...m.meta, reasoning_swipes: [full] },
                  }
            )
          ),
        onThinkingDone: (seconds) =>
          queueStreamUpdate((prev) =>
            prev.map((m) =>
              m.id !== assistantMsgId
                ? m
                : {
                    ...m,
                    meta: { ...m.meta, reasoning_duration_seconds: seconds },
                  }
            )
          ),
        onText: (formattedLive) =>
          queueStreamUpdate((prev) =>
            prev.map((m) =>
              m.id !== assistantMsgId
                ? m
                : {
                    ...m,
                    content: formattedLive,
                    meta: {
                      ...m.meta,
                      swipes: [formattedLive],
                      active_swipe_index: 0,
                    },
                  }
            )
          ),
      });

      flushStreamUpdate();

      if (streamResult.failed) {
        // Stream died mid-way: keep the partial reply, mark it error, and
        // persist the same timeline to both stores.
        const errVal = formatRoleplayText(streamResult.text, charName, userName);
        const failedAssistant: Message = {
          ...placeholder,
          status: 'error',
          content: errVal,
          reasoning: streamResult.reasoning || null,
          updated_at: new Date().toISOString(),
          meta: {
            ...placeholder.meta,
            error: 'The connection dropped before the reply finished.',
            swipes: [errVal],
            reasoning_swipes: [streamResult.reasoning || null],
            reasoning_duration_seconds: streamResult.reasoningDuration || undefined,
          },
        };
        const errMessages: Message[] = [...truncatedBase, failedAssistant];
        setMessages(errMessages);
        persistTruncationLocal(errMessages);
        const errMetaOk = await syncChatMetaToCloud(errMessages);
        if (!errMetaOk) {
          toast.warning('Cloud sync failed — error state kept locally only for now');
        }
        return;
      }

      if (streamResult.aborted) {
        // Aborted mid-rewind: keep the truncated base plus any partial reply
        // (marked stopped so no spinner sticks); drop the empty placeholder.
        const abortVal = formatRoleplayText(streamResult.text, charName, userName);
        const hasPartial =
          abortVal.trim().length > 0 || (streamResult.reasoning?.trim()?.length ?? 0) > 0;
        const abortMessages: Message[] = hasPartial
          ? [
              ...truncatedBase,
              {
                ...placeholder,
                status: 'stopped',
                content: abortVal,
                reasoning: streamResult.reasoning || null,
                updated_at: new Date().toISOString(),
                meta: {
                  ...placeholder.meta,
                  swipes: [abortVal],
                  reasoning_swipes: [streamResult.reasoning || null],
                  reasoning_duration_seconds: streamResult.reasoningDuration || undefined,
                },
              },
            ]
          : truncatedBase;
        setMessages(abortMessages);
        persistTruncationLocal(abortMessages);
        const abortMetaOk = await syncChatMetaToCloud(abortMessages);
        if (!abortMetaOk) {
          toast.warning('Cloud sync failed — rewound chat kept locally only for now');
        }
        return;
      }

      // Deterministic finalize: build from the helper result (never re-read
      // React state for persistence — updater closures can be stale/batched).
      const finalVal = formatRoleplayText(streamResult.text, charName, userName);
      let resolvedBase = truncatedBase;
      if (streamResult.metaSync?.userMsgId) {
        resolvedBase = truncatedBase.map((m) =>
          m.id === updatedTarget.id ? { ...m, id: streamResult.metaSync!.userMsgId! } : m
        );
      }
      const finalAssistant: Message = {
        ...placeholder,
        id: streamResult.metaSync?.assistantMsgId || placeholder.id,
        status: 'done',
        content: finalVal,
        reasoning: streamResult.reasoning || null,
        updated_at: new Date().toISOString(),
        meta: {
          ...placeholder.meta,
          swipes: [finalVal],
          active_swipe_index: 0,
          reasoning_swipes: [streamResult.reasoning || null],
          reasoning_duration_seconds: streamResult.reasoningDuration || undefined,
          reasoning_durations: [streamResult.reasoningDuration || undefined],
        },
      };
      const finalMessages: Message[] = [...resolvedBase, finalAssistant];
      setMessages(finalMessages);
      persistTruncationLocal(finalMessages);
      const metaOk = await syncChatMetaToCloud(finalMessages);
      if (metaOk) {
        toast.success('Reply regenerated');
        playReceiveSound();
      } else {
        toast.warning('Reply generated, but cloud sync failed — kept locally only for now');
      }
    } catch (err) {
      if (isAbortError(err)) {
        // Aborted before streaming started: no partial reply exists, so keep
        // the rewound base and never show a half-deleted timeline.
        setMessages(truncatedBase);
        persistTruncationLocal(truncatedBase);
        const preStreamMetaOk = await syncChatMetaToCloud(truncatedBase);
        if (!preStreamMetaOk) {
          toast.warning('Cloud sync failed — rewound chat kept locally only for now');
        }
      } else {
        const failedAssistant: Message = {
          ...placeholder,
          status: 'error',
          content: '',
          reasoning: null,
          updated_at: new Date().toISOString(),
          meta: {
            ...placeholder.meta,
            error: (err instanceof Error && err.message) || 'The reply could not be generated.',
            swipes: [''],
            reasoning_swipes: [null],
          },
        };
        const errMessages: Message[] = [...truncatedBase, failedAssistant];
        setMessages(errMessages);
        persistTruncationLocal(errMessages);
        const preStreamErrMetaOk = await syncChatMetaToCloud(errMessages);
        if (!preStreamErrMetaOk) {
          toast.warning('Cloud sync failed — error state kept locally only for now');
        }
      }
    } finally {
      setIsGenerating(false);
      setAbortController(null);
    }
  };

  // Feature 4 — Delete from here: first click arms an inline confirm, second
  // click wipes the target plus every message after it from UI + local cache
  // + Supabase, then refreshes count/timestamp/leaf.
  const handleDeleteMessage = async (msgId: string) => {
    if (isGenerating) {
      toast.error('Stop generation before deleting');
      return;
    }
    const idx = messages.findIndex((m) => m.id === msgId);
    if (idx === -1) return;
    if (deleteConfirmId !== msgId) {
      setDeleteConfirmId(msgId);
      return;
    }

    const snapshot = [...messages];
    const kept = snapshot.slice(0, idx);
    const removedCount = snapshot.length - idx;
    setDeleteConfirmId(null);
    if (editingMsgId && snapshot.slice(idx).some((m) => m.id === editingMsgId)) {
      setEditingMsgId(null);
      setEditingText('');
    }
    setMessages(kept);
    persistTruncationLocal(kept);
    const rangeOk = await deleteRangeFromCloud(idx, snapshot);
    const metaOk = await syncChatMetaToCloud(kept);
    if (rangeOk && metaOk) {
      toast.success(
        kept.length === 0
          ? 'Conversation cleared — send a message to start again'
          : `Deleted ${removedCount} message${removedCount === 1 ? '' : 's'} — chat rewound`
      );
    } else {
      toast.warning('Deleted locally, but cloud sync failed — reload may restore messages');
    }
  };

  const handleCancelDelete = () => setDeleteConfirmId(null);

  // Copy message
  const handleCopyMessage = (text: string) => {
    const value = formatRoleplayText(text, character?.name || 'Character', activePersona?.name || 'User');
    // Clipboard access rejects without permission/secure context — report the
    // real outcome instead of claiming success over a failed write.
    navigator.clipboard
      ?.writeText(value)
      .then(() => toast.success('Copied'))
      .catch(() => toast.error('Could not copy to clipboard'));
  };

  // SillyTavern-style Continue and Impersonate. Both send a hidden instruction
  // to the model (never a chat message): Continue extends the last reply in place,
  // Impersonate drafts your next turn into the composer for you to edit.
  const runAssistMode = async (genMode: 'continue' | 'impersonate') => {
    if (isGenerating || !character) return;
    if (!hasLlmCredentials(settings)) {
      toast.error(missingCredentialsMessage(settings));
      return;
    }

    const charName = character.name || 'Character';
    const userName = activePersona?.name || 'User';

    let targetIndex = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'assistant' && m.status !== 'error' && m.content?.trim()) {
        targetIndex = i;
        break;
      }
    }
    if (genMode === 'continue' && (targetIndex === -1 || targetIndex !== messages.length - 1)) {
      toast.info('Continue extends the last reply. Send a message to get a new one.');
      return;
    }

    const target = targetIndex >= 0 ? messages[targetIndex] : null;
    const base = target?.content || '';
    const controller = new AbortController();
    setAbortController(controller);
    setIsGenerating(true);
    if (genMode === 'impersonate') {
      setIsImpersonating(true);
      setInputText('');
    } else if (target) {
      setMessages((prev) => prev.map((m, i) => (i === targetIndex ? { ...m, status: 'streaming' } : m)));
    }

    const applyContinuation = (raw: string, final: boolean) => {
      if (targetIndex < 0) return [] as Message[];
      const addition = final ? (raw.match(/^\s*/)?.[0] || '') + sanitizeModelOutput(raw, charName) : raw;
      const extended = formatRoleplayText(joinContinuation(base, addition), charName, userName);
      let next: Message[] = [];
      const updater = (prev: Message[]) => {
        next = prev.map((m, i) => {
          if (i !== targetIndex) return m;
          const swipes = m.meta?.swipes ? [...m.meta.swipes] : [m.content];
          swipes[m.meta?.active_swipe_index ?? 0] = extended;
          return {
            ...m,
            content: extended,
            status: final ? ('done' as const) : ('streaming' as const),
            meta: { ...m.meta, swipes },
          };
        });
        return next;
      };
      if (final) return commitMessages(updater);
      queueStreamUpdate(updater);
      return next;
    };

    try {
      const reqHeaders = await getAuthHeaders(supabase);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: reqHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          mode: genMode,
          chatId,
          characterId: character.id,
          personaId: activePersona?.id,
          persona: activePersona,
          character,
          existingAssistantMessageId: target && isUuid(target.id) ? target.id : undefined,
          apiKey: await resolveLlmKey(settings),
          temperature: settings.defaultTemperature,
          authorsNote: authorsNote.prompt?.trim() || undefined,
          authorsNoteDepth: authorsNote.depth,
          stylePreset: SILLY_TAVERN_SYSTEM_PROMPT_PRESETS[currentPresetId]?.content || '',
          clientMemories: memories,
          clientSummary: currentSummary,
          clientState: chatState,
          history: slimHistory(genMode === 'continue' ? messages.slice(0, targetIndex + 1) : messages),
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || 'The model could not be reached.');
      }

      let rawText = '';
      const result = await streamRegeneratedReply(response, {
        charName,
        userName,
        onReasoning: () => undefined,
        onThinkingDone: () => undefined,
        onText: (live) => {
          rawText = live;
          if (genMode === 'continue') {
            applyContinuation(live, false);
          } else {
            setInputText(live.trimStart());
          }
        },
      });
      rawText = result.text || rawText;

      if (genMode === 'continue') {
        const finalMessages = applyContinuation(rawText, true);
        if (finalMessages.length) saveLocalMessages(chatId, finalMessages);
        if (result.failed) toast.error('The connection dropped before the reply finished.');
      } else {
        const draft = sanitizeModelOutput(rawText, userName);
        setInputText(draft);
        if (!draft) toast.error('No draft came back. Try again.');
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          ta.style.height = 'auto';
          ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        });
      }
    } catch (err) {
      flushStreamUpdate();
      if (!isAbortError(err)) {
        toast.error((err instanceof Error && err.message) || 'The model could not be reached.');
      }
      if (genMode === 'continue' && targetIndex >= 0) {
        setMessages((prev) => prev.map((m, i) => (i === targetIndex ? { ...m, status: 'done' } : m)));
      }
    } finally {
      setIsGenerating(false);
      setIsImpersonating(false);
      setAbortController(null);
    }
  };

  const handleSelectPreset = async (preset: { id: string }) => {
    setCurrentPresetId(preset.id);
    try {
      localStorage.setItem(`cadenza_preset_${chatId}`, preset.id);
    } catch {
      // private mode: the choice just won't survive a reload
    }
    if (!isUuid(chatId)) return;
    try {
      const { data: cRow } = await supabase.from('chats').select('settings').eq('id', chatId).maybeSingle();
      if (!cRow) return;
      const existingSettings = (cRow.settings as Record<string, unknown>) || {};
      await supabase
        .from('chats')
        .update({ settings: { ...existingSettings, system_prompt_preset: preset.id } })
        .eq('id', chatId);
    } catch (e) {
      console.warn('Failed to sync preset to Supabase:', e);
    }
  };

  const handleContinue = () => runAssistMode('continue');
  const handleImpersonate = () => runAssistMode('impersonate');

  // ── Message actions: one mode at a time keeps a long transcript quiet ──
  const [sheetMsgId, setSheetMsgId] = useState<string | null>(null);
  const sheetMessage = useMemo(
    () => (sheetMsgId ? messages.find((m) => m.id === sheetMsgId) || null : null),
    [messages, sheetMsgId]
  );
  const actionsHidden = Boolean(editingMsgId) || Boolean(deleteConfirmId) || Boolean(sheetMsgId);

  // Reconcile interaction state if messages change (e.g. deletion, rewind, prune)
  useEffect(() => {
    if (sheetMsgId && !messages.some((m) => m.id === sheetMsgId)) {
      setSheetMsgId(null);
    }
    if (deleteConfirmId && !messages.some((m) => m.id === deleteConfirmId)) {
      setDeleteConfirmId(null);
    }
    if (editingMsgId && !messages.some((m) => m.id === editingMsgId)) {
      setEditingMsgId(null);
    }
  }, [messages, sheetMsgId, deleteConfirmId, editingMsgId]);

  // Stable-identity handlers (see src/lib/hooks.ts): memoized rows then skip
  // re-rendering on composer keystrokes and streaming frames.
  const onSwipe = useEvent(handleSwipe);
  const onStartEdit = useEvent(handleStartEdit);
  const onSaveEdit = useEvent(handleSaveEdit);
  const onCancelEdit = useEvent(handleCancelEdit);
  const onDeleteRequest = useEvent(handleDeleteMessage);
  const onCancelDelete = useEvent(handleCancelDelete);
  const onCopy = useEvent(handleCopyMessage);
  const onRegenerate = useEvent(handleRegenerate);
  const onOpenActions = useEvent((msg: Message) => setSheetMsgId(msg.id));
  const onCloseSheet = useEvent(() => setSheetMsgId(null));
  const onEditFromSheet = useEvent((msg: Message) => onStartEdit(msg));
  const onRegenerateFromSheet = useEvent((msg: Message) => {
    const idx = messages.findIndex((m) => m.id === msg.id);
    if (idx !== -1) onRegenerate(idx);
  });
  const onDeleteFromSheet = useEvent((msg: Message) => onDeleteRequest(msg.id));

  // Track the visual viewport so the composer never hides behind the iOS keyboard.
  useVisualViewportVars();

  // A forgotten armed confirm must not eat a tap later.
  useEffect(() => {
    if (!deleteConfirmId) return;
    const t = setTimeout(() => setDeleteConfirmId(null), 8000);
    return () => clearTimeout(t);
  }, [deleteConfirmId]);

  // Keep the inline editor in view when it opens.
  useEffect(() => {
    if (!editingMsgId) return;
    const raf = requestAnimationFrame(() => {
      document
        .querySelector(`[data-msg-id="${editingMsgId}"]`)
        ?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'instant' : 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [editingMsgId]);


  return (
    <div
      className="flex flex-col w-full overflow-hidden bg-background select-none"
      style={{ height: 'var(--app-height, 100dvh)', transform: 'translateY(var(--app-offset-top, 0px))' }}
    >
      {/* Mobile-First Immersive Top Header */}
      <header className="pt-safe px-1.5 sm:px-6 bg-background border-b border-line shrink-0 z-30">
        <div className="h-12 sm:h-14 flex items-center justify-between">
          {/* Left: Back & Character Identity */}
        <div className="flex items-center gap-1 sm:gap-3 min-w-0">
          <Link
            href="/"
            className="icon-btn shrink-0"
            title="Back to roster"
            aria-label="Back to roster"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </Link>

          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-md overflow-hidden shrink-0 border border-line relative">
              <CharacterAvatar
                name={character?.name || 'Character'}
                avatarUrl={character?.avatar_url}
                accentColor={character?.accent_color}
                className="w-full h-full"
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tracking-tight truncate">
                  {character?.name}
                </span>
                {character?.content_rating !== 'sfw' && (
                  <span className="chip-danger shrink-0">
                    18+
                  </span>
                )}
              </div>
              <p className="type-meta truncate hidden sm:block">
                {character?.tagline}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Persona Switcher & Memory Drawer Button */}
        <div className="flex items-center sm:gap-2 shrink-0">
          {/* Active Persona Switcher: a plain icon on phones, a labelled pill on wider screens */}
          <button
            onClick={() => setPersonaModalOpen(true)}
            className="icon-btn sm:hidden"
            title="Change your roleplay persona"
            aria-label={`Persona: ${activePersona?.name || 'not set'}. Change persona`}
          >
            <User className="w-4 h-4" aria-hidden />
          </button>
          <button
            onClick={() => setPersonaModalOpen(true)}
            className="btn btn-ghost hidden sm:inline-flex px-2.5 py-1.5 text-xs font-semibold items-center gap-1.5 max-w-[200px]"
            title="Change your roleplay persona"
            aria-label={`Persona: ${activePersona?.name || 'not set'}. Change persona`}
          >
            <User className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {activePersona?.name || 'Set Persona'}
            </span>
          </button>

          {/* Regex Scripts & Output Formatters Studio Button */}
          <button
            onClick={() => setRegexModalOpen(true)}
            aria-label={`Regex scripts and output formatters, ${regexActiveCount} active`}
            aria-pressed={regexModalOpen}
            className="icon-btn relative hidden sm:inline-flex"
            title={`Regex scripts and output formatters (${regexActiveCount} active)`}
          >
            <Sparkles className="w-4 h-4" aria-hidden />
          </button>

          {/* Memory Inspector Button */}
          <button
            onClick={() => setInspectorOpen(!inspectorOpen)}
            aria-label="Inspect story facts and memories"
            aria-pressed={inspectorOpen}
            className="icon-btn relative"
            title="Inspect story facts and memories"
          >
            <Brain className="w-4 h-4" aria-hidden />
            {memories.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent" aria-hidden />
            )}
          </button>

          {/* More Actions Menu (Delete Chat, View Profile) */}
          <div className="relative">
            <button
              onClick={() => setHeaderMenuOpen(!headerMenuOpen)}
              className="icon-btn"
              title="More options"
              aria-label="More options"
              aria-expanded={headerMenuOpen}
            >
              <MoreVertical className="w-4 h-4" aria-hidden />
            </button>

            {headerMenuOpen && (
              <div className="panel absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-raised border-line shadow-float p-1.5 z-40 animate-in fade-in duration-150">
                <button
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setRegexModalOpen(true);
                  }}
                  className="btn btn-quiet w-full justify-start px-3 py-2 text-xs rounded-lg sm:hidden"
                >
                  <Sparkles className="w-4 h-4" aria-hidden />
                  Output formatting
                  <span className="ml-auto type-meta">{regexActiveCount} on</span>
                </button>
                {character?.id && (
                  <Link
                    href={`/c/${character.id}`}
                    onClick={() => setHeaderMenuOpen(false)}
                    className="btn btn-quiet w-full justify-start px-3 py-2 text-xs rounded-lg"
                  >
                    <ExternalLink className="w-4 h-4" aria-hidden />
                    Character profile
                  </Link>
                )}
                <button
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    handleDeleteCurrentChat();
                  }}
                  className="btn btn-quiet w-full justify-start px-3 py-2 text-xs rounded-lg text-danger border-t border-line mt-1 pt-2"
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                  Delete this chat
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </header>

      {/* Main Chat Canvas with Messages Timeline */}
      <div className="flex-1 flex overflow-hidden relative">
        <div
          ref={chatContainerRef}
          onScroll={handleChatScroll}
          role="log"
          aria-label="Conversation"
          className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-6 py-4 sm:py-6 space-y-5 scroll-smooth"
        >
          <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end space-y-5 pb-6">
            {messages.map((message, index) => (
              <MessageRow
                key={message.id || index}
                message={message}
                index={index}
                downstreamCount={messages.length - index - 1}
                character={character}
                activePersona={activePersona}
                regexScripts={regexScripts}
                isGenerating={isGenerating}
                editingMsgId={editingMsgId}
                editingText={editingMsgId === message.id ? editingText : ''}
                deleteConfirmId={deleteConfirmId}
                actionsHidden={actionsHidden}
                onStartEdit={onStartEdit}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                onEditingTextChange={setEditingText}
                onDeleteRequest={onDeleteRequest}
                onCancelDelete={onCancelDelete}
                onCopy={onCopy}
                onRegenerate={onRegenerate}
                onSwipe={onSwipe}
                onOpenActions={onOpenActions}
              />
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Floating Jump to Bottom Button */}
        {!isAtBottom && messages.length > 2 && (
          <button
            onClick={() => scrollToBottom(true)}
            aria-label="Jump to latest message"
            className="panel absolute bottom-4 right-4 sm:right-8 z-30 px-3.5 py-1.5 rounded-full bg-raised border-line shadow-raised flex items-center gap-2 text-xs font-semibold text-ink animate-in fade-in duration-150"
            title="Jump to latest message"
          >
            {isGenerating && (
              <span className="h-2 w-2 rounded-full bg-accent pulse-soft" aria-hidden />
            )}
            <span>Jump to latest</span>
            <ChevronDown className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}

        {/* SillyTavern Context & Memory Inspector */}
        {character && (
          <SillyTavernContextInspector
            open={inspectorOpen}
            onClose={() => setInspectorOpen(false)}
            chatId={chatId}
            character={character}
            activePersona={activePersona}
            history={messages}
            summary={currentSummary}
            memories={memories}
            onMemoriesChanged={(next) => {
              setMemories(next);
              if (!chatId.startsWith('local-')) return;
              saveLocalMemories(chatId, next);
            }}
            onSummaryUpdated={(newSummary) => {
              setCurrentSummary(newSummary);
              saveLocalSummary(chatId, newSummary);
            }}
            activeLorebookEntries={inspectorLore}
            vectorMemories={inspectorRecall}
            authorsNote={authorsNote}
            onAuthorsNoteUpdated={async (newNote) => {
              setAuthorsNote(newNote);
              saveLocalAuthorsNote(chatId, newNote);
              if (isUuid(chatId)) {
                try {
                  const { data: authData } = await supabase.auth.getUser();
                  if (authData?.user) {
                    const { data: cRow } = await supabase.from('chats').select('settings').eq('id', chatId).maybeSingle();
                    const existingSettings = (cRow?.settings as Record<string, unknown>) || {};
                    await supabase
                      .from('chats')
                      .update({
                        authors_note: newNote.prompt || '',
                        settings: {
                          ...existingSettings,
                          authors_note_depth: newNote.depth,
                          authors_note_interval: newNote.interval,
                          authors_note_role: newNote.role,
                          authors_note_position: newNote.position,
                        },
                      })
                      .eq('id', chatId);
                  }
                } catch (e) {
                  console.warn('Failed to sync authors note to Supabase:', e);
                }
              }
            }}
          />
        )}
      </div>

      {/* Mobile-First Reachable Bottom Input Composer */}
      <footer
        className={`px-2 pt-1.5 sm:p-4 bg-background border-t border-line shrink-0 ${
          keyboardOpen ? 'pb-1.5' : 'pb-[max(env(safe-area-inset-bottom,0px),0.5rem)] sm:pb-4'
        }`}
      >
        <div className="max-w-3xl mx-auto space-y-1.5 sm:space-y-2">
          {/* Author's Note Quick Drawer */}
          {showAuthorsNote && (
            <div className="surface p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="type-meta font-semibold text-ink-2 flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5" aria-hidden />
                  Author’s note (depth {authorsNote.depth})
                </span>
                <button
                  onClick={() => setShowAuthorsNote(false)}
                  className="icon-btn w-8 h-8"
                  aria-label="Close author’s note"
                >
                  <X className="w-4 h-4" aria-hidden />
                </button>
              </div>
              <textarea
                value={authorsNote.prompt}
                onChange={(e) => {
                  const updated = { ...authorsNote, prompt: e.target.value };
                  setAuthorsNote(updated);
                  saveLocalAuthorsNote(chatId, updated);
                }}
                rows={2}
                placeholder="Direct the scene, for example slow pacing in the rain…"
                aria-label="Author’s note"
                className="field resize-none text-base sm:text-xs leading-relaxed"
              />
            </div>
          )}

          <SillyTavernQuickActions
            onContinue={handleContinue}
            onImpersonate={handleImpersonate}
            isGenerating={isGenerating}
            authorsNoteActive={Boolean(authorsNote.prompt?.trim())}
            authorsNoteOpen={showAuthorsNote}
            onToggleAuthorsNote={() => setShowAuthorsNote(!showAuthorsNote)}
            thinkingEnabled={settings.thinkingEnabled}
            onToggleThinking={() => updateSettings({ thinkingEnabled: !settings.thinkingEnabled })}
            currentPresetId={currentPresetId}
            onSelectPreset={handleSelectPreset}
            onFormat={handleFormatInput}
            soundEnabled={soundEnabled}
            onToggleSound={() => {
              const next = !soundEnabled;
              toggleSound(next);
              if (next) playReceiveSound();
            }}
          />

          {/* Input Box with Big Thumb Send Button */}
          <div className="well relative flex items-end gap-2 p-1 sm:p-2 rounded-3xl">
            <textarea
              ref={textareaRef}
              rows={1}
              value={inputText}
              onChange={handleInputChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={isImpersonating ? 'Drafting your turn…' : `Write your turn as ${activePersona?.name || 'you'}…`}
              aria-label="Write your turn"
              className="flex-1 bg-transparent px-3 py-2 text-base sm:text-sm text-ink focus:outline-none resize-none max-h-32 sm:max-h-40 min-h-[40px] leading-snug sm:leading-relaxed"
            />

            {isGenerating ? (
              <button
                onClick={handleStop}
                className="btn btn-danger w-10 h-10 p-0 shrink-0"
                title="Stop generating"
                aria-label="Stop generating"
              >
                <Square className="w-4 h-4 fill-current" aria-hidden />
              </button>
            ) : (
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
                className="icon-btn w-10 h-10 bg-accent text-accent-ink hover:bg-accent-hover disabled:opacity-40 shrink-0"
                title="Send message"
                aria-label="Send message"
              >
                <Send className="w-4 h-4" aria-hidden />
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Universal Persona Selection & AI Generator Modal */}
      {/* Mobile message actions sheet (⋯ on a message row) */}
      {sheetMessage && (
        <MessageActionsSheet
          message={sheetMessage}
          onClose={onCloseSheet}
          onCopy={onCopy}
          onEdit={() => onEditFromSheet(sheetMessage)}
          onRegenerate={() => onRegenerateFromSheet(sheetMessage)}
          onDelete={() => onDeleteFromSheet(sheetMessage)}
        />
      )}

      <PersonaModal
        open={personaModalOpen}
        onClose={() => setPersonaModalOpen(false)}
        character={character}
        currentPersonaId={activePersona?.id}
        onSelectPersona={(newPersona) => {
          setActivePersona(newPersona);
          updateSettings({ activePersonaId: newPersona.id });
          toast.success(`Roleplaying as "${newPersona.name}"`);
        }}
      />

      {/* SillyTavern-Compatible Regex Scripts & Output Formatters Studio */}
      <RegexManagerModal
        open={regexModalOpen}
        onClose={() => setRegexModalOpen(false)}
        characterName={character?.name}
        userName={activePersona?.name}
        accentColor={character?.accent_color}
      />
    </div>
  );
}
