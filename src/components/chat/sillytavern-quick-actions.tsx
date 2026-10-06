'use client';

import React, { useState } from 'react';
import {
  Play,
  User,
  Bookmark,
  Brain,
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
    <div className="scrollbar-none relative flex flex-nowrap items-center gap-1.5 overflow-x-auto px-0.5 text-[11px] sm:flex-wrap sm:overflow-visible">
      {/* 1. Continue Nudge (SillyTavern Continue) */}
      <button
        onClick={onContinue}
        disabled={isGenerating}
        className="btn btn-ghost whitespace-nowrap text-[11px]"
        title="Continue generating character's last message"
      >
        <Play aria-hidden className="h-3 w-3 fill-current" />
        Continue
      </button>

      {/* 2. Impersonate (SillyTavern User POV Generation) */}
      <button
        onClick={onImpersonate}
        disabled={isGenerating}
        className="btn btn-ghost whitespace-nowrap text-[11px]"
        title="Draft next response from user's perspective"
      >
        <User aria-hidden className="h-3 w-3" />
        Impersonate
      </button>

      {/* 3. System Prompt Preset Selector */}
      <div className="relative">
        <button
          onClick={() => setPresetDropdownOpen(!presetDropdownOpen)}
          aria-expanded={presetDropdownOpen}
          aria-haspopup="menu"
          className="btn btn-ghost whitespace-nowrap text-[11px]"
          title="Switch SillyTavern system prompt preset"
        >
          <Zap aria-hidden className="h-3 w-3" />
          <span>Preset: {activePreset.name}</span>
          <ChevronDown aria-hidden className="h-3 w-3 opacity-60" />
        </button>

        {presetDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setPresetDropdownOpen(false)}
            />
            <div
              role="menu"
              style={{ transformOrigin: 'bottom left' }}
              className="panel animate-in fade-in absolute bottom-full left-0 z-50 mb-1.5 w-64 space-y-1 rounded-xl border-line bg-raised p-1.5 duration-150 ease-out"
            >
              <div className="type-label px-2 py-1">
                System prompt preset
              </div>
              <div className="max-h-56 space-y-0.5 overflow-y-auto pr-0.5">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    role="menuitem"
                    onClick={() => {
                      onSelectPreset(preset);
                      setPresetDropdownOpen(false);
                      toast.success(`Active preset: ${preset.name}`);
                    }}
                    className={`flex w-full items-start justify-between gap-1.5 rounded-lg p-2 text-left text-xs transition-colors ${
                      preset.id === activePreset.id
                        ? 'text-accent-text'
                        : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium">{preset.name}</div>
                      <div className="line-clamp-1 text-[10px] text-ink-3">
                        {preset.description}
                      </div>
                    </div>
                    {preset.id === activePreset.id && (
                      <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-text" />
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
        aria-pressed={authorsNoteActive}
        className={`btn btn-ghost whitespace-nowrap text-[11px] ${
          authorsNoteActive ? 'border-accent-line bg-accent-wash text-accent-text' : ''
        }`}
        title="Author's note (injected at depth 4)"
      >
        <Bookmark aria-hidden className="h-3 w-3" />
        {authorsNoteActive ? "Author's note (on)" : "Author's note"}
      </button>

      {/* 5. Deep Thinking Mode Toggle */}
      <button
        onClick={onToggleThinking}
        aria-pressed={thinkingEnabled}
        className={`btn btn-ghost whitespace-nowrap text-[11px] ${
          thinkingEnabled ? 'border-accent-line bg-accent-wash text-accent-text' : ''
        }`}
        title="Toggle deep thinking (live CoT reasoning)"
      >
        <Brain aria-hidden className="h-3 w-3" />
        {thinkingEnabled ? 'Thinking (on)' : 'Thinking (off)'}
      </button>

      {/* 6. Regex & Output Formatters */}
      {onOpenRegexManager && (
        <button
          onClick={onOpenRegexManager}
          className="btn btn-ghost whitespace-nowrap text-[11px]"
          title="Open regex scripts and output formatters studio"
        >
          <Sparkles aria-hidden className="h-3 w-3" />
          <span>Regex & formatters{typeof regexActiveCount === 'number' ? ` (${regexActiveCount})` : ''}</span>
        </button>
      )}
    </div>
  );
}
