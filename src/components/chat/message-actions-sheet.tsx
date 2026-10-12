'use client';

import React from 'react';
import { Copy, Edit2, RotateCcw, Trash2, X } from 'lucide-react';
import type { Message } from '@/lib/supabase/types';
import { Sheet } from '@/components/ui/sheet';

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
  /** Optional explicit open state for callers controlling visibility directly. */
  open?: boolean;
}

const ACTION_ROW_CLASS =
  'flex min-h-[52px] w-full items-center gap-3 px-4 text-left row-press touch-manipulation transition-colors duration-150';

/**
 * MessageActionsSheet — the mobile bottom sheet behind a transcript row's `⋯`.
 *
 * Uses `<Sheet>` (vaul) portaled to <body> so transformed parent containers
 * cannot interfere with positioning. Actions follow the iOS grouped action-sheet
 * pattern with 52px minimum height, row-press touch feedback, and destructive
 * actions in an isolated group.
 */
export function MessageActionsSheet({
  message,
  onCopy,
  onEdit,
  onRegenerate,
  onDelete,
  onClose,
  open,
}: MessageActionsSheetProps) {
  // Keep showing the last message while the sheet animates closed (the
  // parent clears `message` the moment it closes).
  const [lastMessage, setLastMessage] = React.useState(message);
  if (message && message !== lastMessage) setLastMessage(message);
  const displayMessage = message ?? lastMessage;

  const isOpen = open !== undefined ? open && Boolean(displayMessage) : Boolean(message);
  const isAssistant = displayMessage?.role === 'assistant';
  const hasContent = (displayMessage?.content?.trim().length ?? 0) > 0;

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={displayMessage ? (isAssistant ? 'Character response' : 'Your message') : 'Message'}
      description={
        hasContent ? (
          <span className="line-clamp-2 break-words block">{displayMessage?.content}</span>
        ) : undefined
      }
      hideClose
      size="auto"
      bodyClassName="space-y-2.5 px-4 pb-4"
    >
      {!displayMessage ? null : (
        <>
          <div className="surface divide-y divide-line overflow-hidden">
            <button
              type="button"
              onClick={act(() => {
                if (displayMessage.content) onCopy(displayMessage.content);
              })}
              disabled={!hasContent}
              className={`${ACTION_ROW_CLASS} text-ink disabled:opacity-40 disabled:pointer-events-none`}
            >
              <Copy className="h-5 w-5 text-ink-2 shrink-0" aria-hidden="true" />
              <span className="text-[15px] font-medium">Copy message</span>
            </button>

            <button type="button" onClick={act(onEdit)} className={`${ACTION_ROW_CLASS} text-ink`}>
              <Edit2 className="h-5 w-5 text-ink-2 shrink-0" aria-hidden="true" />
              <span className="text-[15px] font-medium">
                {isAssistant ? 'Edit' : 'Edit and regenerate from here'}
              </span>
            </button>

            {isAssistant && (
              <button
                type="button"
                onClick={act(onRegenerate)}
                className={`${ACTION_ROW_CLASS} text-ink`}
              >
                <RotateCcw className="h-5 w-5 text-ink-2 shrink-0" aria-hidden="true" />
                <span className="text-[15px] font-medium">Regenerate response</span>
              </button>
            )}
          </div>

          <div className="surface divide-y divide-line overflow-hidden">
            <button
              type="button"
              onClick={act(onDelete)}
              className={`${ACTION_ROW_CLASS} text-danger`}
            >
              <Trash2 className="h-5 w-5 text-danger shrink-0" aria-hidden="true" />
              <span className="text-[15px] font-medium">Delete from here…</span>
            </button>
          </div>

          <div className="surface overflow-hidden">
            <button
              type="button"
              onClick={onClose}
              className={`${ACTION_ROW_CLASS} text-ink-2`}
            >
              <X className="h-5 w-5 text-ink-2 shrink-0" aria-hidden="true" />
              <span className="text-[15px] font-medium">Cancel</span>
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
