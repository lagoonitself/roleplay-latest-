'use client';

import { useEffect, useState } from 'react';

/** Below this, a shrunken visual viewport is browser chrome, not a keyboard. */
const KEYBOARD_THRESHOLD_PX = 120;

/**
 * Tracks the on-screen keyboard through the visual viewport.
 *
 * iOS doesn't shrink `100dvh` when the keyboard opens: it scrolls the page
 * instead, pushing a full-height layout's header off screen and leaving the
 * bottom safe-area padding stranded above the keyboard. Sizing the layout to
 * the returned `height` while the keyboard is up keeps the header, transcript
 * and composer all on screen.
 */
export function useKeyboardViewport(): { keyboardOpen: boolean; height: number | null } {
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // Pinch-zoom also shrinks the visual viewport; only count it at 1x.
      const open = vv.scale < 1.01 && window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX;
      setHeight(open ? Math.round(vv.height) : null);
      // Undo the scroll iOS applies to bring the focused field into view; the
      // resized layout already keeps it visible.
      if (open && window.scrollY !== 0) window.scrollTo(0, 0);
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return { keyboardOpen: height !== null, height };
}
