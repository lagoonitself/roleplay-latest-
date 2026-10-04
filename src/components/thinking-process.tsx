'use client';

import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, ChevronDown, Clock, Copy, Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface ThinkingProcessProps {
  reasoning?: string | null;
  isStreaming: boolean;
  hasContent: boolean;
  durationSeconds?: number;
  characterName?: string;
}

export function ThinkingProcess({
  reasoning,
  isStreaming,
  hasContent,
  durationSeconds,
  characterName,
}: ThinkingProcessProps) {
  // If the user explicitly clicked expand/collapse, store their override.
  // Otherwise, default: OPEN while actively thinking without content, COLLAPSED once content appears or done.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const startTimestampRef = useRef<number | null>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);

  // Active thinking phase: currently streaming and content has not started yet
  const isActivelyThinking = isStreaming && !hasContent;

  // Live timer while actively thinking (stops immediately when content starts)
  useEffect(() => {
    if (isActivelyThinking) {
      if (!startTimestampRef.current) {
        startTimestampRef.current = Date.now();
      }
      const interval = setInterval(() => {
        if (startTimestampRef.current) {
          const seconds = Math.max(1, Math.round((Date.now() - startTimestampRef.current) / 1000));
          setElapsedSeconds(seconds);
        }
      }, 500);

      return () => clearInterval(interval);
    }
  }, [isActivelyThinking]);

  // Auto-scroll thought content as new tokens stream in
  useEffect(() => {
    if (isActivelyThinking && reasoning) {
      contentEndRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, [isActivelyThinking, reasoning]);

  // Determine whether disclosure is currently open:
  // While actively thinking without content, default to open.
  // Once content arrives or stream ends, default to collapsed.
  // User toggle overrides this until generation state shifts.
  const isOpen = userToggled !== null ? userToggled : isActivelyThinking;

  const handleToggle = () => {
    setUserToggled(!isOpen);
  };

  const handleCopyThoughts = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!reasoning) return;
    navigator.clipboard.writeText(reasoning);
    setCopied(true);
    toast.success('Reasoning copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const effectiveDuration = durationSeconds || (isStreaming ? elapsedSeconds : elapsedSeconds || 0);

  // If generation is complete and there's no reasoning, render nothing
  if (!reasoning && !isStreaming) {
    return null;
  }

  // 1. Initial pending state: streaming has started, but no tokens (neither reasoning nor content) arrived yet
  if (isStreaming && !reasoning && !hasContent) {
    return (
      <div className="w-full my-1.5 p-3 rounded-2xl bg-purple-500/[0.04] dark:bg-purple-500/[0.07] border border-purple-500/20 transition-all animate-in fade-in duration-200">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-medium">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500" />
            </span>
            <Brain className="w-4 h-4 animate-pulse" />
            <span>Thinking...</span>
            <span className="text-[11px] font-mono text-muted-foreground">
              {elapsedSeconds}s
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500/50 animate-bounce" />
          </div>
        </div>
      </div>
    );
  }

  // If there's no reasoning text yet but content has already started, don't show an empty reasoning card
  if (!reasoning) {
    return null;
  }

  // 2. Main Thinking Process Component (Live streaming or Collapsed disclosure widget)
  return (
    <div className="w-full my-1.5 transition-all duration-200 select-none">
      {/* Disclosure Toggle Header */}
      <button
        type="button"
        onClick={handleToggle}
        className={`w-full flex items-center justify-between px-3.5 py-2 rounded-xl text-left text-xs transition-all apple-button border ${
          isActivelyThinking
            ? 'bg-purple-500/[0.08] dark:bg-purple-500/[0.12] border-purple-500/30 text-purple-700 dark:text-purple-300 shadow-xs'
            : 'bg-black/[0.025] dark:bg-white/[0.035] hover:bg-black/[0.045] dark:hover:bg-white/[0.06] border-black/[0.06] dark:border-white/[0.08] text-muted-foreground hover:text-foreground'
        }`}
        title={isOpen ? 'Click to collapse thoughts' : characterName ? `Click to view ${characterName}'s thought process` : 'Click to view thought process'}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <Brain
              className={`w-3.5 h-3.5 ${
                isActivelyThinking
                  ? 'text-purple-600 dark:text-purple-400 animate-pulse'
                  : 'text-purple-500/80'
              }`}
            />
            {isActivelyThinking && (
              <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping" />
            )}
          </div>

          <span className="font-medium tracking-tight truncate">
            {isActivelyThinking
              ? 'Thinking...'
              : effectiveDuration > 0
              ? `Thought for ${effectiveDuration} second${effectiveDuration === 1 ? '' : 's'}`
              : characterName
              ? `${characterName}'s thoughts`
              : 'Thought process'}
          </span>

          {isActivelyThinking && (
            <span className="text-[11px] font-mono px-1.5 py-0.2 rounded-full bg-purple-500/15 text-purple-600 dark:text-purple-300 font-semibold shrink-0">
              {elapsedSeconds}s
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isOpen && !isActivelyThinking && (
            <span
              onClick={handleCopyThoughts}
              className="p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Copy thought process"
            >
              {copied ? (
                <Check className="w-3 h-3 text-emerald-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </span>
          )}

          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-200 ease-out ${
              isOpen ? 'transform rotate-180 text-foreground' : ''
            }`}
          />
        </div>
      </button>

      {/* Expanded Thought Stream & Markdown Content */}
      {isOpen && (
        <div className="mt-1.5 p-3.5 sm:p-4 rounded-2xl bg-purple-500/[0.03] dark:bg-purple-500/[0.06] border border-purple-500/20 text-xs sm:text-[13px] leading-relaxed text-muted-foreground dark:text-muted-foreground select-text transition-all animate-in fade-in duration-200">
          {/* Header indicator when expanded in post-generation state */}
          {!isActivelyThinking && (
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-purple-500/15 text-[11px] text-purple-700/80 dark:text-purple-300/80">
              <div className="flex items-center gap-1.5 font-medium">
                <Sparkles className="w-3 h-3 text-purple-500" />
                <span>{characterName ? `${characterName}'s Reasoning Chain` : 'Internal Reasoning Chain'}</span>
              </div>
              {effectiveDuration > 0 && (
                <div className="flex items-center gap-1 font-mono text-[10px] opacity-80">
                  <Clock className="w-3 h-3" />
                  <span>{effectiveDuration}s elapsed</span>
                </div>
              )}
            </div>
          )}

          {/* Thought Text */}
          <div className="max-h-80 overflow-y-auto pr-1 font-mono text-[12px] sm:text-[12.5px] leading-relaxed space-y-1.5 whitespace-pre-wrap select-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {reasoning}
            </ReactMarkdown>

            {isActivelyThinking && (
              <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-purple-500/80 animate-pulse align-middle rounded-xs" />
            )}
            <div ref={contentEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
