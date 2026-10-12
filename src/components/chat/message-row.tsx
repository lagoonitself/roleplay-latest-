'use client';

import React from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Edit2,
  GitBranch,
  MoreHorizontal,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { CharacterAvatar } from '@/components/character-avatar';
import { ThinkingProcess } from '@/components/thinking-process';
import { RoleplayMessageContent } from '@/components/chat/roleplay-message-content';
import type { RegexScript } from '@/lib/formatter/regex-engine';
import type { Character, Message, Persona } from '@/lib/supabase/types';

/**
 * ── Wiring contract — what the chat page must supply ────────────────────────
 *
 * MessageRow renders ONE transcript row (author line, prose or inline editor,
 * and its actions) and owns no page state. The page supplies:
 *
 * State (lifted to the page, one instance for the whole transcript):
 *   editingMsgId     — id of the row whose editor is open, else null.
 *   editingText      — the editor draft. Pass it ONLY for the editing row
 *                      (pass '' or a constant to every other row) so memoized
 *                      rows do not re-render on each keystroke.
 *   deleteConfirmId  — id of the row showing the delete-confirm bar.
 *   actionsHidden    — true for EVERY row while any one row is being edited,
 *                      showing the delete confirm, or has the mobile action
 *                      sheet (MessageActionsSheet) open. It suppresses all
 *                      action chrome so the active interaction is the only
 *                      thing on screen.
 *
 * Behaviors the page implements:
 *   Edit autoscroll   — after onStartEdit, scroll the editor into view:
 *                       document.querySelector('[data-msg-id="<id>"]')
 *                         ?.scrollIntoView({ block: 'center' }).
 *                       Every row root carries `data-msg-id` for this.
 *   Confirm auto-dismiss — the delete-confirm bar unmounts by itself after
 *                       8s (timer reset on each new deleteConfirmId; cleared
 *                       by the Keep / Delete buttons' handlers).
 *   Mobile actions    — onOpenActions(msg) opens MessageActionsSheet
 *                       (src/components/chat/message-actions-sheet.tsx) with
 *                       this message; its onEdit / onRegenerate / onDelete /
 *                       onCopy callbacks route to the same handlers below.
 *   Keyboard          — call `useVisualViewportVars()` once in the chat shell
 *                       so `--app-height` / `--app-offset-top` track the iOS
 *                       keyboard; MessageActionsSheet anchors to those vars so
 *                       it can never open behind the keyboard.
 *
 * Handlers (onStartEdit … onOpenActions) must be wrapped in `useEvent`
 * (src/lib/hooks.ts) so their identity is stable across renders — otherwise
 * every composer keystroke and streaming frame re-renders the whole
 * transcript and React.memo below is defeated.
 *
 * Streaming contract — a row with `status === 'streaming'` shows the
 * "Writing…" chip and NO action chrome (no swipe chevrons, no word count, no
 * ⋯). The swipe unit (chevrons + 1/3 counter) and the desktop strip appear
 * only when `showBar` is true: not editing, not confirming delete, not
 * hidden, not streaming, and not an empty failed row.
 *
 * `downstreamCount` = how many messages sit after this one; it sizes the
 * "Delete N messages" button and the editor's branch warning.
 */
export interface MessageRowProps {
  message: Message;
  index: number;
  /** How many messages sit after this one — the size of a "delete from here". */
  downstreamCount: number;
  character: Character | null;
  activePersona: Persona | null;
  regexScripts: RegexScript[];
  isGenerating: boolean;
  editingMsgId: string | null;
  editingText: string;
  deleteConfirmId: string | null;
  /** True while another row is being edited, confirmed or has the action sheet open. */
  actionsHidden: boolean;
  onStartEdit: (msg: Message) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditingTextChange: (text: string) => void;
  onDeleteRequest: (msgId: string) => void;
  onCancelDelete: () => void;
  onCopy: (text: string) => void;
  onRegenerate: (index: number) => void;
  onSwipe: (index: number, direction: 'prev' | 'next') => void;
  onOpenActions: (msg: Message) => void;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * One transcript row: author line, prose (or inline editor), and its actions.
 *
 * Memoized on props — the handlers passed in are identity-stable (see
 * `useEvent` in `src/lib/hooks.ts`), so composer keystrokes and streaming
 * frames no longer re-render every row of a long transcript.
 */
export const MessageRow = React.memo(function MessageRow({
  message,
  index,
  downstreamCount,
  character,
  activePersona,
  regexScripts,
  isGenerating,
  editingMsgId,
  editingText,
  deleteConfirmId,
  actionsHidden,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditingTextChange,
  onDeleteRequest,
  onCancelDelete,
  onCopy,
  onRegenerate,
  onSwipe,
  onOpenActions,
}: MessageRowProps) {
  const isAssistant = message.role === 'assistant';
  const swipes = message.meta?.swipes || [message.content];
  const swipeIndex = message.meta?.active_swipe_index ?? 0;
  const isFailed = message.status === 'error';
  const isStreamingMsg = message.status === 'streaming';
  const isEditing = editingMsgId === message.id;
  const isConfirmingDelete = deleteConfirmId === message.id;
  const charName = character?.name || 'Character';
  const userName = activePersona?.name || 'You';
  const showBar = !isEditing && !isConfirmingDelete && !actionsHidden && !isStreamingMsg && !(isFailed && !message.content);

  const deleteCount = downstreamCount + 1;
  const deleteLabel = downstreamCount > 0
    ? `Deletes this and the ${downstreamCount} after it`
    : `Deletes this ${isAssistant ? 'response' : 'message'}`;

  const editor = (
    <div className="surface w-full space-y-2.5 border-accent-line p-3 animate-in fade-in duration-150 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="type-label">
          {isAssistant ? 'Editing response' : 'Editing your message'}
        </span>
        <button type="button" onClick={onCancelEdit} className="icon-btn w-8 h-8" aria-label="Close editor">
          <X className="w-3.5 h-3.5" aria-hidden />
        </button>
      </div>

      {!isAssistant && downstreamCount > 0 && (
        <div className="flex items-start gap-1.5 px-0.5 type-meta">
          <GitBranch className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          <span>
            Saving deletes the {downstreamCount} message{downstreamCount === 1 ? '' : 's'} after this and writes a new reply.
          </span>
        </div>
      )}

      <textarea
        value={editingText}
        onChange={(e) => onEditingTextChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancelEdit();
          else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onSaveEdit();
        }}
        rows={isAssistant ? 5 : 4}
        className="field resize-y min-h-[7rem] text-sm leading-relaxed"
        placeholder={isAssistant ? 'Edit character response…' : 'Edit your message…'}
        aria-label={isAssistant ? 'Edit character response' : 'Edit your message'}
        autoFocus
      />

      <div className="flex items-center justify-between gap-2">
        <span className="type-meta hidden sm:inline">Ctrl + Enter to save, Esc to cancel</span>
        <div className="flex items-center gap-2 ml-auto">
          <button type="button" onClick={onCancelEdit} className="btn btn-quiet">
            Cancel
          </button>
          <button
            type="button"
            onClick={onSaveEdit}
            disabled={isGenerating || !editingText.trim()}
            className="btn btn-primary"
          >
            {isAssistant ? (
              <>
                <Check className="w-3.5 h-3.5" aria-hidden /> Save
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" aria-hidden />
                {downstreamCount > 0 ? 'Save and regenerate' : 'Save'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const deleteConfirm = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger-line bg-danger-wash px-3 py-2 text-danger animate-in fade-in slide-in-from-top-1 duration-150">
      <span className="mr-auto text-sm font-medium text-danger">{deleteLabel}</span>
      <button type="button" onClick={onCancelDelete} className="btn btn-quiet">
        Keep
      </button>
      <button type="button" onClick={() => onDeleteRequest(message.id)} className="btn btn-danger">
        <Trash2 className="w-3.5 h-3.5" aria-hidden />
        Delete {deleteCount} message{deleteCount === 1 ? '' : 's'}
      </button>
    </div>
  );

  const rowActions = (
    // Hover/focus reveal at sm:+ only. Below sm this is display:none, and the
    // ⋯ button takes over — nothing is ever invisible-but-tappable: while
    // opacity is 0 the strip is also pointer-events-none.
    <div className="hidden items-center gap-0.5 opacity-0 pointer-events-none transition-[opacity] duration-150 group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto sm:flex">
      {message.content && (
        <span className="type-meta mr-auto select-none pl-1">{countWords(message.content)} words</span>
      )}
      <button
        type="button"
        onClick={() => onCopy(message.content)}
        className="icon-btn"
        title="Copy message"
        aria-label="Copy message"
      >
        <Copy className="w-3.5 h-3.5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => onStartEdit(message)}
        disabled={isGenerating}
        className="icon-btn disabled:opacity-40"
        title={isAssistant ? 'Edit response' : 'Edit and regenerate from here'}
        aria-label={isAssistant ? 'Edit response' : 'Edit and regenerate from here'}
      >
        <Edit2 className="w-3.5 h-3.5" aria-hidden />
      </button>
      {isAssistant && (
        <button
          type="button"
          onClick={() => onRegenerate(index)}
          disabled={isGenerating}
          className="icon-btn disabled:opacity-40"
          title="Regenerate response"
          aria-label="Regenerate response"
        >
          <RotateCcw className="w-3.5 h-3.5" aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={() => onDeleteRequest(message.id)}
        disabled={isGenerating}
        className="icon-btn hover:text-danger disabled:opacity-40"
        title={`${deleteLabel} — delete from here`}
        aria-label={`${deleteLabel} — delete from here`}
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden />
      </button>
    </div>
  );

  const moreButton = (
    <button
      type="button"
      onClick={() => onOpenActions(message)}
      className="icon-btn sm:hidden"
      title="Message actions"
      aria-label="Message actions"
    >
      <MoreHorizontal className="w-4 h-4" aria-hidden />
    </button>
  );

  return (
    <div
      data-msg-id={message.id}
      className={`msg-row group flex flex-col ${isAssistant ? 'items-start' : 'items-end'}`}
    >
      {isAssistant ? (
        <div className="w-full space-y-1.5">
          {/* Author line, swipe versions, and the mobile action entry */}
          <div className="flex items-center gap-2 px-1">
            <div className="w-6 h-6 rounded-md overflow-hidden shrink-0 border border-line">
              <CharacterAvatar
                name={charName}
                avatarUrl={character?.avatar_url}
                accentColor={character?.accent_color}
                className="w-full h-full"
              />
            </div>
            <span className="text-xs font-medium text-ink-2 truncate">{charName}</span>

            {isStreamingMsg && (
              <span className="chip chip-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" aria-hidden />
                Writing…
              </span>
            )}

            <div className="ml-auto flex items-center gap-1">
              {/* Swipe unit and ⋯ follow the showBar contract: gone while this
                  row streams (chip only), edits, or confirms a delete. */}
              {showBar && swipes.length > 1 && (
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => onSwipe(index, 'prev')}
                    disabled={swipeIndex === 0}
                    className="icon-btn w-8 h-8 disabled:opacity-30"
                    aria-label="Previous version"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" aria-hidden />
                  </button>
                  <span className="type-meta tabular-nums">
                    {swipeIndex + 1}/{swipes.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => onSwipe(index, 'next')}
                    disabled={swipeIndex === swipes.length - 1}
                    className="icon-btn w-8 h-8 disabled:opacity-30"
                    aria-label="Next version"
                  >
                    <ChevronRight className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              )}
              {showBar && moreButton}
            </div>
          </div>

          {isEditing ? (
            editor
          ) : (
            <div className="w-full space-y-2">
              <ThinkingProcess
                reasoning={message.reasoning}
                isStreaming={isStreamingMsg}
                hasContent={Boolean(message.content && message.content.trim().length > 0)}
                durationSeconds={message.meta?.reasoning_duration_seconds}
                characterName={character?.name}
              />

              {isFailed && (
                <div
                  role="alert"
                  className="surface border-danger-line flex flex-col gap-2.5 rounded-lg p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-2">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-danger">This reply didn’t come through</p>
                      <p className="type-meta mt-0.5 break-words">
                        {message.meta?.error || 'The connection dropped before the reply finished.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 self-start sm:self-auto">
                    <button
                      type="button"
                      onClick={() => onRegenerate(index)}
                      disabled={isGenerating}
                      className="btn btn-ghost"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      Try again
                    </button>
                  </div>
                </div>
              )}

              {isFailed && !message.content ? null : (message.content || (!message.reasoning && !isStreamingMsg)) ? (
                <div className="prose-rp w-full max-w-[62ch] border-t border-line pt-3 select-text">
                  <RoleplayMessageContent
                    content={message.content}
                    characterName={charName}
                    userName={userName}
                    accentColor={character?.accent_color}
                    role="assistant"
                    isStreaming={isStreamingMsg}
                    scripts={regexScripts}
                  />
                </div>
              ) : (
                !message.content &&
                message.reasoning &&
                !isStreamingMsg && (
                  <div className="surface border-warn-line bg-warn-wash flex flex-col justify-between gap-2.5 p-3.5 sm:flex-row sm:items-center sm:p-4">
                    <div>
                      <p className="text-xs font-semibold text-warn">Response stopped after reasoning</p>
                      <p className="type-meta mt-0.5">The model finished thinking without writing any prose.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRegenerate(index)}
                      className="btn btn-ghost self-start sm:self-auto"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden />
                      <span>Regenerate</span>
                    </button>
                  </div>
                )
              )}
            </div>
          )}

          {isConfirmingDelete ? deleteConfirm : showBar && rowActions}
        </div>
      ) : (
        <div className="max-w-[85%] space-y-1 sm:max-w-[72%]">
          {/* Persona line and the mobile action entry */}
          <div className="flex items-center justify-end gap-1.5 px-1">
            {showBar && moreButton}
            {isStreamingMsg && (
              <span className="chip chip-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-soft" aria-hidden />
                Writing…
              </span>
            )}
            <span className="type-meta truncate">{userName}</span>
            <div className="w-5 h-5 rounded-md overflow-hidden shrink-0 border border-line">
              <CharacterAvatar name={userName} avatarUrl={activePersona?.avatar_url} className="w-full h-full" />
            </div>
          </div>

          {isEditing ? (
            editor
          ) : (
            <div className="rp-user-bubble prose-rp rounded-xl rounded-tr-sm px-3.5 py-3 select-text sm:px-4 text-[0.95rem] leading-[1.7]">
              <RoleplayMessageContent
                content={message.content}
                characterName={charName}
                userName={userName}
                role="user"
                scripts={regexScripts}
              />
            </div>
          )}

          {isConfirmingDelete ? deleteConfirm : showBar && rowActions}
        </div>
      )}
    </div>
  );
});
