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
  Heart,
  Zap,
  Coins,
  Copy,
  Check,
  Brain,
  MessageSquare,
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
 * Interactive Dice Roll Chip Component
 * Supports clicking to reroll with haptic toast and animation!
 */
function DiceRollChip({ formula }: { formula: string }) {
  const [currentRoll, setCurrentRoll] = useState(() => rollDice(formula));
  const [isRolling, setIsRolling] = useState(false);

  const handleReroll = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRolling(true);
    const next = rollDice(formula);
    setTimeout(() => {
      setCurrentRoll(next);
      setIsRolling(false);
      toast.success(`Rolled ${formula}: ${next.total} (${next.rolls.join(' + ')}${next.modifier ? (next.modifier > 0 ? ` + ${next.modifier}` : ` - ${Math.abs(next.modifier)}`) : ''})`);
    }, 200);
  };

  const modStr = currentRoll.modifier !== 0
    ? (currentRoll.modifier > 0 ? `+${currentRoll.modifier}` : `${currentRoll.modifier}`)
    : '';

  return (
    <span
      onClick={handleReroll}
      title={`Click to re-roll ${formula} (Current: ${currentRoll.rolls.join('+')}${modStr})`}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 my-0.5 mx-1 rounded-lg text-xs font-mono font-semibold border transition-all duration-200 cursor-pointer select-none align-middle shadow-2xs ${
        isRolling
          ? 'scale-95 bg-accent/25 border-accent text-accent animate-pulse'
          : 'bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 border-black/10 dark:border-white/15 text-foreground hover:scale-105'
      }`}
    >
      <Dices className={`w-3.5 h-3.5 text-accent ${isRolling ? 'animate-spin' : ''}`} />
      <span className="text-[11px] opacity-75">{formula}</span>
      <span className="text-accent font-bold">→ {currentRoll.total}</span>
      <RotateCcw className="w-2.5 h-2.5 opacity-40 hover:opacity-100 ml-0.5" />
    </span>
  );
}

/**
 * Custom Luxury Glass Roleplay Card Component (<card> or {{card}})
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
      navigator.clipboard.writeText(children);
      setCopied(true);
      toast.success('Card copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getIcon = () => {
    switch (icon?.toLowerCase()) {
      case 'shield':
      case 'armor':
        return <Shield className="w-4 h-4 text-sky-500" />;
      case 'quest':
      case 'scroll':
        return <Scroll className="w-4 h-4 text-amber-500" />;
      case 'award':
      case 'achievement':
        return <Award className="w-4 h-4 text-emerald-500" />;
      default:
        return <Sparkles className="w-4 h-4 text-accent" />;
    }
  };

  return (
    <div className="my-3 rounded-2xl p-4 glass-card border border-black/10 dark:border-white/10 shadow-sm relative overflow-hidden group">
      {/* Decorative gradient top edge */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-accent/60 via-purple-500/60 to-accent/60" />

      {/* Header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex items-center gap-2">
          {getIcon()}
          {title && <span className="font-semibold text-xs tracking-tight text-foreground">{title}</span>}
        </div>
        <div className="flex items-center gap-2">
          {badge && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-accent/15 text-accent border border-accent/20">
              {badge}
            </span>
          )}
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground transition-all"
            title="Copy card text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="text-xs text-foreground/90 leading-relaxed font-normal">{children}</div>
    </div>
  );
}

/**
 * RPG Status HUD with animated glowing progress bars
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
      <div className="my-2 p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.08] text-xs font-mono">
        <span className="font-bold text-accent">STATUS: </span>
        {raw}
      </div>
    );
  }

  return (
    <div className="my-3 p-3 sm:p-4 rounded-2xl glass-card border border-black/10 dark:border-white/10 shadow-xs space-y-2.5">
      <div className="flex items-center justify-between text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
        <span className="flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-accent" /> Character Vitals
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {stats.map((stat, idx) => {
          if (stat.type === 'gold') {
            return (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-medium"
              >
                <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                  <Coins className="w-3.5 h-3.5" /> Gold
                </span>
                <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                  {stat.current} G
                </span>
              </div>
            );
          }

          const pct = Math.min(Math.max((stat.current / (stat.max || 100)) * 100, 0), 100);
          const isHealth = stat.type === 'health';

          return (
            <div
              key={idx}
              className="p-2.5 rounded-xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.05] dark:border-white/[0.08] space-y-1.5"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1 font-semibold text-foreground/90">
                  {isHealth ? <Heart className="w-3.5 h-3.5 text-rose-500 fill-rose-500/20" /> : <Zap className="w-3.5 h-3.5 text-sky-500 fill-sky-500/20" />}
                  {stat.label}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground font-medium">
                  {stat.current}/{stat.max}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden relative">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isHealth
                      ? 'bg-gradient-to-r from-rose-500 to-red-400 shadow-[0_0_8px_rgba(244,63,94,0.4)]'
                      : 'bg-gradient-to-r from-sky-500 to-blue-400 shadow-[0_0_8px_rgba(14,165,233,0.4)]'
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
    <div className="my-2 rounded-xl overflow-hidden border border-purple-500/20 bg-purple-500/[0.03] dark:bg-purple-500/[0.06] transition-colors">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/[0.06] transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Brain className="w-3.5 h-3.5 opacity-80" />
          <span>{charName ? `${charName}'s Inner Thoughts` : 'Inner Monologue'}</span>
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 opacity-60" /> : <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
      </button>

      {open && (
        <div className="px-3.5 py-2.5 text-xs text-foreground/85 font-serif italic border-t border-purple-500/10 leading-relaxed animate-in fade-in duration-150">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Out-of-Character (OOC) Director Pill
 */
function OocBadge({ text }: { text: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 my-1.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.08] dark:border-white/[0.1] text-xs font-mono text-muted-foreground select-text">
      <span className="px-1 py-0.2 rounded text-[10px] font-bold bg-accent/15 text-accent uppercase tracking-wider">
        OOC
      </span>
      <span>{text}</span>
    </div>
  );
}

/**
 * Ornamental Roleplay Scene Divider
 */
function SceneDivider() {
  return (
    <div className="relative my-6 flex items-center justify-center">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-black/10 dark:border-white/10" />
      </div>
      <div className="relative px-3 bg-card text-muted-foreground">
        <Sparkles className="w-3.5 h-3.5 text-accent opacity-75" />
      </div>
    </div>
  );
}

/**
 * Main Roleplay Message Content Formatter
 */
export function RoleplayMessageContent({
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

  // Dynamic CSS variables for character dialogue hue
  const styleVars = useMemo(() => {
    if (accentColor && accentColor.startsWith('#')) {
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
   */
  const renderFormattedInlineText = (text: string) => {
    // If text has no special markers, render directly
    if (!text.includes('[[rp-')) {
      return text;
    }

    const inlineRegex = /\[\[rp-dialogue\]\]([\s\S]*?)\[\[\/rp-dialogue\]\]|\[\[rp-action\]\]([\s\S]*?)\[\[\/rp-action\]\]|\[\[rp-roll\s+formula="([^"]+)"\]\]/gi;

    const elements: React.ReactNode[] = [];
    let last = 0;
    let inlineMatch: RegExpExecArray | null;
    let keyIdx = 0;

    while ((inlineMatch = inlineRegex.exec(text)) !== null) {
      if (inlineMatch.index > last) {
        elements.push(text.slice(last, inlineMatch.index));
      }

      if (inlineMatch[1] !== undefined) {
        // Dialogue match
        elements.push(
          <span key={keyIdx++} className="rp-dialogue">
            <span className="opacity-70 select-none">“</span>
            {inlineMatch[1]}
            <span className="opacity-70 select-none">”</span>
          </span>
        );
      } else if (inlineMatch[2] !== undefined) {
        // Action prose match
        elements.push(
          <span key={keyIdx++} className="rp-action">
            {inlineMatch[2]}
          </span>
        );
      } else if (inlineMatch[3] !== undefined) {
        // Interactive Dice Roll
        elements.push(<DiceRollChip key={keyIdx++} formula={inlineMatch[3]} />);
      }

      last = inlineRegex.lastIndex;
    }

    if (last < text.length) {
      elements.push(text.slice(last));
    }

    return elements;
  };

  return (
    <div style={styleVars} className="roleplay-prose space-y-2 select-text">
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
                        {React.Children.map(children, (child) => {
                          if (typeof child === 'string') {
                            return renderFormattedInlineText(child);
                          }
                          return child;
                        })}
                      </p>
                    );
                  },
                  em: ({ children }) => (
                    <em className="rp-action font-serif italic opacity-90">{children}</em>
                  ),
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">{children}</strong>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="my-2 pl-3.5 border-l-2 border-accent/40 italic text-foreground/80 font-serif">
                      {children}
                    </blockquote>
                  ),
                  code: ({ children }) => (
                    <code className="px-1.5 py-0.5 rounded-md bg-black/5 dark:bg-white/10 font-mono text-[11px] text-accent">
                      {children}
                    </code>
                  ),
                }}
              >
                {block.content}
              </ReactMarkdown>
            );
        }
      })}

      {isStreaming && (
        <span className="inline-block w-1.5 h-4 ml-1 bg-accent animate-pulse align-middle" />
      )}
    </div>
  );
}
