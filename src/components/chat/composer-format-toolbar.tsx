'use client';

import React, { useState } from 'react';
import {
  Quote,
  Italic,
  EyeOff,
  Dices,
  Volume2,
  VolumeX,
  ChevronDown,
  MessageSquareCode,
} from 'lucide-react';
import { toast } from 'sonner';
import { playDiceSound } from '@/lib/audio/sound-effects';

export interface ComposerFormatToolbarProps {
  onFormat: (prefix: string, suffix?: string, defaultPlaceholder?: string) => void;
  disabled?: boolean;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}

const COMMON_DICE = [
  { label: 'd20', formula: '1d20', desc: 'Standard check / save' },
  { label: '2d6', formula: '2d6', desc: 'Classic tabletop / PbtA' },
  { label: '1d100', formula: '1d100', desc: 'Percentile / skill check' },
  { label: '1d6', formula: '1d6', desc: 'Standard single die' },
  { label: '3d6', formula: '3d6', desc: 'Bell-curve attribute' },
];

export function ComposerFormatToolbar({
  onFormat,
  disabled = false,
  soundEnabled = true,
  onToggleSound,
}: ComposerFormatToolbarProps) {
  const [diceDropdownOpen, setDiceDropdownOpen] = useState(false);

  const handleRollInsert = (formula: string) => {
    playDiceSound();
    onFormat(`{{roll::${formula}}}`, '', '');
    setDiceDropdownOpen(false);
    toast.success(`Inserted ${formula} dice macro`);
  };

  return (
    <div className="flex items-center justify-between gap-1 text-[11px] px-1 py-0.5 select-none">
      {/* Left: Quick Formatting Chips */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5">
        {/* Dialogue Quote Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('“', '”')}
          className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-serif text-xs transition-all apple-button flex items-center gap-1 active:scale-95 disabled:opacity-40"
          title='Format dialogue: wraps selection in "quotes"'
        >
          <Quote className="w-3 h-3 text-accent shrink-0" />
          <span className="font-semibold text-[11px]">“Quote”</span>
        </button>

        {/* Prose Action Italic Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('*', '*')}
          className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-serif italic text-xs transition-all apple-button flex items-center gap-1 active:scale-95 disabled:opacity-40"
          title="Format action/narration: wraps selection in *asterisks*"
        >
          <Italic className="w-3 h-3 text-emerald-500 shrink-0" />
          <span className="text-[11px] font-medium">*Action*</span>
        </button>

        {/* Out-Of-Character Note Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('(( ', ' ))')}
          className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-mono text-[10px] transition-all apple-button flex items-center gap-1 active:scale-95 disabled:opacity-40"
          title="Out-of-character directive: (( Note to AI / OOC instruction ))"
        >
          <MessageSquareCode className="w-3 h-3 text-purple-500 shrink-0" />
          <span className="font-medium">(( OOC ))</span>
        </button>

        {/* Secret / Spoiler Blur Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('||', '||')}
          className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground text-[10px] transition-all apple-button flex items-center gap-1 active:scale-95 disabled:opacity-40 hidden xs:flex"
          title="Spoiler: wraps in ||spoiler|| for click-to-reveal blur"
        >
          <EyeOff className="w-3 h-3 text-amber-500 shrink-0" />
          <span>|| Spoiler ||</span>
        </button>

        {/* Dice Roller Popover */}
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDiceDropdownOpen(!diceDropdownOpen)}
            className="px-2 py-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground hover:text-foreground font-mono text-[10px] transition-all apple-button flex items-center gap-1 active:scale-95 disabled:opacity-40"
            title="Insert interactive dice roll macro"
          >
            <Dices className="w-3 h-3 text-accent shrink-0" />
            <span className="font-semibold text-accent">🎲 Roll</span>
            <ChevronDown className="w-2.5 h-2.5 opacity-60" />
          </button>

          {diceDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDiceDropdownOpen(false)}
              />
              <div className="absolute left-0 bottom-full mb-1.5 w-48 p-1.5 rounded-2xl bg-background border border-black/[0.08] dark:border-white/[0.1] shadow-xl glass-card z-50 space-y-0.5 animate-in fade-in zoom-in-95 duration-150">
                <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Insert Dice Roll Macro
                </div>
                {COMMON_DICE.map((d) => (
                  <button
                    key={d.formula}
                    type="button"
                    onClick={() => handleRollInsert(d.formula)}
                    className="w-full px-2.5 py-1.5 rounded-xl text-left text-xs hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between group transition-colors"
                  >
                    <div>
                      <span className="font-mono font-semibold text-accent group-hover:scale-105 inline-block">
                        {d.formula}
                      </span>
                      <p className="text-[10px] text-muted-foreground">{d.desc}</p>
                    </div>
                    <span className="text-[10px] opacity-40 font-mono">Insert</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Right: Audio FX Toggle */}
      {onToggleSound && (
        <button
          type="button"
          onClick={onToggleSound}
          className={`p-1.5 rounded-lg transition-colors apple-button shrink-0 ml-1 ${
            soundEnabled
              ? 'text-accent hover:bg-accent/10'
              : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
          }`}
          title={soundEnabled ? 'Sound effects enabled (Click to mute)' : 'Sound effects muted (Click to enable)'}
        >
          {soundEnabled ? (
            <Volume2 className="w-3.5 h-3.5" />
          ) : (
            <VolumeX className="w-3.5 h-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
