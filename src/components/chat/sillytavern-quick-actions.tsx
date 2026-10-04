'use client';

import React, { useState } from 'react';
import {
  Play,
  User,
  Bookmark,
  Brain,
  Sliders,
  Sparkles,
  ChevronDown,
  Check,
  Zap,
} from 'lucide-react';
import {
  SILLY_TAVERN_SYSTEM_PROMPT_PRESETS,
  type SystemPromptPreset,
} from '@/lib/prompt/presets';
import { toast } from 'sonner';

export interface SillyTavernQuickActionsProps {
  onContinue: () => void;
  onImpersonate: () => void;
  isGenerating: boolean;
  authorsNoteActive: boolean;
  onToggleAuthorsNote: () => void;
  thinkingEnabled: boolean;
  onToggleThinking: () => void;
  currentPresetId?: string;
  onSelectPreset: (preset: SystemPromptPreset) => void;
  onOpenRegexManager?: () => void;
  regexActiveCount?: number;
}

export function SillyTavernQuickActions({
  onContinue,
  onImpersonate,
  isGenerating,
  authorsNoteActive,
  onToggleAuthorsNote,
  thinkingEnabled,
  onToggleThinking,
  currentPresetId = 'roleplay-detailed',
  onSelectPreset,
  onOpenRegexManager,
  regexActiveCount,
}: SillyTavernQuickActionsProps) {
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false);

  const presets = Object.values(SILLY_TAVERN_SYSTEM_PROMPT_PRESETS);
  const activePreset = presets.find((p) => p.id === currentPresetId) || presets[0];

  return (
    <div className="relative flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px] px-0.5">
      {/* 1. Continue Nudge (SillyTavern Continue) */}
      <button
        onClick={onContinue}
        disabled={isGenerating}
        className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 apple-button disabled:opacity-40"
        title="Continue generating character's last message"
      >
        <Play className="w-3 h-3 fill-current" />
        Continue
      </button>

      {/* 2. Impersonate (SillyTavern User POV Generation) */}
      <button
        onClick={onImpersonate}
        disabled={isGenerating}
        className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 apple-button disabled:opacity-40"
        title="Draft next response from user's perspective"
      >
        <User className="w-3 h-3" />
        Impersonate
      </button>

      {/* 3. System Prompt Preset Selector */}
      <div className="relative">
        <button
          onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
          className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-medium whitespace-nowrap transition-colors flex items-center gap-1.5 apple-button"
          title="Switch SillyTavern System Prompt Preset"
        >
          <Zap className="w-3 h-3 text-amber-500" />
          <span>Preset: {activePreset.name}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </button>

        {presetDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setPresetDropdownOpen(false)}
            />
            <div className="absolute left-0 bottom-full mb-1.5 w-64 p-1.5 rounded-2xl bg-background border border-black/[0.08] dark:border-white/[0.1] shadow-lg glass-card z-50 space-y-1 animate-in fade-in zoom-in-[0.98] duration-150 ease-out">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                System Prompt Preset
              </div>
              <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => {
                      onSelectPreset(preset);
                      setPresetDropdownOpen(false);
                      toast.success(`Active Preset: ${preset.name}`);
                    }}
                    className={`w-full p-2 rounded-xl text-left text-xs transition-colors flex items-start justify-between gap-1.5 ${
                      preset.id === activePreset.id
                        ? 'bg-accent/10 text-accent font-semibold'
                        : 'hover:bg-black/5 dark:hover:bg-white/5 text-foreground'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-xs">{preset.name}</div>
                      <div className="text-[10px] text-muted-foreground line-clamp-1">
                        {preset.description}
                      </div>
                    </div>
                    {preset.id === activePreset.id && (
                      <Check className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 4. Author's Note Toggle Button */}
      <button
        onClick={onToggleAuthorsNote}
        className={`px-3 py-1 rounded-full font-medium whitespace-nowrap transition-colors touch-manipulation flex items-center gap-1.5 apple-button ${
          authorsNoteActive
            ? 'bg-accent/15 text-accent font-semibold border border-accent/30'
            : 'bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground hover:text-foreground'
        }`}
        title="Author's Note (Injected at Depth 4)"
      >
        <Bookmark className="w-3 h-3" />
        {authorsNoteActive ? "Author's Note (ON)" : "Author's Note"}
      </button>

      {/* 5. Deep Thinking Mode Toggle */}
      <button
        onClick={onToggleThinking}
        className={`px-3 py-1 rounded-full font-medium whitespace-nowrap transition-colors touch-manipulation flex items-center gap-1.5 apple-button ${
          thinkingEnabled
            ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400 font-semibold border border-purple-500/30'
            : 'bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground hover:text-foreground'
        }`}
        title="Toggle Deep Thinking (Live CoT reasoning)"
      >
        <Brain className="w-3 h-3 text-purple-500" />
        {thinkingEnabled ? 'Thinking: ON' : 'Thinking: OFF'}
      </button>

      {/* 6. Regex & Output Formatters */}
      {onOpenRegexManager && (
        <button
          onClick={onOpenRegexManager}
          className="px-3 py-1 rounded-full bg-accent/10 hover:bg-accent/20 text-accent font-medium whitespace-nowrap transition-colors touch-manipulation flex items-center gap-1.5 apple-button border border-accent/20"
          title="Open Regex Scripts & Output Formatters Studio"
        >
          <Sparkles className="w-3 h-3 text-accent" />
          <span>Regex & Formatters{typeof regexActiveCount === 'number' ? ` (${regexActiveCount})` : ''}</span>
        </button>
      )}
    </div>
  );
}
