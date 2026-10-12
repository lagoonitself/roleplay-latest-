'use client';

import React from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';

/**
 * The one bottom sheet. iOS-native feel: drag the grabber (or the sheet when
 * its body is scrolled to the top) to dismiss, rubber-banded edges, body
 * scroll locked underneath, inputs kept above the keyboard by vaul.
 *
 * On md+ it still slides from the bottom but is capped at `max-w-lg` and
 * centred, so desktop doesn't get a full-bleed strip.
 *
 * Usage:
 *   <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Create or import">
 *     …body…
 *   </Sheet>
 */
export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Visible heading. Always provide one — it labels the dialog for VoiceOver. */
  title: React.ReactNode;
  /** Optional one-line subtitle under the title. */
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Pinned below the scrolling body (primary actions). Gets safe-area padding. */
  footer?: React.ReactNode;
  /** `auto` hugs content (up to 92% of the screen); `tall` is always 92%. */
  size?: 'auto' | 'tall';
  /** Hide the close (X) button in the header. The grabber still dismisses. */
  hideClose?: boolean;
  /** Extra classes for the scrolling body. Default padding is `px-5 pb-5`. */
  bodyClassName?: string;
  /** Set false for sheets that must not be dismissed by drag/overlay tap. */
  dismissible?: boolean;
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'auto',
  hideClose = false,
  bodyClassName = 'px-5 pb-5',
  dismissible = true,
}: SheetProps) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} dismissible={dismissible} repositionInputs>
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-overlay fixed inset-0 z-50" />
        <Drawer.Content
          className={`sheet-content fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col outline-none ${
            size === 'tall' ? 'h-[92dvh]' : 'max-h-[92dvh]'
          }`}
        >
          <div className="flex shrink-0 justify-center pt-2 pb-1" aria-hidden="true">
            <div className="sheet-grabber" />
          </div>

          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-1 pb-3">
            <div className="min-w-0">
              <Drawer.Title className="type-sec text-base">{title}</Drawer.Title>
              {description ? (
                <Drawer.Description className="mt-0.5 text-xs text-ink-2">{description}</Drawer.Description>
              ) : (
                <Drawer.Description className="sr-only">{typeof title === 'string' ? title : 'Sheet'}</Drawer.Description>
              )}
            </div>
            {!hideClose && (
              <Drawer.Close aria-label="Close" className="icon-btn -mt-1 -mr-2 shrink-0">
                <X className="h-5 w-5" aria-hidden="true" />
              </Drawer.Close>
            )}
          </div>

          <div
            className={`scroll-y min-h-0 flex-1 ${bodyClassName} ${
              footer ? '' : 'pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)]'
            }`}
          >
            {children}
          </div>

          {footer && (
            <div className="shrink-0 border-t border-line px-5 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
              {footer}
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
