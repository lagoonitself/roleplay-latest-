'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

/**
 * Theme shell. Dark is the house default — see globals.css.
 * `storageKey` keeps the choice stable across reloads and PWA launches.
 */
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider storageKey="cadenza-theme" defaultTheme="dark" {...props}>
      {children}
    </NextThemesProvider>
  );
}
