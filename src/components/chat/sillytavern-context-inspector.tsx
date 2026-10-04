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
  Sliders,
  Save,
  RotateCcw,
  Check,
  Eye,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Summary, Character, Persona, Message } from '@/lib/supabase/types';
import type { LocalAuthorsNote } from '@/lib/chats/chat-manager';

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
}: SillyTavernInspectorProps) {
  const [activeTab, setActiveTab] = useState<'summary' | 'note' | 'worldInfo' | 'vectors'>('summary');

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

  // Sync state if props change
  React.useEffect(() => {
    if (summary?.content !== undefined) {
      setSummaryText(summary.content);
    }
  }, [summary]);

  React.useEffect(() => {
    setNotePrompt(authorsNote.prompt || '');
    setNoteDepth(authorsNote.depth ?? 4);
    setNoteInterval(authorsNote.interval ?? 1);
    setNoteRole(authorsNote.role || 'system');
    setNotePosition(authorsNote.position || 'in_chat');
  }, [authorsNote]);

  // Handle Save Edited Summary
  const handleSaveSummaryEdit = async () => {
    setIsSavingSummary(true);
    try {
      const res = await fetch('/api/chat/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_edit',
          chatId,
          content: summaryText,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update summary');

      onSummaryUpdated(data.summary);
      setIsFrozen(true);
      toast.success('Summary updated & locked against auto-overwrite');
    } catch (e: any) {
      toast.error(e.message || 'Could not save summary');
    } finally {
      setIsSavingSummary(false);
    }
  };

  // Handle On-Demand Manual Summarization
  const handleTriggerSummarizeNow = async () => {
    if (history.length < 2) {
      toast.info('Need at least 2 messages in chat to create a story summary');
      return;
    }

    setIsSummarizing(true);
    try {
      const res = await fetch('/api/chat/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          charName: character.name,
          userName: activePersona?.name || 'User',
          promptWords: summaryMaxWords,
          force: true,
          frozen: false,
          history,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Summarization failed');

      if (data.summary) {
        onSummaryUpdated(data.summary);
        setSummaryText(data.summary.content);
        toast.success('Generated fresh chat summary!');
      } else {
        toast.info('No new events to summarize yet');
      }
    } catch (e: any) {
      toast.error(e.message || 'Summarization error');
    } finally {
      setIsSummarizing(false);
    }
  };

  // Handle Save Author's Note
  const handleSaveAuthorsNote = () => {
    const updated: LocalAuthorsNote = {
      prompt: notePrompt,
      depth: noteDepth,
      interval: noteInterval,
      role: noteRole as any,
      position: notePosition as any,
    };
    onAuthorsNoteUpdated(updated);
    toast.success("Author's Note updated");
  };

  if (!open) return null;

  return (
    <aside className="w-full sm:w-96 border-l border-black/[0.06] dark:border-white/[0.08] glass-panel flex flex-col shrink-0 z-30 absolute sm:relative inset-0 sm:inset-auto h-full bg-background/95 backdrop-blur-md animate-in fade-in slide-in-from-right-2 duration-150 ease-out">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-bold tracking-tight">SillyTavern Memory Engine</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-black/[0.06] dark:border-white/[0.08] px-2 py-1 gap-1 text-xs overflow-x-auto scrollbar-none">
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'summary'
              ? 'bg-accent/15 text-accent font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          Chat Summary
        </button>
        <button
          onClick={() => setActiveTab('note')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'note'
              ? 'bg-accent/15 text-accent font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <Bookmark className="w-3.5 h-3.5" />
          Author's Note
        </button>
        <button
          onClick={() => setActiveTab('worldInfo')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'worldInfo'
              ? 'bg-accent/15 text-accent font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          World Info
        </button>
        <button
          onClick={() => setActiveTab('vectors')}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'vectors'
              ? 'bg-accent/15 text-accent font-semibold'
              : 'text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5'
          }`}
        >
          <Brain className="w-3.5 h-3.5" />
          Vectors
        </button>
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* TAB 1: CHAT SUMMARY */}
        {activeTab === 'summary' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                Active Story Summary (Depth 2)
              </span>
              <button
                onClick={() => setIsFrozen(!isFrozen)}
                className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
                  isFrozen
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
                title="When locked/frozen, automated turn summarization will not overwrite your custom text"
              >
                {isFrozen ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                {isFrozen ? 'Frozen' : 'Unfrozen'}
              </button>
            </div>

            <textarea
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
              placeholder="No active summary yet. Summarization triggers automatically every 10 turns, or click 'Summarize Now' below..."
              rows={8}
              className="w-full p-3 rounded-2xl bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            />

            {/* Actions Bar */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                onClick={handleSaveSummaryEdit}
                disabled={isSavingSummary || !summaryText.trim()}
                className="px-3 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold flex items-center gap-1.5 apple-button disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isSavingSummary ? 'Saving...' : 'Save Edit'}
              </button>

              <button
                onClick={handleTriggerSummarizeNow}
                disabled={isSummarizing}
                className="px-3 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-600 text-white text-xs font-semibold flex items-center gap-1.5 apple-button disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {isSummarizing ? 'Generating...' : 'Summarize Now'}
              </button>
            </div>

            {/* Summary Configuration Drawer */}
            <div className="pt-3 border-t border-black/[0.06] dark:border-white/[0.08] space-y-3">
              <button
                onClick={() => setShowSummarySettings(!showSummarySettings)}
                className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground font-medium"
              >
                <span className="flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Summarizer Settings
                </span>
                <span>{showSummarySettings ? '▲' : '▼'}</span>
              </button>

              {showSummarySettings && (
                <div className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.06] space-y-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Update Interval</span>
                      <span>Every {summaryInterval} turns</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="30"
                      step="1"
                      value={summaryInterval}
                      onChange={(e) => setSummaryInterval(Number(e.target.value))}
                      className="w-full accent-accent"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Max Target Words</span>
                      <span>{summaryMaxWords} words</span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="500"
                      step="25"
                      value={summaryMaxWords}
                      onChange={(e) => setSummaryMaxWords(Number(e.target.value))}
                      className="w-full accent-accent"
                    />
                  </div>

                  <div className="text-[10px] text-muted-foreground leading-relaxed">
                    SillyTavern summary engine automatically condenses dialogue turns into a persistent story summary injected at in-chat depth 2 formatted as <code className="bg-black/5 dark:bg-white/10 px-1 py-0.5 rounded">[Summary: ...]</code>.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: AUTHOR'S NOTE */}
        {activeTab === 'note' && (
          <div className="space-y-4">
            <div>
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                Author's Note / Floating Prompt
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Steers tone, style, or pacing. Injected directly into chat history at designated depth.
              </p>
            </div>

            <textarea
              value={notePrompt}
              onChange={(e) => setNotePrompt(e.target.value)}
              placeholder="e.g. Focus on subtle body language, dramatic tension, slow pacing. Mention the pouring rain outside."
              rows={4}
              className="w-full p-3 rounded-2xl bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs leading-relaxed focus:outline-none focus:ring-1 focus:ring-accent resize-y"
            />

            <div className="space-y-3 p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.06] text-xs">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Insertion Depth</span>
                  <span>{noteDepth} messages from end</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="10"
                  value={noteDepth}
                  onChange={(e) => setNoteDepth(Number(e.target.value))}
                  className="w-full accent-accent"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">Role</span>
                  <select
                    value={noteRole}
                    onChange={(e) => setNoteRole(e.target.value as any)}
                    className="w-full p-1.5 rounded-lg bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs"
                  >
                    <option value="system">System</option>
                    <option value="user">User</option>
                    <option value="assistant">Assistant</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-semibold text-muted-foreground">Position</span>
                  <select
                    value={notePosition}
                    onChange={(e) => setNotePosition(e.target.value as any)}
                    className="w-full p-1.5 rounded-lg bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs"
                  >
                    <option value="in_chat">In-Chat Depth</option>
                    <option value="before_scenario">Before Scenario</option>
                    <option value="after_scenario">After Scenario</option>
                  </select>
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveAuthorsNote}
              className="w-full py-2 rounded-xl bg-accent text-white text-xs font-semibold flex items-center justify-center gap-1.5 apple-button"
            >
              <Check className="w-3.5 h-3.5" />
              Apply Author's Note
            </button>
          </div>
        )}

        {/* TAB 3: WORLD INFO / LOREBOOK */}
        {activeTab === 'worldInfo' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                Triggered World Info ({activeLorebookEntries.length})
              </span>
            </div>

            <div className="space-y-2">
              {activeLorebookEntries.length > 0 ? (
                activeLorebookEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.06] text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-accent">{entry.title || 'Untitled Entry'}</span>
                      <div className="flex gap-1">
                        {entry.keys.map((k) => (
                          <span
                            key={k}
                            className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-[9px] font-mono"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                      {entry.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-muted-foreground border border-dashed border-black/[0.08] dark:border-white/[0.1] rounded-2xl space-y-1">
                  <BookOpen className="w-6 h-6 mx-auto opacity-40 text-accent mb-1" />
                  <p className="font-medium">No Lorebook Entries Triggered</p>
                  <p className="text-[11px] opacity-75">
                    Entries trigger automatically when their activation keywords appear in recent messages.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: VECTORS */}
        {activeTab === 'vectors' && (
          <div className="space-y-4">
            <div>
              <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                Vector Memories (Depth 2)
              </span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Past semantic events recalled outside the 5-turn protection window.
              </p>
            </div>

            <div className="space-y-2">
              {vectorMemories.length > 0 ? (
                vectorMemories.map((vm, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-xl bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.04] dark:border-white/[0.06] text-xs space-y-1"
                  >
                    {vm.score !== undefined && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">
                        Score: {(vm.score * 100).toFixed(0)}%
                      </span>
                    )}
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      {vm.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="p-6 text-center text-xs text-muted-foreground border border-dashed border-black/[0.08] dark:border-white/[0.1] rounded-2xl space-y-1">
                  <Brain className="w-6 h-6 mx-auto opacity-40 text-accent mb-1" />
                  <p className="font-medium">No Vector Recalls Active</p>
                  <p className="text-[11px] opacity-75">
                    Semantic events appear here once the conversation grows beyond the short-term window.
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
