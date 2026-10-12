'use client';

import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * useEvent — a callback with a stable identity that always sees the latest
 * render's closures. Passing fresh arrow functions into memoized children
 * defeats their memo; wrapping the handlers here keeps `React.memo` rows from
 * re-rendering on every composer keystroke or streaming frame.
 */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  // useCallback with empty deps gives a stable identity without reading a ref
  // during render (react-hooks/refs); the ref is only read when the handler
  // actually fires, so it always runs the latest closure.
  return useCallback((...args: A) => ref.current(...args), []);
}

/**
 * Keeps `--app-height` / `--app-offset-top` in sync with the visual viewport so
 * the chat shell fits the *visible* area on iOS, where the keyboard shrinks the
 * visual viewport without shrinking the layout viewport. Without this the
 * composer slides behind the keyboard in standalone PWA mode.
 */
export function useVisualViewportVars(): void {
  useLayoutEffect(() => {
    const vv = window.visualViewport;
    const root = document.documentElement;
    if (!vv) return;

    const apply = () => {
      root.style.setProperty('--app-height', `${Math.round(vv.height)}px`);
      root.style.setProperty('--app-offset-top', `${Math.round(vv.offsetTop)}px`);
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
      root.style.removeProperty('--app-height');
      root.style.removeProperty('--app-offset-top');
    };
  }, []);
}
