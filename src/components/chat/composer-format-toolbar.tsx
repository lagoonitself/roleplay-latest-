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
    <div className="flex select-none items-center justify-between gap-1 px-1 py-0.5 text-[11px]">
      {/* Left: Quick Formatting Chips */}
      <div className="scrollbar-none flex items-center gap-1 overflow-x-auto py-0.5">
        {/* Dialogue Quote Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('“', '”')}
          className="btn btn-quiet text-[11px]"
          title='Format dialogue: wraps selection in "quotes"'
        >
          <Quote aria-hidden className="h-3 w-3 shrink-0 text-ink-2" />
          <span className="font-serif text-xs font-semibold">“Quote”</span>
        </button>

        {/* Prose Action Italic Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('*', '*')}
          className="btn btn-quiet text-[11px]"
          title="Format action/narration: wraps selection in *asterisks*"
        >
          <Italic aria-hidden className="h-3 w-3 shrink-0 text-ink-2" />
          <span className="font-serif text-xs font-medium italic">*Action*</span>
        </button>

        {/* Out-Of-Character Note Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('(( ', ' ))')}
          className="btn btn-quiet font-mono text-[10px]"
          title="Out-of-character directive: (( Note to AI / OOC instruction ))"
        >
          <MessageSquareCode aria-hidden className="h-3 w-3 shrink-0 text-ink-2" />
          <span className="font-medium">(( OOC ))</span>
        </button>

        {/* Secret / Spoiler Blur Chip */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onFormat('||', '||')}
          className="btn btn-quiet hidden text-[10px] sm:flex"
          title="Spoiler: wraps in ||spoiler|| for click-to-reveal blur"
        >
          <EyeOff aria-hidden className="h-3 w-3 shrink-0 text-ink-2" />
          <span>|| Spoiler ||</span>
        </button>

        {/* Dice Roller Popover */}
        <div className="relative">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setDiceDropdownOpen(!diceDropdownOpen)}
            aria-expanded={diceDropdownOpen}
            aria-haspopup="menu"
            className="btn btn-quiet font-mono text-[10px]"
            title="Insert interactive dice roll macro"
          >
            <Dices aria-hidden className="h-3 w-3 shrink-0 text-ink-2" />
            <span className="font-semibold">Roll</span>
            <ChevronDown aria-hidden className="h-2.5 w-2.5 opacity-60" />
          </button>

          {diceDropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDiceDropdownOpen(false)}
              />
              <div
                role="menu"
                style={{ transformOrigin: 'bottom left' }}
                className="panel animate-in fade-in absolute bottom-full left-0 z-50 mb-1.5 w-48 space-y-0.5 rounded-xl border-line bg-raised p-1.5 shadow-float duration-150"
              >
                <div className="type-label px-2 py-1">
                  Insert dice roll
                </div>
                {COMMON_DICE.map((d) => (
                  <button
                    key={d.formula}
                    type="button"
                    role="menuitem"
                    onClick={() => handleRollInsert(d.formula)}
                    className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-ink-2 transition-colors hover:text-ink"
                  >
                    <div>
                      <span className="font-mono font-semibold text-accent-text">
                        {d.formula}
                      </span>
                      <p className="text-[10px] text-ink-3">{d.desc}</p>
                    </div>
                    <span className="font-mono text-[10px] opacity-40">Insert</span>
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
          aria-label={soundEnabled ? 'Mute sound effects' : 'Enable sound effects'}
          className="icon-btn ml-1 shrink-0"
          style={{ width: 24, height: 24 }}
          title={soundEnabled ? 'Sound effects enabled (Click to mute)' : 'Sound effects muted (Click to enable)'}
        >
          {soundEnabled ? (
            <Volume2 aria-hidden className="h-3.5 w-3.5" />
          ) : (
            <VolumeX aria-hidden className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}
