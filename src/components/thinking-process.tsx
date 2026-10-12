'use client';

import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, ChevronDown, Clock, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface ThinkingProcessProps {
  reasoning?: string | null;
  isStreaming: boolean;
  hasContent: boolean;
  durationSeconds?: number;
  characterName?: string;
}

/**
 * Collapsible reasoning disclosure.
 *
 * Memoised so completed turns do not re-render while a sibling turn streams.
 */
export const ThinkingProcess = React.memo(function ThinkingProcess({
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
      // Start fresh per thinking phase — a regenerated or continued reply must
      // not inherit the previous run's start timestamp.
      startTimestampRef.current = Date.now();
      const reset = setTimeout(() => setElapsedSeconds(0), 0);
      const interval = setInterval(() => {
        if (startTimestampRef.current) {
          const seconds = Math.max(1, Math.round((Date.now() - startTimestampRef.current) / 1000));
          setElapsedSeconds(seconds);
        }
      }, 500);

      return () => {
        clearTimeout(reset);
        clearInterval(interval);
      };
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
    navigator.clipboard
      ?.writeText(reasoning)
      .then(() => {
        setCopied(true);
        toast.success('Reasoning copied to clipboard');
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error('Could not copy to clipboard'));
  };

  const effectiveDuration = durationSeconds || (isStreaming ? elapsedSeconds : elapsedSeconds || 0);

  // If generation is complete and there's no reasoning, render nothing
  if (!reasoning && !isStreaming) {
    return null;
  }

  // 1. Initial pending state: streaming has started, but no tokens (neither reasoning nor content) arrived yet
  if (isStreaming && !reasoning && !hasContent) {
    return (
      <div className="w-full my-1.5 animate-in fade-in duration-150 select-none">
        <div className="flex items-center gap-2 px-1 py-1">
          <Brain className="w-3.5 h-3.5 text-ink-3 shrink-0" aria-hidden />
          <span className="type-meta">Thinking…</span>
          {elapsedSeconds > 0 && (
            <span className="type-meta font-mono">{elapsedSeconds}s</span>
          )}
          <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" aria-hidden />
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
    <div className="w-full my-1.5 select-none">
      {/* Disclosure Toggle Header */}
      <div className="flex w-full items-center gap-1">
        <button
          type="button"
          onClick={handleToggle}
          aria-expanded={isOpen}
          aria-label={isOpen ? 'Collapse thoughts' : characterName ? `View ${characterName}’s thoughts` : 'View thoughts'}
          className="btn btn-quiet flex-1 justify-between px-2 py-1.5 text-xs"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Brain className="w-3.5 h-3.5 text-ink-3 shrink-0" aria-hidden />
            <span className="type-meta truncate">
              {isActivelyThinking
                ? 'Thinking…'
                : effectiveDuration > 0
                ? `Thought for ${effectiveDuration}s`
                : characterName
                ? `${characterName}’s thoughts`
                : 'Thoughts'}
            </span>
            {isActivelyThinking ? (
              <span className="streaming-cursor" aria-hidden />
            ) : (
              effectiveDuration > 0 &&
              isOpen && (
                <span className="type-meta font-mono shrink-0">{effectiveDuration}s</span>
              )
            )}
          </span>

          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        {/* Sibling of the toggle: interactive controls must not nest inside a button */}
        {isOpen && !isActivelyThinking && (
          <button
            type="button"
            onClick={handleCopyThoughts}
            className="icon-btn w-8 h-8 shrink-0"
            title="Copy thoughts"
            aria-label="Copy thoughts"
          >
            {copied ? (
              <Check className="w-3 h-3" aria-hidden />
            ) : (
              <Copy className="w-3 h-3" aria-hidden />
            )}
          </button>
        )}
      </div>

      {/* Expanded Thought Stream & Markdown Content */}
      {isOpen && (
        <div className="well mt-1.5 p-3 animate-in fade-in duration-150">
          {/* Header indicator when expanded in post-generation state */}
          {!isActivelyThinking && (
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-line">
              <span className="type-meta">
                {characterName ? `${characterName}’s reasoning` : 'Reasoning'}
              </span>
              {effectiveDuration > 0 && (
                <span className="type-meta font-mono flex items-center gap-1">
                  <Clock className="w-3 h-3" aria-hidden />
                  {effectiveDuration}s
                </span>
              )}
            </div>
          )}

          {/* Thought Text */}
          <div className="type-code text-ink-2 max-h-80 overflow-y-auto pr-1 whitespace-pre-wrap select-text">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {reasoning}
            </ReactMarkdown>

            {isActivelyThinking && (
              <span className="streaming-cursor" aria-hidden />
            )}
            <div ref={contentEndRef} />
          </div>
        </div>
      )}
    </div>
  );
});
