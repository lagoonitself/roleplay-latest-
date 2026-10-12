'use client';

import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Dices,
  RotateCcw,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Shield,
  Copy,
  Check,
  Brain,
  Award,
  Scroll,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type RegexScript,
  rollDice,
  processDisplayTime,
  type MacroContext,
} from '@/lib/formatter/regex-engine';
import { playDiceSound } from '@/lib/audio/sound-effects';

interface RoleplayMessageContentProps {
  content: string;
  characterName?: string;
  userName?: string;
  accentColor?: string | null;
  role: 'assistant' | 'user' | 'system';
  isStreaming?: boolean;
  scripts?: RegexScript[];
}

/**
 * Interactive Spoiler Tag with blur reveal.
 */
function SpoilerSpan({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  const toggle = () => setRevealed((v) => !v);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          toggle();
        }
      }}
      title={revealed ? 'Click to hide spoiler' : 'Click to reveal secret'}
      aria-label={revealed ? 'Hide spoiler' : 'Reveal spoiler'}
      className={`my-0.5 inline-block cursor-pointer select-none rounded px-1.5 py-0.5 transition-[filter,opacity,color,background-color] duration-150 ${
        revealed ? 'bg-sunken text-ink' : 'text-ink-3 blur-[4px]'
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Interactive Dice Roll Chip.
 * Click to reroll with sound and a quiet pulse.
 */
function DiceRollChip({ formula }: { formula: string }) {
  const [currentRoll, setCurrentRoll] = useState(() => rollDice(formula));
  const [isRolling, setIsRolling] = useState(false);

  const handleReroll = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRolling(true);
    playDiceSound();
    const next = rollDice(formula);
    setTimeout(() => {
      setCurrentRoll(next);
      setIsRolling(false);
      toast.success(`Rolled ${formula}: ${next.total} (${next.rolls.join(' + ')}${next.modifier ? (next.modifier > 0 ? ` + ${next.modifier}` : ` - ${Math.abs(next.modifier)}`) : ''})`);
    }, 180);
  };

  const modStr = currentRoll.modifier !== 0
    ? (currentRoll.modifier > 0 ? `+${currentRoll.modifier}` : `${currentRoll.modifier}`)
    : '';

  return (
    <button
      type="button"
      onClick={handleReroll}
      title={`Click to re-roll ${formula} (Current: ${currentRoll.rolls.join('+')}${modStr})`}
      aria-label={`Re-roll ${formula}, current total ${currentRoll.total}`}
      className={`chip mx-1 my-0.5 cursor-pointer select-none px-2 py-0.5 align-middle font-mono text-xs font-semibold transition-[opacity] duration-150 ${
        isRolling ? 'pulse-soft opacity-70' : ''
      }`}
    >
      <Dices aria-hidden className="h-3.5 w-3.5 text-ink-2" />
      <span className="text-[11px] opacity-75">{formula}</span>
      <span className="font-bold text-accent-text">→ {currentRoll.total}</span>
      <RotateCcw aria-hidden className="ml-0.5 h-2.5 w-2.5 opacity-40" />
    </button>
  );
}

/**
 * Roleplay Card (<card> or {{card}})
 */
function RoleplayCard({
  title,
  badge,
  icon,
  children,
}: {
  title?: string;
  badge?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (typeof children === 'string') {
      navigator.clipboard
        ?.writeText(children)
        .then(() => {
          setCopied(true);
          toast.success('Card copied to clipboard');
          setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => toast.error('Could not copy to clipboard'));
    }
  };

  const getIcon = () => {
    switch (icon?.toLowerCase()) {
      case 'shield':
      case 'armor':
        return <Shield aria-hidden className="h-4 w-4 shrink-0 text-ink-3" />;
      case 'quest':
      case 'scroll':
        return <Scroll aria-hidden className="h-4 w-4 shrink-0 text-ink-3" />;
      case 'award':
      case 'achievement':
        return <Award aria-hidden className="h-4 w-4 shrink-0 text-ink-3" />;
      default:
        return <Sparkles aria-hidden className="h-4 w-4 shrink-0 text-ink-3" />;
    }
  };

  return (
    <div className="surface group relative my-3 overflow-hidden rounded-lg p-4">
      {/* Header */}
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex min-w-0 items-center gap-2">
          {getIcon()}
          {title && <span className="type-sec truncate">{title}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge && <span className="chip chip-accent">{badge}</span>}
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy card text"
            title="Copy card text"
            /* Always visible on touch (below sm — no hover to reveal it there);
               hover/focus reveal at sm:+. ≥32px hit area, and pointer-events
               are dropped along with the opacity so it can never be an
               invisible tap target. */
            className="icon-btn w-8 h-8 opacity-100 sm:opacity-0 sm:pointer-events-none sm:group-hover:opacity-100 sm:group-hover:pointer-events-auto sm:focus-visible:opacity-100 sm:focus-visible:pointer-events-auto focus-visible:opacity-100"
          >
            {copied ? <Check aria-hidden className="h-3.5 w-3.5" /> : <Copy aria-hidden className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="text-xs font-normal leading-relaxed text-ink">{children}</div>
    </div>
  );
}

/**
 * RPG Status HUD with flat meter bars.
 */
function RoleplayStatusHud({ raw }: { raw: string }) {
  // Parse attributes like: hp="85/100" mp="40/50" gold="120"
  const stats = useMemo(() => {
    const list: Array<{ label: string; current: number; max: number; unit?: string; type: string }> = [];

    // Match patterns like HP: 85/100 or hp="85/100"
    const hpMatch = raw.match(/(?:hp|health)[:=]["']?(\d+)(?:\/(\d+))?["']?/i);
    if (hpMatch) {
      list.push({
        label: 'Health',
        current: parseInt(hpMatch[1], 10),
        max: hpMatch[2] ? parseInt(hpMatch[2], 10) : 100,
        type: 'health',
      });
    }

    const mpMatch = raw.match(/(?:mp|mana|energy)[:=]["']?(\d+)(?:\/(\d+))?["']?/i);
    if (mpMatch) {
      list.push({
        label: 'Mana',
        current: parseInt(mpMatch[1], 10),
        max: mpMatch[2] ? parseInt(mpMatch[2], 10) : 100,
        type: 'mana',
      });
    }

    const goldMatch = raw.match(/(?:gold|coins|credits)[:=]["']?(\d+)["']?/i);
    if (goldMatch) {
      list.push({
        label: 'Gold',
        current: parseInt(goldMatch[1], 10),
        max: 0,
        unit: 'G',
        type: 'gold',
      });
    }

    return list;
  }, [raw]);

  if (!stats.length) {
    return (
      <div className="well type-code my-2 select-text px-2.5 py-2 text-ink-2">
        <span className="text-accent-text">Status: </span>
        {raw}
      </div>
    );
  }

  return (
    <div className="surface my-3 space-y-2.5 rounded-lg p-3 sm:p-4">
      <span className="type-sec">Status</span>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {stats.map((stat, idx) => {
          if (stat.type === 'gold') {
            return (
              <div key={idx} className="flex items-center justify-between gap-2">
                <span className="type-label">Gold</span>
                <span className="chip chip-warn type-code">{stat.current} G</span>
              </div>
            );
          }

          const pct = Math.min(Math.max((stat.current / (stat.max || 100)) * 100, 0), 100);
          const isHealth = stat.type === 'health';

          return (
            <div key={idx} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="type-label">{stat.label}</span>
                <span className="type-code tabular-nums text-ink-2">
                  {stat.current}/{stat.max}
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={stat.label}
                aria-valuenow={stat.current}
                aria-valuemin={0}
                aria-valuemax={stat.max}
                className="h-[3px] w-full overflow-hidden rounded-full bg-sunken"
              >
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    isHealth ? 'bg-danger' : 'bg-accent'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Collapsible Inner Thought Monologue Box
 */
function ThoughtBlock({ children, charName }: { children: React.ReactNode; charName?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="surface my-2 overflow-hidden rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-ink-2 transition-colors hover:text-ink"
      >
        <span className="flex items-center gap-1.5">
          <Brain aria-hidden className="h-3.5 w-3.5 text-ink-3" />
          <span>{charName ? `${charName}'s inner thoughts` : 'Inner thoughts'}</span>
        </span>
        {open ? <ChevronDown aria-hidden className="h-3.5 w-3.5 opacity-60" /> : <ChevronRight aria-hidden className="h-3.5 w-3.5 opacity-60" />}
      </button>

      {open && (
        <div className="animate-in fade-in border-t border-line px-3.5 py-2.5 font-serif text-xs italic leading-relaxed text-ink-2 duration-150">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Out-of-Character (OOC) note
 */
function OocBadge({ text }: { text: string }) {
  return (
    <div className="chip my-1.5 select-text px-2.5 py-1 text-xs text-ink-2">
      <span className="type-code text-ink-2">OOC</span>
      <span>{text}</span>
    </div>
  );
}

/**
 * Quiet Roleplay Scene Divider
 */
function SceneDivider() {
  return (
    <div aria-hidden className="my-6 flex items-center">
      <div className="w-full border-t border-line" />
    </div>
  );
}

/**
 * Main Roleplay Message Content Formatter
 */
/**
 * Rendered roleplay prose.
 *
 * Memoised: during streaming the transcript re-renders on every token, and this
 * component runs a regex transform plus a full Markdown parse. Without a memo
 * every completed turn re-parses on each token (a 200-turn chat would parse 200
 * documents per token). Completed turns hold stable props, so only the turn that
 * is actually streaming re-renders.
 */
export const RoleplayMessageContent = React.memo(function RoleplayMessageContent({
  content,
  characterName = 'Character',
  userName = 'User',
  accentColor,
  role,
  isStreaming = false,
  scripts = [],
}: RoleplayMessageContentProps) {
  // 1. Run display-time transformations & sanitizers
  const transformedText = useMemo(() => {
    const ctx: MacroContext = {
      charName: characterName,
      userName: userName,
    };
    return processDisplayTime(content, scripts, role === 'user' ? 'user' : 'assistant', ctx);
  }, [content, scripts, role, characterName, userName]);

  // Dynamic CSS variables for character dialogue hue.
  // Character cards are attacker-controlled: only strict hex is accepted so a
  // crafted `accent_color` can never inject extra CSS into the style value.
  const styleVars = useMemo(() => {
    if (accentColor && /^#[0-9a-fA-F]{3,8}$/.test(accentColor)) {
      return { '--rp-dialogue-color': accentColor } as React.CSSProperties;
    }
    return undefined;
  }, [accentColor]);

  // 2. Tokenize transformed text into structural blocks (cards, status HUD, thoughts, scene dividers, markdown)
  const blocks = useMemo(() => {
    const raw = transformedText;
    const pieces: Array<{
      type: 'card' | 'status' | 'thought' | 'ooc' | 'divider' | 'text';
      content: string;
      meta?: Record<string, string>;
    }> = [];

    // Regex matching our structural block tags
    const blockRegex = /\[\[rp-card\s*(?:title="([^"]*)")?(?:\s*badge="([^"]*)")?(?:\s*icon="([^"]*)")?\]\]([\s\S]*?)\[\[\/rp-card\]\]|\[\[rp-status\s+raw="([^"]*)"\]\]|\[\[rp-thought\]\]([\s\S]*?)\[\[\/rp-thought\]\]|\[\[rp-ooc\]\]([\s\S]*?)\[\[\/rp-ooc\]\]|\[\[rp-divider\]\]/gi;

    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(raw)) !== null) {
      if (match.index > lastIdx) {
        const textChunk = raw.slice(lastIdx, match.index);
        if (textChunk.trim()) {
          pieces.push({ type: 'text', content: textChunk });
        }
      }

      if (match[0].startsWith('[[rp-card')) {
        pieces.push({
          type: 'card',
          content: match[4] || '',
          meta: { title: match[1] || '', badge: match[2] || '', icon: match[3] || '' },
        });
      } else if (match[0].startsWith('[[rp-status')) {
        pieces.push({
          type: 'status',
          content: match[5] || '',
        });
      } else if (match[0].startsWith('[[rp-thought')) {
        pieces.push({
          type: 'thought',
          content: match[6] || '',
        });
      } else if (match[0].startsWith('[[rp-ooc')) {
        pieces.push({
          type: 'ooc',
          content: match[7] || '',
        });
      } else if (match[0].startsWith('[[rp-divider')) {
        pieces.push({
          type: 'divider',
          content: '',
        });
      }

      lastIdx = blockRegex.lastIndex;
    }

    if (lastIdx < raw.length) {
      const remaining = raw.slice(lastIdx);
      if (remaining) {
        pieces.push({ type: 'text', content: remaining });
      }
    }

    return pieces.length > 0 ? pieces : [{ type: 'text' as const, content: raw }];
  }, [transformedText]);

  /**
   * Custom inline parser that replaces:
   * - [[rp-dialogue]]...[[/rp-dialogue]] with styled quotation marks & dialogue color
   * - [[rp-action]]...[[/rp-action]] with soft italics
   * - [[rp-roll formula="2d6"]] with interactive DiceRollChip
   *
   * Tags can nest (e.g. a quote inside an *action* span becomes
   * [[rp-action]]…[[rp-dialogue]]…[[/rp-dialogue]]…[[/rp-action]]), so tag
   * contents are parsed recursively. Markers left unpaired (e.g. when markdown
   * splits a tag pair across nodes) are stripped instead of shown raw.
   *
   * With `narrate`, plain text outside any tag is styled as action prose:
   * models often leave beats like `"…," she says. Her thumb brushes his knuckle.`
   * without asterisks, which otherwise render in the same voice as the dialogue.
   */
  const renderFormattedInlineText = (text: string, keyPrefix = '', narrate = false): React.ReactNode => {
    // If text has no special markers, render directly
    if (!text.includes('[[')) {
      return narrate && text.trim() ? <span className="rp-action">{text}</span> : text;
    }

    const inlineRegex = /\[\[rp-dialogue\]\]([\s\S]*?)\[\[\/rp-dialogue\]\]|\[\[rp-action\]\]([\s\S]*?)\[\[\/rp-action\]\]|\[\[rp-roll\s+formula="([^"]+)"\]\]|\[\[rp-spoiler\]\]([\s\S]*?)\[\[\/rp-spoiler\]\]/gi;
    const strayMarkerRegex = /\[\[\/?rp-(?:dialogue|action|spoiler)\]\]/gi;

    const elements: React.ReactNode[] = [];
    let last = 0;
    let inlineMatch: RegExpExecArray | null;
    let keyIdx = 0;
    const nextKey = () => `${keyPrefix}${keyIdx++}`;
    const pushPlain = (plain: string) => {
      const cleaned = plain.replace(strayMarkerRegex, '');
      if (!cleaned) return;
      elements.push(
        narrate && cleaned.trim() ? <span key={nextKey()} className="rp-action">{cleaned}</span> : cleaned
      );
    };

    while ((inlineMatch = inlineRegex.exec(text)) !== null) {
      if (inlineMatch.index > last) {
        pushPlain(text.slice(last, inlineMatch.index));
      }

      if (inlineMatch[1] !== undefined) {
        // Dialogue match
        const key = nextKey();
        elements.push(
          <span key={key} className="rp-dialogue">
            <span className="select-none opacity-70">“</span>
            {renderFormattedInlineText(inlineMatch[1], `${key}-`)}
            <span className="select-none opacity-70">”</span>
          </span>
        );
      } else if (inlineMatch[2] !== undefined) {
        // Action prose match
        const key = nextKey();
        elements.push(
          <span key={key} className="rp-action">
            {renderFormattedInlineText(inlineMatch[2], `${key}-`)}
          </span>
        );
      } else if (inlineMatch[3] !== undefined) {
        // Interactive Dice Roll
        elements.push(<DiceRollChip key={nextKey()} formula={inlineMatch[3]} />);
      } else if (inlineMatch[4] !== undefined) {
        // Spoiler Blur Tag
        const key = nextKey();
        elements.push(
          <SpoilerSpan key={key}>{renderFormattedInlineText(inlineMatch[4], `${key}-`)}</SpoilerSpan>
        );
      }

      last = inlineRegex.lastIndex;
    }

    if (last < text.length) {
      pushPlain(text.slice(last));
    }

    return elements;
  };

  /** Applies the inline parser to every string child of a markdown node. */
  const formatChildren = (children: React.ReactNode, narrate = false) =>
    React.Children.map(children, (child) =>
      typeof child === 'string' ? renderFormattedInlineText(child, '', narrate) : child
    );

  /**
   * Whether bare text in a paragraph is narration. A paragraph that mixes in
   * dialogue makes everything outside the quotes narration. A reply paragraph
   * with no quote marks at all is pure narration too; user turns are left
   * alone there, since people often type plain speech without quotes.
   */
  const isNarratedParagraph = (children: React.ReactNode) => {
    const text = React.Children.toArray(children)
      .filter((c): c is string => typeof c === 'string')
      .join('');
    if (text.includes('[[rp-dialogue]]')) return true;
    return role === 'assistant' && !/["“”「」«»]/.test(text);
  };

  return (
    <div style={styleVars} className="prose-rp select-text space-y-2">
      {blocks.map((block, idx) => {
        switch (block.type) {
          case 'card':
            return (
              <RoleplayCard
                key={idx}
                title={block.meta?.title}
                badge={block.meta?.badge}
                icon={block.meta?.icon}
              >
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {block.content}
                </ReactMarkdown>
              </RoleplayCard>
            );

          case 'status':
            return <RoleplayStatusHud key={idx} raw={block.content} />;

          case 'thought':
            return (
              <ThoughtBlock key={idx} charName={characterName}>
                {block.content}
              </ThoughtBlock>
            );

          case 'ooc':
            return <OocBadge key={idx} text={block.content} />;

          case 'divider':
            return <SceneDivider key={idx} />;

          case 'text':
          default:
            return (
              <ReactMarkdown
                key={idx}
                remarkPlugins={[remarkGfm]}
                components={{
                  // Enhance text nodes to support inline dialogue highlighting and dice rolls
                  p: ({ children }) => {
                    return (
                      <p className="leading-relaxed">
                        {formatChildren(children, isNarratedParagraph(children))}
                      </p>
                    );
                  },
                  em: ({ children }) => (
                    <em className="rp-action">{formatChildren(children)}</em>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-ink">{formatChildren(children)}</strong>
                  ),
                  li: ({ children }) => <li>{formatChildren(children)}</li>,
                  blockquote: ({ children }) => (
                    <blockquote
                      style={{ borderColor: 'var(--rp-quote-rule)' }}
                      className="my-2 border-l-2 pl-3.5 font-serif italic text-ink-2"
                    >
                      {children}
                    </blockquote>
                  ),
                  code: ({ children }) => <code>{children}</code>,
                }}
              >
                {block.content}
              </ReactMarkdown>
            );
        }
      })}

      {isStreaming && <span aria-hidden className="streaming-cursor" />}
    </div>
  );
});
