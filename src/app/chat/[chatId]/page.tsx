'use client';

import React, { useState, useEffect, useRef } from 'react';
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
import { formatRoleplayText } from '@/lib/prompt/macros';
import { saveLocalChat, deleteChat } from '@/lib/chats/chat-manager';
import { toast } from 'sonner';
import type { Character, Persona, Message, Memory, ChatState } from '@/lib/supabase/types';

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
  const [chatState, setChatState] = useState<ChatState['state']>({});
  const [newMemoryText, setNewMemoryText] = useState('');

  // Editing in-place
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Author's note
  const [authorsNote, setAuthorsNote] = useState('');
  const [showAuthorsNote, setShowAuthorsNote] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);

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
      // A. Load Active Persona
      let resolvedPersona: Persona | null = null;
      let localPersonas: Persona[] = [];
      try {
        localPersonas = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
      } catch {}

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;

      if (userId) {
        const { data: dbPersonas } = await supabase
          .from('personas')
          .select('*')
          .order('created_at', { ascending: false });

        if (dbPersonas && dbPersonas.length > 0) {
          const list = dbPersonas as Persona[];
          resolvedPersona =
            list.find((p) => p.id === settings.activePersonaId) ||
            list.find((p) => p.is_default) ||
            list[0];
        }
      }

      if (!resolvedPersona && localPersonas.length > 0) {
        resolvedPersona =
          localPersonas.find((p) => p.id === settings.activePersonaId) ||
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

      // B. Load Character
      let charObj: Character | null = null;

      // 1. Try finding by charIdParam in DB
      if (charIdParam) {
        const { data: dbC } = await supabase
          .from('characters')
          .select('*')
          .eq('id', charIdParam)
          .maybeSingle();

        if (dbC) {
          charObj = dbC as Character;
        }
      }

      // 2. Try finding in local storage
      if (!charObj && charIdParam) {
        try {
          const localList = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
          const found = localList.find(
            (c: any) =>
              c.id === charIdParam ||
              c.name.toLowerCase() === decodeURIComponent(charIdParam).toLowerCase()
          );
          if (found) charObj = found as Character;
        } catch {}
      }

      // 3. Try finding through chat session in DB
      if (!charObj && !chatId.startsWith('local-')) {
        const { data: chatData } = await supabase
          .from('chats')
          .select('*, character:characters(*)')
          .eq('id', chatId)
          .maybeSingle();

        if (chatData?.character) {
          charObj = chatData.character as Character;
        }
      }

      // 4. Dynamic fallback if none matched
      if (!charObj) {
        const cleanName = charIdParam
          ? decodeURIComponent(charIdParam).replace(/^local-char-\d+-?/, '').replace(/-/g, ' ')
          : 'Roleplay Partner';

        charObj = makeCharacter({
          id: charIdParam || `char-${Date.now()}`,
          user_id: 'guest',
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

      if (!chatId.startsWith('local-')) {
        const { data: msgsData } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true });

        if (msgsData && msgsData.length > 0) {
          const cleanedMsgs = (msgsData as Message[]).map((m) => ({
            ...m,
            content: formatRoleplayText(m.content, charName, userName),
          }));
          setMessages(cleanedMsgs);
        }

        // Fetch memories & state
        const { data: memData } = await supabase
          .from('memories')
          .select('*')
          .eq('chat_id', chatId)
          .is('superseded_by', null)
          .order('importance', { ascending: false });

        if (memData) setMemories(memData as Memory[]);

        const { data: stateData } = await supabase
          .from('chat_state')
          .select('*')
          .eq('chat_id', chatId)
          .maybeSingle();

        if (stateData?.state) setChatState(stateData.state);
      }

      // If no messages yet, seed the character's first_message with macro substitution!
      if (charObj && messages.length === 0) {
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
      }

      // Record in local chats for guest/offline sessions
      if (charObj && chatId.startsWith('local-')) {
        saveLocalChat({
          id: chatId,
          user_id: 'guest',
          character_id: charObj.id,
          character: charObj,
          persona_id: resolvedPersona?.id || null,
          title: `Chat with ${charObj.name}`,
          leaf_id: null,
          memory_cursor_id: null,
          authors_note: '',
          settings: {},
          pinned: false,
          archived: false,
          message_count: 1,
          last_message_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    initChat();
  }, [chatId, charIdParam, supabase]);

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
    const textToSend = (customPrompt ?? inputText).trim();
    if (!textToSend || isGenerating || !character) return;

    if (!settings.opencodeApiKey && !process.env.NEXT_PUBLIC_HAS_SERVER_KEY) {
      toast.error('Please configure your OpenCode Go API key in Settings first.');
      return;
    }

    const charName = character.name || 'Character';
    const userName = activePersona?.name || 'User';

    const userMsgId = 'usr-' + Date.now();
    const newUserMsg: Message = {
      id: userMsgId,
      chat_id: chatId,
      user_id: 'user',
      parent_id: messages.length > 0 ? messages[messages.length - 1].id : null,
      role: 'user',
      content: formatRoleplayText(textToSend, charName, userName),
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
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newUserMsg, newAssistantMsg]);
    setInputText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setIsGenerating(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          chatId,
          characterId: character.id,
          personaId: activePersona?.id,
          persona: activePersona,
          character,
          userMessage: textToSend,
          parentMessageId: newUserMsg.parent_id,
          apiKey: settings.opencodeApiKey,
          temperature: settings.defaultTemperature,
          thinking: settings.thinkingEnabled,
          authorsNote: authorsNote.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const errorJson = await response.json();
        throw new Error(errorJson.error || 'Failed to generate response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let streamedContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
              try {
                const parsed = JSON.parse(trimmed.slice(6));
                if (parsed.text) {
                  streamedContent += parsed.text;
                  const formattedLive = formatRoleplayText(streamedContent, charName, userName);

                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            content: formattedLive,
                            meta: {
                              ...m.meta,
                              swipes: [formattedLive],
                            },
                          }
                        : m
                    )
                  );
                }
              } catch {
                // ignore
              }
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                status: 'done',
                content: formatRoleplayText(m.content, charName, userName),
              }
            : m
        )
      );

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
            authors_note: '',
            settings: {},
            pinned: false,
            archived: false,
            message_count: messages.length + 2,
            last_message_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso,
          });
        } else {
          supabase
            .from('chats')
            .update({
              last_message_at: nowIso,
              message_count: messages.length + 2,
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
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  status: 'error',
                  content: m.content || '*[Connection interrupted. Tap retry to continue.]*',
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
    let currentIndex = msg.meta?.active_swipe_index ?? 0;

    if (direction === 'prev' && currentIndex > 0) {
      currentIndex--;
    } else if (direction === 'next' && currentIndex < swipes.length - 1) {
      currentIndex++;
    }

    setMessages((prev) =>
      prev.map((m, i) =>
        i === msgIndex
          ? {
              ...m,
              content: swipes[currentIndex],
              meta: { ...m.meta, active_swipe_index: currentIndex },
            }
          : m
      )
    );
  };

  // Delete message
  const handleDeleteMessage = (msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    toast.info('Message deleted');
  };

  // Copy message
  const handleCopyMessage = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied message to clipboard');
  };

  // Pin memory manually
  const handleAddMemory = async () => {
    if (!newMemoryText.trim()) return;
    const newMem: Memory = {
      id: 'mem-' + Date.now(),
      chat_id: chatId,
      user_id: 'user',
      content: newMemoryText.trim(),
      kind: 'fact',
      entities: [],
      importance: 8,
      pinned: true,
      source_message_ids: [],
      superseded_by: null,
      access_count: 0,
      last_accessed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setMemories((prev) => [newMem, ...prev]);
    setNewMemoryText('');

    await supabase.from('memories').insert({
      chat_id: chatId,
      content: newMem.content,
      kind: 'fact',
      importance: 8,
      pinned: true,
    });

    toast.success('Pinned to roleplay memory');
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

                      {/* Narrative Bubble */}
                      <div className="p-4 sm:p-5 rounded-2xl rounded-tl-sm glass-card text-xs sm:text-sm text-foreground/95 leading-relaxed roleplay-prose shadow-xs border border-black/[0.05] dark:border-white/[0.07] select-text">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {formattedContent}
                        </ReactMarkdown>

                        {message.status === 'streaming' && (
                          <span className="inline-block w-1.5 h-4 ml-1 bg-accent animate-pulse align-middle" />
                        )}
                      </div>

                      {/* Action Bar (Copy, Delete, Reroll) */}
                      <div className="flex items-center gap-1 px-1 pt-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopyMessage(formattedContent)}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1 transition-colors"
                          title="Copy message"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        {index > 0 && (
                          <button
                            onClick={() => handleDeleteMessage(message.id)}
                            className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 text-[11px] flex items-center gap-1 transition-colors"
                            title="Delete message"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
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

                      {/* User Message Card */}
                      <div className="p-3.5 sm:p-4 rounded-2xl rounded-tr-sm bg-accent text-white text-xs sm:text-sm leading-relaxed shadow-sm select-text">
                        <p className="whitespace-pre-wrap">{formattedContent}</p>
                      </div>

                      <div className="flex justify-end px-1 pt-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleCopyMessage(formattedContent)}
                          className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] transition-colors"
                          title="Copy"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Slide-over Memory & Lore Inspector */}
        {inspectorOpen && (
          <aside className="w-full sm:w-80 border-l border-black/[0.06] dark:border-white/[0.08] glass-panel p-5 space-y-5 overflow-y-auto shrink-0 z-30 absolute sm:relative inset-0 sm:inset-auto">
            <div className="flex items-center justify-between pb-2 border-b border-black/[0.06] dark:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-bold tracking-tight">Story Memory & Facts</h3>
              </div>
              <button
                onClick={() => setInspectorOpen(false)}
                className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Persona playing info in inspector */}
            <div className="p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] space-y-1.5">
              <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                Current Persona
              </span>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0 border border-white/10">
                  <CharacterAvatar
                    name={activePersona?.name || 'User'}
                    avatarUrl={activePersona?.avatar_url}
                    className="w-full h-full"
                  />
                </div>
                <div>
                  <h4 className="text-xs font-semibold">{activePersona?.name}</h4>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                    {activePersona?.description || 'Standard companion'}
                  </p>
                </div>
              </div>
            </div>

            {/* Extracted Facts & Long-term Memories */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Pinned Facts ({memories.length})
                </h4>
              </div>

              {/* Add Custom Fact */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Pin a memory..."
                  value={newMemoryText}
                  onChange={(e) => setNewMemoryText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={handleAddMemory}
                  className="px-2.5 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold apple-button"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {memories.map((m) => (
                  <div
                    key={m.id}
                    className="p-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.06] text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/10 text-accent font-semibold uppercase">
                        {m.kind}
                      </span>
                    </div>
                    <p className="text-muted-foreground text-[11px] leading-relaxed">{m.content}</p>
                  </div>
                ))}

                {memories.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No memories recorded yet. DeepSeek will auto-record durable facts here as the roleplay progresses.
                  </p>
                )}
              </div>
            </div>

            {/* Author's Note Toggle */}
            <div className="space-y-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.08]">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Author's Steering Note
                </h4>
                <button
                  onClick={() => setShowAuthorsNote(!showAuthorsNote)}
                  className="text-xs text-accent hover:underline"
                >
                  {showAuthorsNote ? 'Hide' : 'Configure'}
                </button>
              </div>
              {showAuthorsNote && (
                <textarea
                  value={authorsNote}
                  onChange={(e) => setAuthorsNote(e.target.value)}
                  placeholder="Direct the scene (e.g. Focus on intimate tension, rain against the window)..."
                  className="w-full p-2.5 rounded-xl bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs resize-none h-20 focus:outline-none focus:ring-1 focus:ring-accent leading-relaxed"
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Mobile-First Reachable Bottom Input Composer */}
      <footer className="p-2 sm:p-4 border-t border-black/[0.06] dark:border-white/[0.08] glass-panel shrink-0 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Quick Action Chips (Horizontally Scrollable) */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px] px-0.5">
            <button
              onClick={() => handleSendMessage('*Continues the scene*')}
              disabled={isGenerating}
              className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors touch-manipulation"
            >
              Continue Scene
            </button>
            <button
              onClick={() => handleSendMessage('*Waits in silence, observing your expression*')}
              disabled={isGenerating}
              className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors touch-manipulation"
            >
              Wait in silence
            </button>
            <button
              onClick={() => setShowAuthorsNote(!showAuthorsNote)}
              className={`px-3 py-1 rounded-full font-medium whitespace-nowrap transition-colors touch-manipulation ${
                authorsNote
                  ? 'bg-accent/15 text-accent font-semibold'
                  : 'bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground hover:text-foreground'
              }`}
            >
              {authorsNote ? "Author's Note Active" : "+ Author's Note"}
            </button>
          </div>

          {/* Author's Note Quick Drawer */}
          {showAuthorsNote && (
            <div className="p-2 rounded-2xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.08] space-y-1">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Steering directive injected at end of prompt:</span>
                <button onClick={() => setShowAuthorsNote(false)} className="hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={authorsNote}
                onChange={(e) => setAuthorsNote(e.target.value)}
                placeholder="e.g. Focus on dramatic conflict, sensory descriptions..."
                className="w-full px-3 py-1.5 rounded-xl bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs focus:outline-none focus:ring-1 focus:ring-accent"
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
    </div>
  );
}
