'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowLeft,
  Sparkles,
  Send,
  Square,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Copy,
  Edit2,
  Trash2,
  Brain,
  Sliders,
  Bookmark,
  GitBranch,
  X,
  Plus,
  Flame,
  Check,
  User,
  Settings,
  MoreVertical,
  ExternalLink,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { makeCharacter } from '@/lib/cards/card-parser';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { ThinkingProcess } from '@/components/thinking-process';
import { RoleplayMessageContent } from '@/components/chat/roleplay-message-content';
import { RegexManagerModal } from '@/components/chat/regex-manager-modal';
import { useRegexScripts } from '@/lib/store/regex-store';
import { processPromptTime } from '@/lib/formatter/regex-engine';
import { formatRoleplayText } from '@/lib/prompt/macros';
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
import {
  SILLY_TAVERN_SPECIAL_PROMPTS,
  SILLY_TAVERN_SYSTEM_PROMPT_PRESETS,
  type SystemPromptPreset,
} from '@/lib/prompt/presets';
import { toast } from 'sonner';
import type { Chat, Character, Persona, Message, Memory, Summary, ChatState } from '@/lib/supabase/types';

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
      kind: p.kind === 'swipe' ? 'swipe' : p.kind === 'regen' ? 'regen' : 'chat',
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
    onMetaSync?: (metaSync: any) => void;
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
  const [currentPresetId, setCurrentPresetId] = useState<string>('roleplay-detailed');

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
      await deleteChat(chatId);
      toast.success('Chat deleted');
      router.push('/?tab=chats');
    }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 1. Load Persona, Character, Messages, State
  useEffect(() => {
    async function initChat() {
      // 0. Load any existing local or Supabase chat metadata
      let existingChat: Chat | null = getLocalChat(chatId);

      if (!chatId.startsWith('local-')) {
        try {
          const { data: dbChat } = await supabase
            .from('chats')
            .select('*, character:characters(*)')
            .eq('id', chatId)
            .maybeSingle();
          if (dbChat) existingChat = dbChat as Chat;
        } catch (e) {
          console.error('Error fetching Supabase chat:', e);
        }
      }

      // A. Load Active Persona
      let resolvedPersona: Persona | null = null;
      let localPersonas: Persona[] = [];
      try {
        localPersonas = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
      } catch {}

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;
      const targetPersonaId = existingChat?.persona_id || settings.activePersonaId;

      if (userId) {
        const { data: dbPersonas } = await supabase
          .from('personas')
          .select('*')
          .order('created_at', { ascending: false });

        if (dbPersonas && dbPersonas.length > 0) {
          const list = dbPersonas as Persona[];
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

      setCharacter(charObj);

      // C. Load Messages & History
      const charName = charObj.name || 'Character';
      const userName = resolvedPersona.name || 'User';

      let loadedMessages: Message[] = [];
      const localMsgs = getLocalMessages(chatId);

      // 1. Fetch from Supabase if not a local chat
      if (!chatId.startsWith('local-')) {
        try {
          const { data: msgsData } = await supabase
            .from('messages')
            .select('*')
            .eq('chat_id', chatId)
            .order('created_at', { ascending: true });

          if (msgsData && msgsData.length > 0) {
            loadedMessages = msgsData as Message[];
          }
        } catch (e) {
          console.error('Error fetching Supabase messages:', e);
        }
      }

      // 2. Reconcile with LocalStorage so unpersisted user messages or accurate live timers are never wiped
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

        // B. Preserve any trailing or pending local user/assistant messages that haven't synced to DB
        const dbIds = new Set(loadedMessages.map((m) => m.id));
        const unsavedLocal = localMsgs.filter((lm) => !dbIds.has(lm.id));
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
      if (!chatId.startsWith('local-')) {
        try {
          const { data: memData } = await supabase
            .from('memories')
            .select('*')
            .eq('chat_id', chatId)
            .is('superseded_by', null)
            .order('importance', { ascending: false });

          if (memData) setMemories(memData as Memory[]);

          const { data: sumData } = await supabase
            .from('summaries')
            .select('*')
            .eq('chat_id', chatId)
            .eq('superseded', false)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (sumData) setCurrentSummary(sumData as Summary);

          const { data: stateData } = await supabase
            .from('chat_state')
            .select('*')
            .eq('chat_id', chatId)
            .maybeSingle();

          if (stateData?.state) setChatState(stateData.state);
        } catch {}
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
        const noteSettings = (existingChat.settings as any) || {};
        setAuthorsNote({
          prompt: existingChat.authors_note,
          depth: typeof noteSettings.authors_note_depth === 'number' ? noteSettings.authors_note_depth : 4,
          interval: typeof noteSettings.authors_note_interval === 'number' ? noteSettings.authors_note_interval : 1,
          role: noteSettings.authors_note_role || 'system',
          position: noteSettings.authors_note_position || 'in_chat',
        });
      }

      const localPreset = typeof window !== 'undefined' ? localStorage.getItem(`cadenza_preset_${chatId}`) : null;
      if (localPreset) {
        setCurrentPresetId(localPreset);
      } else if (existingChat && (existingChat.settings as any)?.system_prompt_preset) {
        setCurrentPresetId((existingChat.settings as any).system_prompt_preset);
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
              const tempMatch = prev.find(
                (m) =>
                  (m.id.startsWith('usr-') || m.id.startsWith('ast-')) &&
                  m.role === newMsg.role &&
                  (m.content === newMsg.content || !m.content)
              );
              let updated: Message[];
              if (tempMatch) {
                updated = prev.map((m) => (m.id === tempMatch.id ? newMsg : m));
              } else {
                updated = [...prev, newMsg];
              }
              saveLocalMessages(chatId, updated);
              return updated;
            });
          } else if (payload.eventType === 'UPDATE') {
            const updatedMsg = payload.new as Message;
            setMessages((prev) => {
              const updated = prev.map((m) => (m.id === updatedMsg.id ? { ...m, ...updatedMsg } : m));
              saveLocalMessages(chatId, updated);
              return updated;
            });
          } else if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as Message)?.id;
            if (oldId) {
              setMessages((prev) => {
                const updated = prev.filter((m) => m.id !== oldId);
                saveLocalMessages(chatId, updated);
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

  // Auto-scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isGenerating]);

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

    if (!settings.opencodeApiKey && !process.env.NEXT_PUBLIC_HAS_SERVER_KEY) {
      toast.error('Please configure your OpenCode Go API key in Settings first.');
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
          apiKey: settings.opencodeApiKey,
          temperature: settings.defaultTemperature,
          thinking: settings.thinkingEnabled,
          authorsNote: authorsNote.prompt?.trim() || undefined,
          authorsNoteDepth: authorsNote.depth,
          presetContent: SILLY_TAVERN_SYSTEM_PROMPT_PRESETS[currentPresetId]?.content,
          history: messages,
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
                    window.history.replaceState(null, '', `/chat/${resolvedChatId}`);
                  }
                  if (parsed.metaSync.userMsgId) resolvedUserMsgId = parsed.metaSync.userMsgId;
                  if (parsed.metaSync.assistantMsgId) resolvedAssistantMsgId = parsed.metaSync.assistantMsgId;
                  if (parsed.metaSync.reasoning_duration_seconds && !reasoningDuration) {
                    reasoningDuration = parsed.metaSync.reasoning_duration_seconds;
                  }
                }

                if (parsed.reasoning) {
                  streamedReasoning += parsed.reasoning;
                  setMessages((prev) =>
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
                  setMessages((prev) =>
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

                  setMessages((prev) =>
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

      let finalMessages: Message[] = [];
      setMessages((prev) => {
        finalMessages = prev.map((m) => {
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
            status: 'done',
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
        return finalMessages;
      });
      saveLocalMessages(chatId, finalMessages);

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

      // Refresh memory & state after a few seconds
      setTimeout(async () => {
        const { data: memData } = await supabase
          .from('memories')
          .select('*')
          .eq('chat_id', chatId)
          .is('superseded_by', null);
        if (memData) setMemories(memData as Memory[]);

        const { data: stData } = await supabase
          .from('chat_state')
          .select('*')
          .eq('chat_id', chatId)
          .maybeSingle();
        if (stData?.state) setChatState(stData.state);
      }, 3500);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast.error(err.message || 'Generation error');
        let errMessages: Message[] = [];
        setMessages((prev) => {
          errMessages = prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  status: 'error',
                  content: m.content || '*[Connection interrupted. Tap retry to continue.]*',
                }
              : m
          );
          return errMessages;
        });
        saveLocalMessages(chatId, errMessages);
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
    const msg = messages[msgIndex];
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

    let updatedMsgs: Message[] = [];
    setMessages((prev) => {
      updatedMsgs = prev.map((m, i) =>
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
      );
      return updatedMsgs;
    });
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

    if (!settings.opencodeApiKey && !process.env.NEXT_PUBLIC_HAS_SERVER_KEY) {
      toast.error('Please configure your OpenCode Go API key in Settings first.');
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

    // Add a new swipe slot
    const prevSwipes = targetMsg.meta?.swipes || [targetMsg.content];
    const prevReasoningSwipes = targetMsg.meta?.reasoning_swipes || [targetMsg.reasoning || ''];
    const newSwipeIndex = prevSwipes.length;
    const updatedSwipes = [...prevSwipes, ''];
    const updatedReasoningSwipes = [...prevReasoningSwipes, ''];

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
          apiKey: settings.opencodeApiKey,
          temperature: settings.defaultTemperature,
          thinking: settings.thinkingEnabled,
          authorsNote: authorsNote.prompt?.trim() || undefined,
          authorsNoteDepth: authorsNote.depth,
          presetContent: SILLY_TAVERN_SYSTEM_PROMPT_PRESETS[currentPresetId]?.content,
          history: historyBeforeAssistant.filter((m) => m.content !== triggerUserMessage),
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
                }

                if (parsed.reasoning) {
                  streamedReasoning += parsed.reasoning;
                  setMessages((prev) =>
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
                  setMessages((prev) =>
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

                  setMessages((prev) =>
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

      let finalMessages: Message[] = [];
      setMessages((prev) => {
        finalMessages = prev.map((m, i) => {
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
            status: 'done',
            content: finalVal,
            reasoning: streamedReasoning || m.reasoning || null,
            meta: {
              ...m.meta,
              swipes: sList,
              active_swipe_index: newSwipeIndex,
              reasoning_swipes: rList,
              reasoning_duration_seconds: reasoningDuration || m.meta?.reasoning_duration_seconds,
              reasoning_durations: dList,
            },
          };
        });
        return finalMessages;
      });
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

      toast.success(`Generated variation ${newSwipeIndex + 1}/${updatedSwipes.length}`);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        toast.error(err.message || 'Regeneration error');
        setMessages((prev) =>
          prev.map((m, i) =>
            i === assistantMsgIndex
              ? {
                  ...m,
                  status: 'done',
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
    if (!settings.opencodeApiKey && !process.env.NEXT_PUBLIC_HAS_SERVER_KEY) {
      toast.error('Please configure your OpenCode Go API key in Settings first.');
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
          apiKey: settings.opencodeApiKey,
          temperature: settings.defaultTemperature,
          thinking: settings.thinkingEnabled,
          authorsNote: authorsNote.prompt?.trim() || undefined,
          authorsNoteDepth: authorsNote.depth,
          presetContent: SILLY_TAVERN_SYSTEM_PROMPT_PRESETS[currentPresetId]?.content,
          history: baseBefore,
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || 'Failed to regenerate response');
      }

      // Stream via the module helper; live bubbles update through callbacks
      // while the deterministic result below drives both persistent stores.
      const streamResult = await streamRegeneratedReply(response, {
        charName,
        userName,
        onReasoning: (full) =>
          setMessages((prev) =>
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
          setMessages((prev) =>
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
          setMessages((prev) =>
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

      if (streamResult.failed) {
        // Stream died mid-way: keep the partial reply, mark it error, and
        // persist the same timeline to both stores.
        toast.error('Regeneration error');
        const errVal = formatRoleplayText(streamResult.text, charName, userName);
        const failedAssistant: Message = {
          ...placeholder,
          status: 'error',
          content: errVal || '*[Connection interrupted. Tap retry to continue.]*',
          reasoning: streamResult.reasoning || null,
          updated_at: new Date().toISOString(),
          meta: {
            ...placeholder.meta,
            swipes: [errVal || '*[Connection interrupted. Tap retry to continue.]*'],
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
        toast.error(err instanceof Error ? err.message : 'Regeneration error');
        const failedAssistant: Message = {
          ...placeholder,
          status: 'error',
          content: '*[Connection interrupted. Tap retry to continue.]*',
          reasoning: null,
          updated_at: new Date().toISOString(),
          meta: {
            ...placeholder.meta,
            swipes: ['*[Connection interrupted. Tap retry to continue.]*'],
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
    navigator.clipboard.writeText(text);
    toast.success('Copied message to clipboard');
  };

  // SillyTavern Continue: Continue generating character's last message
  const handleContinue = () => {
    if (isGenerating) return;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;

    if (lastMsg.role === 'assistant') {
      handleSendMessage(SILLY_TAVERN_SPECIAL_PROMPTS.continueNudgePrompt);
    } else {
      handleSendMessage();
    }
  };

  // SillyTavern Impersonate: Draft next reply from user's perspective
  const handleImpersonate = () => {
    if (isGenerating) return;
    handleSendMessage(SILLY_TAVERN_SPECIAL_PROMPTS.impersonationPrompt);
  };

  return (
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden bg-background select-none">
      {/* Mobile-First Immersive Top Header */}
      <header className="pt-safe px-3 sm:px-6 border-b border-black/[0.06] dark:border-white/[0.08] glass-panel shrink-0 z-30">
        <div className="h-14 flex items-center justify-between">
          {/* Left: Back & Character Identity */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Link
            href="/"
            className="p-2 -ml-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Back to Roster"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>

          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl overflow-hidden bg-black/10 shrink-0 border border-white/20 shadow-xs relative">
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
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-500/15 text-red-500 font-bold shrink-0">
                    18+
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate hidden xs:block">
                {character?.tagline}
              </p>
            </div>
          </div>
        </div>

        {/* Right: Persona Switcher & Memory Drawer Button */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Active Persona Switcher Pill */}
          <button
            onClick={() => setPersonaModalOpen(true)}
            className="px-2.5 py-1.5 rounded-full bg-accent/10 hover:bg-accent/20 text-accent text-xs font-semibold apple-button flex items-center gap-1.5 border border-accent/20 transition-all max-w-[140px] sm:max-w-[200px]"
            title="Click to change your roleplay persona"
          >
            <User className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {activePersona?.name || 'Set Persona'}
            </span>
          </button>

          {/* Regex Scripts & Output Formatters Studio Button */}
          <button
            onClick={() => setRegexModalOpen(true)}
            className={`p-2 rounded-full apple-button flex items-center justify-center border transition-all ${
              regexModalOpen
                ? 'bg-accent/15 border-accent text-accent'
                : 'border-black/[0.06] dark:border-white/[0.08] hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground'
            }`}
            title={`Regex Scripts & Output Formatters (${regexActiveCount} Active)`}
          >
            <Sparkles className="w-4 h-4 text-accent" />
          </button>

          {/* Memory Inspector Button */}
          <button
            onClick={() => setInspectorOpen(!inspectorOpen)}
            className={`p-2 rounded-full apple-button flex items-center justify-center border transition-all ${
              inspectorOpen
                ? 'bg-accent/15 border-accent text-accent'
                : 'border-black/[0.06] dark:border-white/[0.08] hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground'
            }`}
            title="Inspect story facts & memories"
          >
            <Brain className="w-4 h-4" />
            {memories.length > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent" />
            )}
          </button>

          {/* More Actions Menu (Delete Chat, View Profile) */}
          <div className="relative">
            <button
              onClick={() => setHeaderMenuOpen(!headerMenuOpen)}
              className="p-2 rounded-full border border-black/[0.06] dark:border-white/[0.08] hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground apple-button"
              title="More options"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {headerMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl bg-[#202024] border border-white/10 shadow-2xl p-1.5 z-40 animate-in fade-in duration-150">
                {character?.id && (
                  <Link
                    href={`/c/${character.id}`}
                    onClick={() => setHeaderMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-xs text-zinc-200 hover:bg-white/5 rounded-xl transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 text-zinc-400" />
                    Character Profile
                  </Link>
                )}
                <button
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    handleDeleteCurrentChat();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-xl transition-colors text-left"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete This Chat
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </header>

      {/* Main Chat Canvas with Messages Timeline */}
      <div className="flex-1 flex overflow-hidden relative">
        <main className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
          <div className="max-w-3xl mx-auto space-y-5 pb-6">
            {messages.map((message, index) => {
              const isAssistant = message.role === 'assistant';
              const swipes = message.meta?.swipes || [message.content];
              const swipeIndex = message.meta?.active_swipe_index ?? 0;
              const formattedContent = formatRoleplayText(
                message.content,
                character?.name || 'Character',
                activePersona?.name || 'User'
              );

              return (
                <div
                  key={message.id || index}
                  className={`flex flex-col group ${isAssistant ? 'items-start' : 'items-end'}`}
                >
                  {isAssistant ? (
                    /* Assistant Roleplay Prose (Spacious & Mobile-Optimized) */
                    <div className="w-full space-y-1.5">
                      {/* Author Line & Swipes */}
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg overflow-hidden bg-black/10 shrink-0 border border-white/10">
                            <CharacterAvatar
                              name={character?.name || 'Character'}
                              avatarUrl={character?.avatar_url}
                              accentColor={character?.accent_color}
                              className="w-full h-full"
                            />
                          </div>
                          <span className="text-xs font-semibold tracking-tight text-foreground/90">
                            {character?.name}
                          </span>
                        </div>

                        {/* Swipes Controller */}
                        {swipes.length > 1 && (
                          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-[11px] text-muted-foreground font-mono">
                            <button
                              onClick={() => handleSwipe(index, 'prev')}
                              disabled={swipeIndex === 0}
                              className="disabled:opacity-30 hover:text-foreground p-0.5"
                            >
                              <ChevronLeft className="w-3 h-3" />
                            </button>
                            <span>
                              {swipeIndex + 1}/{swipes.length}
                            </span>
                            <button
                              onClick={() => handleSwipe(index, 'next')}
                              disabled={swipeIndex === swipes.length - 1}
                              className="disabled:opacity-30 hover:text-foreground p-0.5"
                            >
                              <ChevronRight className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Narrative Bubble or Inline Editor */}
                      {editingMsgId === message.id ? (
                        <div className="w-full space-y-2 p-3 sm:p-4 rounded-2xl glass-card border border-accent/40 shadow-xs animate-in fade-in zoom-in-[0.98] duration-150 ease-out">
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') handleCancelEdit();
                              else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSaveEdit();
                            }}
                            rows={4}
                            className="w-full p-2.5 rounded-xl bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-y font-normal leading-relaxed"
                            placeholder="Edit character response..."
                            autoFocus
                          />
                          <p className="text-[11px] text-muted-foreground px-0.5">
                            Edits only this response — messages after it stay untouched.
                          </p>
                          <div className="flex items-center justify-end gap-2 text-xs">
                            <button
                              onClick={handleCancelEdit}
                              className="px-3 py-1 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground transition-colors apple-button"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSaveEdit}
                              disabled={isGenerating || !editingText.trim()}
                              className="px-3 py-1 rounded-xl bg-accent text-white font-semibold flex items-center gap-1.5 hover:opacity-90 transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] apple-button disabled:opacity-40"
                            >
                              <Check className="w-3.5 h-3.5" /> Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="w-full space-y-2">
                          {/* Live Model Thinking Stream & Collapsible Disclosure Widget */}
                          <ThinkingProcess
                            reasoning={message.reasoning}
                            isStreaming={message.status === 'streaming'}
                            hasContent={Boolean(message.content && message.content.trim().length > 0)}
                            durationSeconds={message.meta?.reasoning_duration_seconds}
                            characterName={character?.name}
                          />

                          {/* Roleplay Prose Bubble */}
                          {(message.content || (!message.reasoning && message.status !== 'streaming')) ? (
                            <div className="p-4 sm:p-5 rounded-2xl rounded-tl-sm glass-card text-xs sm:text-sm text-foreground/95 leading-relaxed roleplay-prose shadow-xs border border-black/[0.05] dark:border-white/[0.07] select-text">
                              <RoleplayMessageContent
                                content={message.content}
                                characterName={character?.name || 'Character'}
                                userName={activePersona?.name || 'User'}
                                accentColor={character?.accent_color}
                                role="assistant"
                                isStreaming={message.status === 'streaming'}
                                scripts={regexScripts}
                              />
                            </div>
                          ) : (
                            /* Fallback if a previous response ended with reasoning but empty text */
                            !message.content && message.reasoning && message.status !== 'streaming' && (
                              <div className="p-3.5 sm:p-4 rounded-2xl rounded-tl-sm bg-amber-500/[0.06] dark:bg-amber-500/[0.09] border border-amber-500/25 text-xs text-foreground/90 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                <div>
                                  <p className="font-semibold text-amber-600 dark:text-amber-400">Response stopped after reasoning</p>
                                  <p className="text-[11px] text-muted-foreground mt-0.5">The model finished its thoughts without outputting prose.</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleRegenerate(index)}
                                  className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 font-medium text-xs transition-colors self-start sm:self-auto flex items-center gap-1.5 apple-button"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                  <span>Regenerate Response</span>
                                </button>
                              </div>
                            )
                          )}
                        </div>
                      )}

                      {/* Action Bar (Copy, Edit, Regenerate, Delete from here) */}
                      {deleteConfirmId === message.id ? (
                        <div className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 mt-1 rounded-xl bg-red-500/10 border border-red-500/25 text-[11px] text-red-600 dark:text-red-400 animate-in fade-in slide-in-from-top-1 duration-150 ease-out">
                          <span className="font-medium">
                            {messages.length - index - 1 > 0
                              ? `Delete this and the ${messages.length - index - 1} after it?`
                              : 'Delete this response?'}
                          </span>
                          <button
                            onClick={() => handleDeleteMessage(message.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] apple-button"
                          >
                            Delete
                          </button>
                          <button
                            onClick={handleCancelDelete}
                            className="px-2.5 py-1 rounded-lg hover:bg-red-500/10 transition-colors apple-button"
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                      <div className="flex items-center gap-1 px-1 pt-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopyMessage(formattedContent)}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 transition-colors"
                          title="Copy message"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleStartEdit(message)}
                          disabled={isGenerating}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 transition-colors disabled:opacity-40"
                          title="Edit response"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleRegenerate(index)}
                          disabled={isGenerating}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-accent text-[11px] flex items-center gap-1 transition-colors disabled:opacity-40"
                          title="Regenerate alternate response (Reroll)"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteMessage(message.id)}
                          disabled={isGenerating}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 text-[11px] flex items-center gap-1 transition-colors disabled:opacity-40"
                          title="Delete from here — removes this and everything after it"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      )}
                    </div>
                  ) : (
                    /* User Response Bubble */
                    <div className="max-w-[85%] sm:max-w-[75%] space-y-1">
                      {/* Persona Name & Monogram */}
                      <div className="flex items-center justify-end gap-1.5 px-1">
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {activePersona?.name || 'You'}
                        </span>
                        <div className="w-5 h-5 rounded-md overflow-hidden shrink-0 border border-white/10">
                          <CharacterAvatar
                            name={activePersona?.name || 'User'}
                            avatarUrl={activePersona?.avatar_url}
                            className="w-full h-full"
                          />
                        </div>
                      </div>

                      {/* User Message Card or Inline Editor */}
                      {editingMsgId === message.id ? (
                        <div className="w-full space-y-2 p-3 rounded-2xl bg-accent text-white shadow-sm border border-white/20 animate-in fade-in zoom-in-[0.98] duration-150 ease-out">
                          {messages.length - index - 1 > 0 && (
                            <div className="flex items-start gap-1.5 px-1 pt-0.5 text-[11px] leading-snug text-white/90">
                              <GitBranch className="w-3.5 h-3.5 mt-px shrink-0" />
                              <span>
                                Saving deletes the {messages.length - index - 1} message{messages.length - index - 1 === 1 ? '' : 's'} after this and generates a new reply.
                              </span>
                            </div>
                          )}
                          <textarea
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') handleCancelEdit();
                              else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSaveEdit();
                            }}
                            rows={3}
                            className="w-full p-2.5 rounded-xl bg-black/20 text-white placeholder-white/60 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-white/40 resize-y"
                            autoFocus
                          />
                          <div className="flex items-center justify-between gap-2 text-xs px-0.5">
                            <span className="text-[11px] text-white/60 hidden sm:inline">
                              Ctrl + Enter to send
                            </span>
                            <div className="flex items-center gap-2 ml-auto">
                              <button
                                onClick={handleCancelEdit}
                                className="px-2.5 py-1 rounded-lg text-white/80 hover:bg-white/10 transition-colors apple-button"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleSaveEdit}
                                disabled={isGenerating || !editingText.trim()}
                                className="px-3 py-1 rounded-lg bg-white text-accent font-semibold flex items-center gap-1 shadow-xs apple-button transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] disabled:opacity-50"
                              >
                                <Send className="w-3.5 h-3.5" />
                                {messages.length - index - 1 > 0 ? 'Save & Regenerate' : 'Save & Send'}
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3.5 sm:p-4 rounded-2xl rounded-tr-sm bg-accent text-white text-xs sm:text-sm leading-relaxed shadow-sm select-text">
                          <RoleplayMessageContent
                            content={message.content}
                            characterName={character?.name || 'Character'}
                            userName={activePersona?.name || 'User'}
                            role="user"
                            scripts={regexScripts}
                          />
                        </div>
                      )}

                      {deleteConfirmId === message.id ? (
                        <div className="flex flex-wrap justify-end items-center gap-2 px-2.5 py-1.5 mt-1 rounded-xl bg-red-500/10 border border-red-500/25 text-[11px] text-red-600 dark:text-red-400 animate-in fade-in slide-in-from-top-1 duration-150 ease-out">
                          <span className="font-medium">
                            {messages.length - index - 1 > 0
                              ? `Delete this and the ${messages.length - index - 1} after it?`
                              : 'Delete this message?'}
                          </span>
                          <button
                            onClick={() => handleDeleteMessage(message.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] apple-button"
                          >
                            Delete
                          </button>
                          <button
                            onClick={handleCancelDelete}
                            className="px-2.5 py-1 rounded-lg hover:bg-red-500/10 text-muted-foreground transition-colors apple-button"
                          >
                            Keep
                          </button>
                        </div>
                      ) : (
                      <div className="flex justify-end items-center gap-1 px-1 pt-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopyMessage(formattedContent)}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] transition-colors"
                          title="Copy"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleStartEdit(message)}
                          disabled={isGenerating}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] transition-colors disabled:opacity-40"
                          title="Edit and regenerate from here"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDeleteMessage(message.id)}
                          disabled={isGenerating}
                          className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 text-[11px] transition-colors disabled:opacity-40"
                          title="Delete from here — removes this and everything after it"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </main>

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
            onSummaryUpdated={(newSummary) => {
              setCurrentSummary(newSummary);
              saveLocalSummary(chatId, newSummary);
            }}
            authorsNote={authorsNote}
            onAuthorsNoteUpdated={async (newNote) => {
              setAuthorsNote(newNote);
              saveLocalAuthorsNote(chatId, newNote);
              if (isUuid(chatId)) {
                try {
                  const { data: authData } = await supabase.auth.getUser();
                  if (authData?.user) {
                    const { data: cRow } = await supabase.from('chats').select('settings').eq('id', chatId).maybeSingle();
                    const existingSettings = (cRow?.settings as any) || {};
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
      <footer className="p-2 sm:p-4 border-t border-black/[0.06] dark:border-white/[0.08] glass-panel shrink-0 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* SillyTavern Quick Action Chips */}
          <SillyTavernQuickActions
            onContinue={handleContinue}
            onImpersonate={handleImpersonate}
            isGenerating={isGenerating}
            authorsNoteActive={Boolean(authorsNote.prompt?.trim())}
            onToggleAuthorsNote={() => setShowAuthorsNote(!showAuthorsNote)}
            thinkingEnabled={settings.thinkingEnabled}
            onToggleThinking={() => {
              const nextVal = !settings.thinkingEnabled;
              updateSettings({ thinkingEnabled: nextVal });
              toast.info(nextVal ? 'Deep Thinking Mode: ON' : 'Deep Thinking Mode: OFF');
            }}
            currentPresetId={currentPresetId}
            onOpenRegexManager={() => setRegexModalOpen(true)}
            regexActiveCount={regexActiveCount}
            onSelectPreset={async (preset) => {
              setCurrentPresetId(preset.id);
              if (typeof window !== 'undefined') {
                localStorage.setItem(`cadenza_preset_${chatId}`, preset.id);
              }
              if (isUuid(chatId)) {
                try {
                  const { data: authData } = await supabase.auth.getUser();
                  if (authData?.user) {
                    const { data: cRow } = await supabase.from('chats').select('settings').eq('id', chatId).maybeSingle();
                    const existingSettings = (cRow?.settings as any) || {};
                    await supabase
                      .from('chats')
                      .update({
                        settings: {
                          ...existingSettings,
                          system_prompt_preset: preset.id,
                        },
                      })
                      .eq('id', chatId);
                  }
                } catch (e) {
                  console.warn('Failed to sync preset to Supabase:', e);
                }
              }
            }}
          />

          {/* Author's Note Quick Drawer */}
          {showAuthorsNote && (
            <div className="p-3 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-semibold text-accent flex items-center gap-1.5">
                  <Bookmark className="w-3.5 h-3.5" />
                  Author's Note (Injected at Depth {authorsNote.depth})
                </span>
                <button onClick={() => setShowAuthorsNote(false)} className="hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
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
                placeholder="Direct the scene (e.g. Focus on intimate tension, pouring rain, slow pacing)..."
                className="w-full px-3 py-2 rounded-xl bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs focus:outline-none focus:ring-1 focus:ring-accent resize-none leading-relaxed"
              />
            </div>
          )}

          {/* Input Box with Big Thumb Send Button */}
          <div className="relative flex items-end gap-2 p-1.5 sm:p-2 rounded-3xl glass-card border border-black/[0.08] dark:border-white/[0.1] focus-within:ring-2 focus-within:ring-accent/40 shadow-xs">
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
              placeholder={`Write your turn as ${activePersona?.name || 'User'}...`}
              className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-foreground focus:outline-none resize-none max-h-40 min-h-[40px] leading-relaxed"
            />

            {isGenerating ? (
              <button
                onClick={handleStop}
                className="w-10 h-10 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shrink-0 apple-button shadow-xs touch-manipulation"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
                className="w-10 h-10 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent text-white flex items-center justify-center shrink-0 apple-button shadow-xs transition-colors touch-manipulation"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </footer>

      {/* Universal Persona Selection & AI Generator Modal */}
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
