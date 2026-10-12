'use client';

import React, { useEffect, useState } from 'react';
import { Popover } from 'radix-ui';
import {
  Play,
  UserPen,
  Bookmark,
  Brain,
  ChevronDown,
  Check,
  Quote,
  Asterisk,
  MessageSquareCode,
  EyeOff,
  Dices,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  DEFAULT_PRESET_ID,
  SILLY_TAVERN_SYSTEM_PROMPT_PRESETS,
  type SystemPromptPreset,
} from '@/lib/prompt/presets';
import { playDiceSound } from '@/lib/audio/sound-effects';

export interface SillyTavernQuickActionsProps {
  onContinue: () => void;
  onImpersonate: () => void;
  isGenerating: boolean;
  authorsNoteActive: boolean;
  authorsNoteOpen?: boolean;
  onToggleAuthorsNote: () => void;
  thinkingEnabled: boolean;
  onToggleThinking: () => void;
  currentPresetId?: string;
  onSelectPreset: (preset: SystemPromptPreset) => void;
  /** Wraps the composer selection (or inserts at the caret). */
  onFormat: (prefix: string, suffix?: string, placeholder?: string) => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}

const COMMON_DICE = [
  { formula: '1d20', desc: 'Check or save' },
  { formula: '2d6', desc: 'Tabletop classic' },
  { formula: '1d100', desc: 'Percentile' },
  { formula: '1d6', desc: 'Single die' },
  { formula: '3d6', desc: 'Attribute roll' },
];

/**
 * The composer's single tool row: story actions on the left, text formatting on
 * the right. It scrolls sideways on narrow screens; menus are portaled so the
 * scroll container can never clip them.
 */
export function SillyTavernQuickActions({
  onContinue,
  onImpersonate,
  isGenerating,
  authorsNoteActive,
  authorsNoteOpen = false,
  onToggleAuthorsNote,
  thinkingEnabled,
  onToggleThinking,
  currentPresetId = DEFAULT_PRESET_ID,
  onSelectPreset,
  onFormat,
  soundEnabled = true,
  onToggleSound,
}: SillyTavernQuickActionsProps) {
  const [presetOpen, setPresetOpen] = useState(false);
  const [diceOpen, setDiceOpen] = useState(false);

  // These two come from localStorage-backed stores, which resolve differently
  // on the server render and the hydration render. Hold the server's defaults
  // until mount so hydration stays clean (same pattern as Navbar).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);
  const soundOn = mounted ? soundEnabled : true;
  const thinkingOn = mounted ? thinkingEnabled : false;

  const presets = Object.values(SILLY_TAVERN_SYSTEM_PROMPT_PRESETS);
  const activePreset = presets.find((p) => p.id === currentPresetId) || presets[0];

  return (
    <div
      role="toolbar"
      aria-label="Story tools"
      className="scrollbar-none -mx-1 flex items-center gap-1 overflow-x-auto px-1 py-0.5"
    >
      <button
        type="button"
        onClick={onContinue}
        disabled={isGenerating}
        className="tool min-h-11 px-2.5"
        title="Extend the last reply"
        aria-label="Extend the last reply"
      >
        <Play aria-hidden="true" className="h-3.5 w-3.5" />
        Continue
      </button>

      <button
        type="button"
        onClick={onImpersonate}
        disabled={isGenerating}
        className="tool min-h-11 px-2.5"
        title="Draft your next turn into the composer"
        aria-label="Draft your next turn into the composer"
      >
        <UserPen aria-hidden="true" className="h-3.5 w-3.5" />
        Write for me
      </button>

      <button
        type="button"
        onClick={onToggleAuthorsNote}
        aria-pressed={authorsNoteActive || authorsNoteOpen}
        className="tool min-h-11 px-2.5"
        title={authorsNoteActive ? "Author's note is steering the scene" : "Add an author's note to steer the scene"}
        aria-label={authorsNoteActive ? "Author's note active" : "Add author's note"}
      >
        <Bookmark aria-hidden="true" className="h-3.5 w-3.5" />
        Note
        {authorsNoteActive && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>

      <button
        type="button"
        onClick={onToggleThinking}
        aria-pressed={thinkingOn}
        className="tool min-h-11 px-2.5"
        title={thinkingOn ? 'Thinking is on: slower, more deliberate replies' : 'Let the model think before it writes'}
        aria-label={thinkingOn ? 'Thinking enabled' : 'Enable thinking'}
      >
        <Brain aria-hidden="true" className="h-3.5 w-3.5" />
        Think
      </button>

      <Popover.Root open={presetOpen} onOpenChange={setPresetOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="tool min-h-11 px-2.5"
            title="House style layered on the character"
            aria-label={`Prompt style: ${activePreset.name}`}
          >
            <span className="max-w-[9rem] truncate">Style: {activePreset.name}</span>
            <ChevronDown aria-hidden="true" className="h-3.5 w-3.5 opacity-60 shrink-0" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            className="panel z-50 w-[min(20rem,calc(100vw-1rem))] max-h-[min(60dvh,var(--radix-popper-available-height,60dvh))] scroll-y rounded-xl p-1.5 animate-in fade-in duration-150"
          >
            <p className="type-meta px-2 pb-1 pt-0.5">
              Layered under the character. The chat’s content rating still applies.
            </p>
            <div role="menu" className="space-y-0.5">
              {presets.map((preset) => {
                const active = preset.id === activePreset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => {
                      onSelectPreset(preset);
                      setPresetOpen(false);
                    }}
                    className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left row-press transition-colors duration-150 hover:bg-sunken ${
                      active ? 'text-accent-text' : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{preset.name}</span>
                      <span className="block truncate text-[11px] text-ink-3">{preset.description}</span>
                    </span>
                    {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <span className="tool-sep mx-1" aria-hidden="true" />

      <button
        type="button"
        disabled={isGenerating}
        onClick={() => onFormat('“', '”')}
        className="tool min-h-11 min-w-11 justify-center px-0"
        title="Dialogue: wrap in quotes"
        aria-label="Wrap in quotes"
      >
        <Quote aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={isGenerating}
        onClick={() => onFormat('*', '*')}
        className="tool min-h-11 min-w-11 justify-center px-0"
        title="Action: wrap in asterisks"
        aria-label="Wrap in asterisks"
      >
        <Asterisk aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={isGenerating}
        onClick={() => onFormat('(( ', ' ))')}
        className="tool min-h-11 min-w-11 justify-center px-0"
        title="Out of character: a note to the AI"
        aria-label="Out-of-character note"
      >
        <MessageSquareCode aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={isGenerating}
        onClick={() => onFormat('||', '||')}
        className="tool min-h-11 min-w-11 justify-center px-0"
        title="Spoiler: hidden until tapped"
        aria-label="Wrap as spoiler"
      >
        <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
      </button>

      <Popover.Root open={diceOpen} onOpenChange={setDiceOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={isGenerating}
            className="tool min-h-11 min-w-11 justify-center px-0"
            aria-label="Insert a dice roll"
            title="Insert a dice roll"
          >
            <Dices aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={8}
            className="panel z-50 w-[min(20rem,calc(100vw-1rem))] max-h-[min(60dvh,var(--radix-popper-available-height,60dvh))] scroll-y rounded-xl p-1.5 animate-in fade-in duration-150"
          >
            <p className="type-meta px-2 pb-1 pt-0.5">Rolled when you send</p>
            <div role="menu" className="space-y-0.5">
              {COMMON_DICE.map((d) => (
                <button
                  key={d.formula}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    playDiceSound();
                    onFormat(`{{roll::${d.formula}}}`, '', '');
                    setDiceOpen(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-2 row-press transition-colors duration-150 hover:bg-sunken hover:text-ink"
                >
                  <span className="font-mono font-semibold text-accent-text">{d.formula}</span>
                  <span className="text-[11px] text-ink-3">{d.desc}</span>
                </button>
              ))}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      {onToggleSound && (
        <button
          type="button"
          onClick={onToggleSound}
          className="tool min-h-11 min-w-11 ml-auto justify-center px-0"
          aria-label={soundOn ? 'Mute sound effects' : 'Turn on sound effects'}
          title={soundOn ? 'Mute sound effects' : 'Turn on sound effects'}
        >
          {soundOn ? <Volume2 aria-hidden="true" className="h-3.5 w-3.5" /> : <VolumeX aria-hidden="true" className="h-3.5 w-3.5" />}
        </button>
      )}
    </div>
  );
}
