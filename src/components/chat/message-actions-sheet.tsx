'use client';

import React, { useEffect, useRef } from 'react';
import { Copy, Edit2, RotateCcw, Trash2, X } from 'lucide-react';
import type { Message } from '@/lib/supabase/types';

export interface MessageActionsSheetProps {
  /**
   * The transcript row the sheet acts on. `null` renders nothing — the page can
   * keep this mounted and pass `null` to close it.
   */
  message: Pick<Message, 'id' | 'role' | 'content'> | null;
  /** Copy `message.content` — same handler the rows pass to `MessageRow.onCopy`. */
  onCopy: (text: string) => void;
  /** Open the inline editor on this row (`MessageRow.onStartEdit`). */
  onEdit: () => void;
  /** Swap this response for a fresh one. Assistant rows only. */
  onRegenerate: () => void;
  /** Open the "delete from here" confirm on this row (`MessageRow.onDeleteRequest`). */
  onDelete: () => void;
  onClose: () => void;
}

const ROW_CLASS =
  'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-ink-2 transition-[color,background-color] duration-150 hover:bg-sunken hover:text-ink touch-manipulation';

/**
 * MessageActionsSheet — the mobile bottom sheet behind a transcript row's `⋯`.
 *
 * The whole point of the sheet is de-cluttering the transcript: instead of
 * stacking edit / delete / regenerate chrome on a 390px row, every action lives
 * behind one button and one modal list. Each row is ≥44px tall. The sheet
 * closes on backdrop tap, Escape, the Cancel row, or after firing an action.
 *
 * House sheet conventions (same as `create-drawer.tsx`): backdrop
 * `fixed inset-0 z-50 … bg-background/70 backdrop-blur-sm`, panel `panel` with
 * `rounded-t-3xl sm:rounded-2xl`, and the bottom safe-area padding so the last
 * row clears the home indicator (and the iOS keyboard, if one is up).
 */
export function MessageActionsSheet({
  message,
  onCopy,
  onEdit,
  onRegenerate,
  onDelete,
  onClose,
}: MessageActionsSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape dismisses; focus lands on the panel so keyboard users are inside
  // the dialog immediately. Both are inert while the sheet is closed.
  useEffect(() => {
    if (!message) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [message, onClose]);

  if (!message) return null;

  const isAssistant = message.role === 'assistant';
  const hasContent = message.content.trim().length > 0;
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-200"
      // Anchor to the *visual* viewport height when the shell publishes `--app-height`.
      // The outer page container already applies `translateY(var(--app-offset-top, 0px))`,
      // so we use top: 0 to prevent double-counting the offsetTop.
      style={{ top: 0, height: 'var(--app-height, 100dvh)' }}
    >
      {/* The backdrop is a real button — tap anywhere outside the sheet to dismiss. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Dismiss message actions"
        className="absolute inset-0 cursor-default touch-manipulation"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Message actions"
        tabIndex={-1}
        className="panel relative z-10 w-full max-w-md rounded-t-3xl border-t border-line p-3 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:rounded-2xl sm:p-4 animate-in slide-in-from-bottom duration-200"
      >
        {/* Which message this is acting on */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="type-label">{isAssistant ? 'Character response' : 'Your message'}</p>
            {hasContent && (
              <p className="type-meta mt-0.5 line-clamp-2 break-words">{message.content}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-btn shrink-0"
            aria-label="Close message actions"
          >
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        <div className="mt-2 space-y-0.5 border-t border-line pt-2">
          <button
            type="button"
            onClick={act(() => onCopy(message.content))}
            disabled={!hasContent}
            className={`${ROW_CLASS} disabled:opacity-40`}
          >
            <Copy className="w-4 h-4 text-ink-3" aria-hidden />
            Copy message
          </button>

          <button type="button" onClick={act(onEdit)} className={ROW_CLASS}>
            <Edit2 className="w-4 h-4 text-ink-3" aria-hidden />
            {isAssistant ? 'Edit' : 'Edit and regenerate from here'}
          </button>

          {isAssistant && (
            <button type="button" onClick={act(onRegenerate)} className={ROW_CLASS}>
              <RotateCcw className="w-4 h-4 text-ink-3" aria-hidden />
              Regenerate response
            </button>
          )}

          <button type="button" onClick={act(onDelete)} className={`${ROW_CLASS} text-danger hover:bg-danger-wash`}>
            <Trash2 className="w-4 h-4" aria-hidden />
            Delete from here…
          </button>
        </div>

        <div className="mt-2 border-t border-line pt-2">
          <button type="button" onClick={onClose} className={ROW_CLASS}>
            <X className="w-4 h-4 text-ink-3" aria-hidden />
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
