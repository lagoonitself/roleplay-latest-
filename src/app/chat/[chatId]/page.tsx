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
  MoreVertical,
  Maximize2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { DEFAULT_CHARACTERS } from '@/lib/data/default-characters';
import { toast } from 'sonner';
import type { Character, Message, Memory, ChatState, Summary } from '@/lib/supabase/types';

export default function ChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const chatId = params?.chatId as string;
  const charIdParam = searchParams.get('charId');

  const [settings] = useSettings();
  const supabase = createClient();

  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Memory & Inspector Panel
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [chatState, setChatState] = useState<ChatState['state']>({});
  const [summary, setSummary] = useState<string>('');
  const [newMemoryText, setNewMemoryText] = useState('');

  // Editing in-place
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Author's note
  const [authorsNote, setAuthorsNote] = useState('');
  const [showAuthorsNote, setShowAuthorsNote] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 1. Load Character, Messages, State
  useEffect(() => {
    async function initChat() {
      // Find character
      let charObj: Character | null = null;
      if (chatId.startsWith('local-') || charIdParam) {
        const found = DEFAULT_CHARACTERS.find((c) => c.name === charIdParam) || DEFAULT_CHARACTERS[0];
        charObj = {
          id: `seed-${found.name.toLowerCase().replace(/\s+/g, '-')}`,
          user_id: 'local',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...found,
        };
      } else {
        // Fetch from Supabase
        const { data: chatData } = await supabase
          .from('chats')
          .select('*, character:characters(*)')
          .eq('id', chatId)
          .maybeSingle();

        if (chatData?.character) {
          charObj = chatData.character as Character;
        } else {
          charObj = {
            id: 'seed-0',
            user_id: 'default',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...DEFAULT_CHARACTERS[0],
          };
        }

        // Fetch messages for this chat
        const { data: msgsData } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true });

        if (msgsData && msgsData.length > 0) {
          setMessages(msgsData as Message[]);
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

      setCharacter(charObj);

      // If no messages yet, seed the character's first_message
      if (charObj && messages.length === 0) {
        const initialMsg: Message = {
          id: 'msg-greeting',
          chat_id: chatId,
          user_id: 'system',
          parent_id: null,
          role: 'assistant',
          content: charObj.first_message,
          reasoning: null,
          status: 'done',
          meta: {
            swipes: [charObj.first_message, ...(charObj.alternate_greetings || [])],
            active_swipe_index: 0,
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setMessages([initialMsg]);
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
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
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
      meta: {},
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
          personaId: settings.activePersonaId,
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
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            content: streamedContent,
                            meta: {
                              ...m.meta,
                              swipes: [streamedContent],
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
          m.id === assistantMsgId ? { ...m, status: 'done' } : m
        )
      );

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
            m.id === assistantMsgId ? { ...m, status: 'error', content: m.content || '*[Connection interrupted]*' } : m
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
      toast.info('Generation stopped');
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

  // Rewind / Delete message
  const handleDeleteMessage = (msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    toast.info('Message removed');
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

    toast.success('Pinned to long-term memory');
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100dvh-3.5rem)] overflow-hidden bg-background">
      {/* Top Chat Sub-Header */}
      <div className="h-14 px-4 sm:px-6 border-b border-black/[0.06] dark:border-white/[0.08] glass-panel flex items-center justify-between shrink-0 z-20">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>

          {/* Character info */}
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full overflow-hidden bg-black/10 shrink-0 border border-white/20 shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={character?.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80'}
                alt={character?.name || 'Character'}
                className="w-full h-full object-cover"
              />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tracking-tight">{character?.name}</span>
                {character?.content_rating !== 'sfw' && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-500/15 text-red-500 font-bold">
                    18+
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate max-w-xs sm:max-w-md">
                {character?.tagline}
              </p>
            </div>
          </div>
        </div>

        {/* Right tools */}
        <div className="flex items-center gap-2">
          {/* Memory Inspector Button */}
          <button
            onClick={() => setInspectorOpen(!inspectorOpen)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium apple-button flex items-center gap-1.5 border transition-all ${
              inspectorOpen
                ? 'bg-accent/15 border-accent text-accent'
                : 'border-black/[0.06] dark:border-white/[0.08] hover:bg-black/5 dark:hover:bg-white/5 text-muted-foreground hover:text-foreground'
            }`}
          >
            <Brain className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Memory</span>
            {memories.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-accent text-white text-[10px] flex items-center justify-center font-bold">
                {memories.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main Chat Body (with Collapsible Inspector) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Messages Stream Timeline */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
          <div className="max-w-3xl mx-auto space-y-6 pb-6">
            {messages.map((message, index) => {
              const isAssistant = message.role === 'assistant';
              const swipes = message.meta?.swipes || [message.content];
              const swipeIndex = message.meta?.active_swipe_index ?? 0;

              return (
                <div
                  key={message.id || index}
                  className={`flex flex-col group ${isAssistant ? 'items-start' : 'items-end'}`}
                >
                  {isAssistant ? (
                    /* Assistant Roleplay Message */
                    <div className="flex items-start gap-3.5 w-full">
                      <div className="w-9 h-9 rounded-2xl overflow-hidden bg-black/10 shrink-0 border border-white/10 shadow-xs mt-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={character?.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80'}
                          alt={character?.name || 'Character'}
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold tracking-tight text-foreground/90">
                            {character?.name}
                          </span>

                          {/* Swipes controls if multiple alternatives exist */}
                          {swipes.length > 1 && (
                            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-[11px] text-muted-foreground">
                              <button
                                onClick={() => handleSwipe(index, 'prev')}
                                disabled={swipeIndex === 0}
                                className="disabled:opacity-30 hover:text-foreground"
                              >
                                <ChevronLeft className="w-3 h-3" />
                              </button>
                              <span>
                                {swipeIndex + 1}/{swipes.length}
                              </span>
                              <button
                                onClick={() => handleSwipe(index, 'next')}
                                disabled={swipeIndex === swipes.length - 1}
                                className="disabled:opacity-30 hover:text-foreground"
                              >
                                <ChevronRight className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Content text */}
                        <div className="p-4 sm:p-5 rounded-3xl rounded-tl-sm glass-card text-xs sm:text-sm text-foreground/95 leading-relaxed roleplay-prose shadow-xs">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>

                          {message.status === 'streaming' && (
                            <span className="streaming-cursor" />
                          )}
                        </div>

                        {/* Actions bar on hover */}
                        <div className="flex items-center gap-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-xs pl-1">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(message.content);
                              toast.success('Copied to clipboard');
                            }}
                            className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                            title="Copy message"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteMessage(message.id)}
                            className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-red-500/80 hover:text-red-500"
                            title="Delete message"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* User Message */
                    <div className="max-w-[85%] sm:max-w-xl space-y-1">
                      <div className="px-4 py-3 rounded-3xl rounded-tr-sm bg-accent text-white text-xs sm:text-sm shadow-sm leading-relaxed roleplay-prose">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs pr-1 text-muted-foreground">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(message.content);
                            toast.success('Copied');
                          }}
                          className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteMessage(message.id)}
                          className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Collapsible Memory & Scene State Inspector */}
        {inspectorOpen && (
          <aside className="w-80 sm:w-96 border-l border-black/[0.06] dark:border-white/[0.08] glass-panel p-5 overflow-y-auto space-y-6 animate-in slide-in-from-right-8 duration-200">
            <div className="flex items-center justify-between pb-3 border-b border-black/[0.06] dark:border-white/[0.08]">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold tracking-tight">Active Context & Memory</h3>
              </div>
              <button
                onClick={() => setInspectorOpen(false)}
                className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scene State Tracker */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Scene State
              </h4>
              <div className="p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span className="font-medium">{chatState.location || 'Default setting'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mood</span>
                  <span className="font-medium">{chatState.char_mood || 'Attentive'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Relationship</span>
                  <span className="font-medium text-accent">
                    {chatState.affection_level || 'Neutral'} ({chatState.relationship_score ?? 0})
                  </span>
                </div>

                {/* Relationship Bar */}
                <div className="w-full bg-black/10 dark:bg-white/10 h-1.5 rounded-full overflow-hidden mt-1">
                  <div
                    className="bg-accent h-full transition-all duration-500 rounded-full"
                    style={{
                      width: `${Math.max(5, Math.min(100, ((chatState.relationship_score ?? 0) + 100) / 2))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Extracted Facts & Long-term Memories */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Durable Facts ({memories.length})
                </h4>
              </div>

              {/* Add Custom Fact */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Pin a fact (e.g. loves tea)..."
                  value={newMemoryText}
                  onChange={(e) => setNewMemoryText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddMemory()}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs focus:outline-none focus:ring-1 focus:ring-accent"
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
                      <span className="text-[10px] text-muted-foreground">
                        Importance: {m.importance}/10
                      </span>
                    </div>
                    <p className="text-muted-foreground">{m.content}</p>
                  </div>
                ))}

                {memories.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No memories recorded yet. As you chat, DeepSeek will automatically record durable facts here.
                  </p>
                )}
              </div>
            </div>

            {/* Author's Note Toggle in Drawer */}
            <div className="space-y-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.08]">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Author's Steering Note
                </h4>
                <button
                  onClick={() => setShowAuthorsNote(!showAuthorsNote)}
                  className="text-xs text-accent hover:underline"
                >
                  {showAuthorsNote ? 'Hide' : 'Set Note'}
                </button>
              </div>
              {showAuthorsNote && (
                <textarea
                  value={authorsNote}
                  onChange={(e) => setAuthorsNote(e.target.value)}
                  placeholder="Direct the scene (e.g. Focus on atmospheric rain and intimate eye contact)..."
                  className="w-full p-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs resize-none h-20 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {/* Bottom Floating Composer */}
      <div className="p-3 sm:p-5 border-t border-black/[0.06] dark:border-white/[0.08] glass-panel shrink-0">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Quick Steering Helpers */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px]">
            <button
              onClick={() => handleSendMessage('*Continues the scene*')}
              disabled={isGenerating}
              className="px-2.5 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors"
            >
              Continue Scene
            </button>
            <button
              onClick={() => handleSendMessage('*Waits in silence, watching your reaction closely*')}
              disabled={isGenerating}
              className="px-2.5 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors"
            >
              Wait in silence
            </button>
            <button
              onClick={() => setShowAuthorsNote(!showAuthorsNote)}
              className="px-2.5 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors"
            >
              {authorsNote ? "Author's Note active" : "+ Author's Note"}
            </button>
          </div>

          {/* Text Input Row */}
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
              placeholder={`Write your turn... (Shift+Enter for new line)`}
              className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-foreground focus:outline-none resize-none max-h-44 min-h-[38px] leading-relaxed"
            />

            {isGenerating ? (
              <button
                onClick={handleStop}
                className="w-9 h-9 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shrink-0 apple-button shadow-xs"
                title="Stop generation"
              >
                <Square className="w-4 h-4 fill-white" />
              </button>
            ) : (
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim()}
                className="w-9 h-9 rounded-full bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:hover:bg-accent text-white flex items-center justify-center shrink-0 apple-button shadow-xs transition-colors"
                title="Send message"
              >
                <Send className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
