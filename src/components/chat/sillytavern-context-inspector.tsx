'use client';

import React, { useState } from 'react';
import {
  Brain,
  X,
  FileText,
  Bookmark,
  BookOpen,
  Sparkles,
  Lock,
  Unlock,
  Save,
  Check,
  SlidersHorizontal,
  Plus,
  Pin,
  PinOff,
  Trash2,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Summary, Character, Persona, Message, Memory } from '@/lib/supabase/types';
import type { LocalAuthorsNote } from '@/lib/chats/chat-manager';

const MEMORY_KIND_LABELS: Record<string, string> = {
  fact: 'Fact',
  event: 'Event',
  preference: 'Preference',
  relationship: 'Relationship',
  promise: 'Promise',
  secret: 'Secret',
  trait: 'Trait',
};

export interface SillyTavernInspectorProps {
  open: boolean;
  onClose: () => void;
  chatId: string;
  character: Character;
  activePersona?: Persona | null;
  history: Message[];
  summary: Summary | null;
  onSummaryUpdated: (newSummary: Summary | null) => void;
  authorsNote: LocalAuthorsNote;
  onAuthorsNoteUpdated: (note: LocalAuthorsNote) => void;
  activeLorebookEntries?: Array<{ id: string; title: string; keys: string[]; content: string }>;
  vectorMemories?: Array<{ content: string; score?: number }>;
  /** The chat's full memory bank, for the writer to inspect and extend. */
  memories?: Memory[];
  onMemoriesChanged?: (memories: Memory[]) => void;
}

export function SillyTavernContextInspector({
  open,
  onClose,
  chatId,
  character,
  activePersona,
  history,
  summary,
  onSummaryUpdated,
  authorsNote,
  onAuthorsNoteUpdated,
  activeLorebookEntries = [],
  vectorMemories = [],
  memories = [],
  onMemoriesChanged,
}: SillyTavernInspectorProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'memory' | 'note' | 'worldInfo' | 'vectors'>('summary');

  // Summary State
  const [summaryText, setSummaryText] = useState(summary?.content || '');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [isFrozen, setIsFrozen] = useState(summary?.user_edited || false);
  const [showSummarySettings, setShowSummarySettings] = useState(false);
  const [summaryInterval, setSummaryInterval] = useState(10);
  const [summaryMaxWords, setSummaryMaxWords] = useState(200);

  // Author's Note Local State
  const [notePrompt, setNotePrompt] = useState(authorsNote.prompt || '');
  const [noteDepth, setNoteDepth] = useState(authorsNote.depth ?? 4);
  const [noteInterval, setNoteInterval] = useState(authorsNote.interval ?? 1);
  const [noteRole, setNoteRole] = useState(authorsNote.role || 'system');
  const [notePosition, setNotePosition] = useState(authorsNote.position || 'in_chat');

  // Memory State
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [newMemoryKind, setNewMemoryKind] = useState<string>('fact');
  const [newMemoryImportance, setNewMemoryImportance] = useState(8);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryText, setEditingMemoryText] = useState('');

  // Sync state if props change
  React.useEffect(() => {
    const content = summary?.content;
    if (content === undefined) return;
    const t = setTimeout(() => setSummaryText(content), 0);
    return () => clearTimeout(t);
  }, [summary]);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setNotePrompt(authorsNote.prompt || '');
      setNoteDepth(authorsNote.depth ?? 4);
      setNoteInterval(authorsNote.interval ?? 1);
      setNoteRole(authorsNote.role || 'system');
      setNotePosition(authorsNote.position || 'in_chat');
    }, 0);
    return () => clearTimeout(t);
  }, [authorsNote]);

  // Handle Save Edited Summary
  const handleSaveSummaryEdit = async () => {
    setIsSavingSummary(true);
    try {
      const res = await fetch('/api/chat/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_summary',
          chatId,
          content: summaryText,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update summary');

      onSummaryUpdated(data.summary);
      setIsFrozen(true);
      toast.success('Summary updated & locked against auto-overwrite');
    } catch (e) {
      toast.error((e instanceof Error ? e.message : '') || 'Could not save summary');
    } finally {
      setIsSavingSummary(false);
    }
  };

  // Handle On-Demand Manual Summarization (full memory pass: summary + facts + state)
  const handleTriggerSummarizeNow = async () => {
    if (history.length < 2) {
      toast.info('Need at least 2 messages in chat to create a story summary');
      return;
    }

    setIsSummarizing(true);
    try {
      const res = await fetch('/api/chat/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'regenerate',
          chatId,
          charName: character.name,
          userName: activePersona?.name || 'User',
          history,
          summaryWords: summaryMaxWords,
          frozen: false,
          force: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Summarization failed');

      if (data.summary) {
        onSummaryUpdated(data.summary);
        setSummaryText(data.summary.content);
        if (Array.isArray(data.memories) && onMemoriesChanged) onMemoriesChanged(data.memories);
        toast.success('Memory regenerated — summary, facts and scene state are current');
      } else {
        toast.info('No new events to summarize yet');
      }
    } catch (e) {
      toast.error((e instanceof Error ? e.message : '') || 'Summarization error');
    } finally {
      setIsSummarizing(false);
    }
  };

  // ── Memory CRUD ────────────────────────────────────────────────────────────
  const settingsTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSaveMemorySettings = (patch: Record<string, unknown>) => {
    if (settingsTimer.current) clearTimeout(settingsTimer.current);
    settingsTimer.current = setTimeout(() => {
      fetch('/api/chat/memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId, action: 'save_settings', ...patch }),
      }).catch(() => {});
    }, 600);
  };

  const memoryRequest = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/chat/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, ...payload }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Memory update failed');
    return data;
  };

  const handleAddMemory = async () => {
    const content = newMemoryText.trim();
    if (!content || isAddingMemory) return;
    setIsAddingMemory(true);
    try {
      const data = await memoryRequest({
        action: 'add_memory',
        content,
        kind: newMemoryKind,
        importance: newMemoryImportance,
        pinned: true,
      });
      if (onMemoriesChanged) onMemoriesChanged([data.memory, ...memories]);
      setNewMemoryText('');
      toast.success('Memory added — it will always be held in mind');
    } catch (e) {
      toast.error((e instanceof Error ? e.message : '') || 'Could not add memory');
    } finally {
      setIsAddingMemory(false);
    }
  };

  const handleUpdateMemory = async (id: string, patch: Record<string, unknown>) => {
    try {
      const data = await memoryRequest({ action: 'update_memory', id, ...patch });
      if (onMemoriesChanged) {
        onMemoriesChanged(memories.map((m) => (m.id === id ? { ...m, ...(data.memory || patch) } : m)));
      }
    } catch (e) {
      toast.error((e instanceof Error ? e.message : '') || 'Could not update memory');
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await memoryRequest({ action: 'delete_memory', id });
      if (onMemoriesChanged) onMemoriesChanged(memories.filter((m) => m.id !== id));
      toast.success('Memory forgotten');
    } catch (e) {
      toast.error((e instanceof Error ? e.message : '') || 'Could not delete memory');
    }
  };

  const handleRegenerateMemory = async () => {
    if (history.length < 2) {
      toast.info('Need at least 2 messages before memory can be regenerated');
      return;
    }
    setIsRegenerating(true);
    try {
      const data = await memoryRequest({
        action: 'regenerate',
        charName: character.name,
        userName: activePersona?.name || 'User',
        history,
        force: true,
      });
      if (Array.isArray(data.memories) && onMemoriesChanged) onMemoriesChanged(data.memories);
      if (data.summary) {
        onSummaryUpdated(data.summary);
        setSummaryText(data.summary.content);
      }
      toast.success(data.passRan ? 'Memory regenerated' : 'Nothing new to fold in yet');
    } catch (e) {
      toast.error((e instanceof Error ? e.message : '') || 'Memory regeneration failed');
    } finally {
      setIsRegenerating(false);
    }
  };

  // Handle Save Author's Note
  const handleSaveAuthorsNote = () => {
    const updated: LocalAuthorsNote = {
      prompt: notePrompt,
      depth: noteDepth,
      interval: noteInterval,
      role: noteRole as 'system' | 'user' | 'assistant',
      position: notePosition as 'in_chat' | 'before_scenario' | 'after_scenario',
    };
    onAuthorsNoteUpdated(updated);
    toast.success("Author's note updated");
  };

  if (!open) return null;

  const tabButtonClass = (tab: typeof activeTab) =>
    `relative flex shrink-0 min-h-[44px] sm:min-h-[36px] items-center gap-1.5 whitespace-nowrap px-3 py-2 font-medium transition-colors ${
      activeTab === tab ? 'text-ink' : 'text-ink-2 hover:text-ink'
    }`;

  const tabUnderline = (tab: typeof activeTab) =>
    activeTab === tab ? (
      <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
    ) : null;

  return (
    <aside className="animate-in fade-in slide-in-from-right-2 fixed inset-0 z-30 flex h-full w-full shrink-0 flex-col border-l border-line bg-background pt-safe pl-safe pr-safe duration-150 ease-out sm:relative sm:inset-auto sm:w-96 sm:pl-0 sm:pr-0">
      {/* Header — sticky on mobile and desktop */}
      <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-line bg-background px-4 py-3 sm:p-4">
        <div className="flex items-center gap-2">
          <Brain aria-hidden="true" className="h-4 w-4 text-ink-3" />
          <h3 className="type-sec">SillyTavern memory</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close memory panel"
          className="icon-btn min-h-11 min-w-11 sm:h-9 sm:w-9"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs — horizontally scrollable one-line bar */}
      <div
        className="scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-2 text-xs"
        role="tablist"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'summary'}
          onClick={() => setActiveTab('summary')}
          className={tabButtonClass('summary')}
        >
          <FileText aria-hidden="true" className="h-3.5 w-3.5" />
          Chat summary
          {tabUnderline('summary')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'memory'}
          onClick={() => setActiveTab('memory')}
          className={tabButtonClass('memory')}
        >
          <Brain aria-hidden="true" className="h-3.5 w-3.5" />
          Memory
          {memories.length > 0 && <span className="type-code text-ink-3 tabular-nums">{memories.length}</span>}
          {tabUnderline('memory')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'note'}
          onClick={() => setActiveTab('note')}
          className={tabButtonClass('note')}
        >
          <Bookmark aria-hidden="true" className="h-3.5 w-3.5" />
          Author&apos;s note
          {tabUnderline('note')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'worldInfo'}
          onClick={() => setActiveTab('worldInfo')}
          className={tabButtonClass('worldInfo')}
        >
          <BookOpen aria-hidden="true" className="h-3.5 w-3.5" />
          World info
          {tabUnderline('worldInfo')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'vectors'}
          onClick={() => setActiveTab('vectors')}
          className={tabButtonClass('vectors')}
        >
          <Brain aria-hidden="true" className="h-3.5 w-3.5" />
          Vectors
          {tabUnderline('vectors')}
        </button>
      </div>

      {/* Body Content — iOS momentum inner scroll */}
      <div className="scroll-y flex-1 min-h-0 space-y-4 p-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:pb-6">
        {/* TAB 1: CHAT SUMMARY */}
        {activeTab === 'summary' && (
          <div className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="type-label">
                Active story summary
              </span>
              <button
                type="button"
                onClick={() => setIsFrozen(!isFrozen)}
                aria-pressed={isFrozen}
                className={`chip min-h-11 sm:min-h-8 px-3 ${isFrozen ? 'chip-warn' : ''}`}
                title="When frozen, automatic summarization will not overwrite your text"
              >
                {isFrozen ? <Lock aria-hidden="true" className="h-3.5 w-3.5" /> : <Unlock aria-hidden="true" className="h-3.5 w-3.5" />}
                {isFrozen ? 'Frozen' : 'Unfrozen'}
              </button>
            </div>

            <textarea
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
              aria-label="Story summary"
              placeholder="No active summary yet, e.g. the party entered the lower vaults…"
              rows={8}
              className="field resize-y text-xs leading-relaxed"
            />

            {/* Actions Bar */}
            <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleSaveSummaryEdit}
                disabled={isSavingSummary || !summaryText.trim()}
                className="btn btn-ghost min-h-11 sm:min-h-9 px-4 text-xs"
              >
                <Save aria-hidden="true" className="h-3.5 w-3.5" />
                {isSavingSummary ? 'Saving…' : 'Save edit'}
              </button>

              <button
                type="button"
                onClick={handleTriggerSummarizeNow}
                disabled={isSummarizing}
                className="btn btn-primary min-h-11 sm:min-h-9 px-4 text-xs"
              >
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                {isSummarizing ? 'Summarizing…' : 'Summarize now'}
              </button>
            </div>

            {/* Summary Configuration Drawer */}
            <div className="space-y-3 border-t border-line pt-3">
              <button
                type="button"
                onClick={() => setShowSummarySettings(!showSummarySettings)}
                aria-expanded={showSummarySettings}
                className="row-press flex min-h-11 w-full items-center justify-between rounded-md px-2 text-xs font-medium text-ink-2 transition-colors hover:text-ink"
              >
                <span className="flex items-center gap-2">
                  <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                  Summarizer settings
                </span>
                <span aria-hidden="true">{showSummarySettings ? '▲' : '▼'}</span>
              </button>

              {showSummarySettings && (
                <div className="well space-y-3 p-3.5 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex flex-col sm:flex-row sm:justify-between text-[11px] text-ink-2 tabular-nums">
                      <span>Update interval</span>
                      <span className="type-code">Every {summaryInterval} turns</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="30"
                      step="1"
                      value={summaryInterval}
                      aria-label="Summary update interval in turns"
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setSummaryInterval(value);
                        scheduleSaveMemorySettings({ summaryInterval: value });
                      }}
                      className="min-h-8 w-full accent-accent"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-col sm:flex-row sm:justify-between text-[11px] text-ink-2 tabular-nums">
                      <span>Max target words</span>
                      <span className="type-code">{summaryMaxWords} words</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="500"
                      step="25"
                      value={summaryMaxWords}
                      aria-label="Summary maximum words"
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setSummaryMaxWords(value);
                        scheduleSaveMemorySettings({ summaryWords: value });
                      }}
                      className="min-h-8 w-full accent-accent"
                    />
                  </div>

                  <div className="text-[10px] leading-relaxed text-ink-3">
                    Every N messages the memory pass folds the new exchanges into the story summary, the fact
                    bank and the scene state — all at once. The summary is injected at in-chat depth 2, formatted
                    as <code className="type-code text-accent-text">[Summary: …]</code>.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: MEMORY */}
        {activeTab === 'memory' && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <span className="type-label">Story memory</span>
                <p className="type-meta mt-0.5">
                  Written automatically as the story grows. Add your own — pinned memories are always
                  held in mind and never rewritten by the automatic pass.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRegenerateMemory}
                disabled={isRegenerating}
                className="btn btn-ghost shrink-0 min-h-11 sm:min-h-9 px-3.5 text-xs w-full sm:w-auto"
                title="Fold the latest exchanges into memory now"
              >
                <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                {isRegenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
            </div>

            {/* Add a memory */}
            <div className="surface space-y-3 rounded-lg p-3 sm:p-3.5">
              <label className="type-label" htmlFor="new-memory-text">
                Add a memory
              </label>
              <textarea
                id="new-memory-text"
                value={newMemoryText}
                onChange={(e) => setNewMemoryText(e.target.value)}
                placeholder="e.g. {{char}} carries her mother's signet ring and never takes it off."
                rows={3}
                className="field resize-y text-xs leading-relaxed"
              />
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <label className="sr-only" htmlFor="new-memory-kind">Memory kind</label>
                <select
                  id="new-memory-kind"
                  value={newMemoryKind}
                  onChange={(e) => setNewMemoryKind(e.target.value)}
                  className="field min-h-11 sm:min-h-9 text-xs flex-1"
                >
                  {Object.entries(MEMORY_KIND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>

                <div className="flex items-center gap-2">
                  <label className="type-label shrink-0" htmlFor="new-memory-importance">Importance</label>
                  <input
                    id="new-memory-importance"
                    type="range"
                    min="1"
                    max="10"
                    value={newMemoryImportance}
                    onChange={(e) => setNewMemoryImportance(Number(e.target.value))}
                    className="min-h-8 w-24 accent-accent"
                  />
                  <span className="type-code text-ink-3 tabular-nums">{newMemoryImportance}</span>
                </div>

                <button
                  type="button"
                  onClick={handleAddMemory}
                  disabled={!newMemoryText.trim() || isAddingMemory}
                  className="btn btn-primary min-h-11 sm:min-h-9 px-4 text-xs w-full sm:w-auto sm:ml-auto"
                >
                  <Plus aria-hidden="true" className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>

            {/* Memory bank */}
            <div className="space-y-2.5">
              {memories.length > 0 ? (
                memories.map((memory) => (
                  <div key={memory.id} className="surface space-y-2 rounded-lg p-3 sm:p-3.5 text-xs">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="chip type-code">{MEMORY_KIND_LABELS[memory.kind] || memory.kind}</span>
                        <span className="chip type-code tabular-nums" title="Importance">★ {memory.importance}</span>
                        {memory.pinned && (
                          <span className="chip chip-warn" title="Always in context, never auto-rewritten">
                            <Pin aria-hidden="true" className="h-3 w-3" /> Pinned
                          </span>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center justify-end gap-1 border-t border-line pt-1.5 sm:border-t-0 sm:pt-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMemoryId(memory.id);
                            setEditingMemoryText(memory.content);
                          }}
                          aria-label="Edit memory"
                          className="icon-btn min-h-11 min-w-11 sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
                        >
                          <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUpdateMemory(memory.id, { pinned: !memory.pinned })}
                          aria-label={memory.pinned ? 'Unpin memory' : 'Pin memory'}
                          className="icon-btn min-h-11 min-w-11 sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
                        >
                          {memory.pinned ? <PinOff aria-hidden="true" className="h-3.5 w-3.5" /> : <Pin aria-hidden="true" className="h-3.5 w-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteMemory(memory.id)}
                          aria-label="Forget memory"
                          className="icon-btn text-danger min-h-11 min-w-11 sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
                        >
                          <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    {editingMemoryId === memory.id ? (
                      <div className="space-y-2.5 pt-1">
                        <textarea
                          value={editingMemoryText}
                          onChange={(e) => setEditingMemoryText(e.target.value)}
                          aria-label="Edit memory text"
                          rows={3}
                          className="field resize-y text-xs leading-relaxed"
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingMemoryId(null)}
                            className="btn btn-ghost min-h-11 sm:min-h-9 px-3.5 text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await handleUpdateMemory(memory.id, { content: editingMemoryText.trim() });
                              setEditingMemoryId(null);
                              toast.success('Memory updated');
                            }}
                            disabled={!editingMemoryText.trim()}
                            className="btn btn-primary min-h-11 sm:min-h-9 px-3.5 text-xs"
                          >
                            <Check aria-hidden="true" className="h-3.5 w-3.5" />
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="break-words text-[11px] leading-relaxed text-ink-2">{memory.content}</p>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
                  <Brain aria-hidden="true" className="mb-1 h-6 w-6 text-ink-3" />
                  <p className="type-sec">No memories yet</p>
                  <p className="type-meta">
                    The story starts remembering on its own once events, promises and secrets appear.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: AUTHOR'S NOTE */}
        {activeTab === 'note' && (
          <div className="space-y-4">
            <div>
              <span className="type-label">
                Author&apos;s note
              </span>
              <p className="type-meta mt-0.5">
                Steers tone, style, or pacing. Injected into chat history at the depth you set.
              </p>
            </div>

            <textarea
              value={notePrompt}
              onChange={(e) => setNotePrompt(e.target.value)}
              aria-label="Author's note prompt"
              placeholder="E.g. focus on subtle body language and slow pacing…"
              rows={4}
              className="field resize-y text-xs leading-relaxed"
            />

            <div className="well space-y-3 p-3.5 text-xs">
              <div className="space-y-1.5">
                <div className="flex flex-col sm:flex-row sm:justify-between text-[11px] text-ink-2 tabular-nums">
                  <span>Insertion depth</span>
                  <span className="type-code">{noteDepth} messages from end</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={noteDepth}
                  aria-label="Author's note insertion depth"
                  onChange={(e) => setNoteDepth(Number(e.target.value))}
                  className="min-h-8 w-full accent-accent"
                />
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs">
                <div className="space-y-1">
                  <label className="type-label" htmlFor="authors-note-role">Role</label>
                  <select
                    id="authors-note-role"
                    value={noteRole}
                    onChange={(e) => setNoteRole(e.target.value as 'system' | 'user' | 'assistant')}
                    className="field min-h-11 sm:min-h-9 text-xs"
                  >
                    <option value="system">System</option>
                    <option value="user">User</option>
                    <option value="assistant">Assistant</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="type-label" htmlFor="authors-note-position">Position</label>
                  <select
                    id="authors-note-position"
                    value={notePosition}
                    onChange={(e) => setNotePosition(e.target.value as 'in_chat' | 'before_scenario' | 'after_scenario')}
                    className="field min-h-11 sm:min-h-9 text-xs"
                  >
                    <option value="in_chat">In-chat depth</option>
                    <option value="before_scenario">Before scenario</option>
                    <option value="after_scenario">After scenario</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSaveAuthorsNote}
              className="btn btn-primary min-h-11 sm:min-h-9 w-full text-xs"
            >
              <Check aria-hidden="true" className="h-3.5 w-3.5" />
              Apply author&apos;s note
            </button>
          </div>
        )}

        {/* TAB 4: WORLD INFO / LOREBOOK */}
        {activeTab === 'worldInfo' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="type-label">
                World info ({activeLorebookEntries.length})
              </span>
            </div>

            <div className="space-y-2.5">
              {activeLorebookEntries.length > 0 ? (
                activeLorebookEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="surface space-y-1.5 rounded-lg p-3 sm:p-3.5 text-xs"
                  >
                    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0 break-words text-xs font-medium text-ink">{entry.title || 'Untitled entry'}</span>
                      <div className="flex shrink-0 flex-wrap gap-1">
                        {entry.keys.map((k) => (
                          <span
                            key={k}
                            className="chip type-code"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="line-clamp-3 break-words text-[11px] leading-relaxed text-ink-2">
                      {entry.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
                  <BookOpen aria-hidden="true" className="mb-1 h-6 w-6 text-ink-3" />
                  <p className="type-sec">No lorebook entries triggered</p>
                  <p className="type-meta">
                    Entries appear here when their keywords show up in recent messages.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: VECTORS */}
        {activeTab === 'vectors' && (
          <div className="space-y-4">
            <div>
              <span className="type-label">
                Vector memories
              </span>
              <p className="type-meta mt-0.5">
                Past events recalled from outside the short-term window.
              </p>
            </div>

            <div className="space-y-2.5">
              {vectorMemories.length > 0 ? (
                vectorMemories.map((vm, i) => (
                  <div
                    key={i}
                    className="surface space-y-1.5 rounded-lg p-3 sm:p-3.5 text-xs"
                  >
                    {vm.score !== undefined && (
                      <span className="chip type-code tabular-nums">
                        Score: {(vm.score * 100).toFixed(0)}%
                      </span>
                    )}
                    <p className="break-words text-[11px] leading-relaxed text-ink-2">
                      {vm.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
                  <Brain aria-hidden="true" className="mb-1 h-6 w-6 text-ink-3" />
                  <p className="type-sec">No vector recalls yet</p>
                  <p className="type-meta">
                    Recalled events appear here once the conversation grows past the short-term window.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
