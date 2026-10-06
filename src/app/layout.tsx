import type { Metadata, Viewport } from 'next';
import { Newsreader, Instrument_Sans } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Navbar } from '@/components/navbar';
import { PwaRegister } from '@/components/pwa-register';
import { Toaster } from 'sonner';

/* Two families, two clearly distinct jobs.
   Newsreader  — the voice: wordmark, page titles, all roleplay prose.
   Instrument Sans — the machine: controls, labels, metadata.

   Loaded as variable fonts: one file per style instead of one per weight
   (3 requests, not 9), and intermediate weights like 550 are real rather
   than synthesised. */
const newsreader = Newsreader({
  variable: '--font-newsreader',
  subsets: ['latin'],
  style: ['normal', 'italic'],
  weight: 'variable',
  display: 'swap',
});

const instrumentSans = Instrument_Sans({
  variable: '--font-instrument',
  subsets: ['latin'],
  weight: 'variable',
  display: 'swap',
});

export const viewport: Viewport = {
  // Dark is the house default: the PWA chrome reads black before hydration.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#f5f5f3' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Cadenza — AI Roleplay Studio',
  description:
    'A private stage for long-form AI roleplay. Layered memory, SillyTavern-style prompt control, and character cards from Janitor AI and Chub.',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Cadenza',
  },
  formatDetection: {
    telephone: false,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${newsreader.variable} ${instrumentSans.variable} h-full`}
    >
      <head>
        {/* Explicit iOS PWA tags: older iOS ignores the generated
            apple-touch-icon / appleWebApp metadata, SVG is never a valid
            home-screen icon, and telephone detection mangles story text. */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* format-detection renders from metadata.formatDetection above. */}
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <PwaRegister />
          <Navbar />
          <main className="flex-1 flex flex-col">{children}</main>
          <Toaster
            position="top-center"
            toastOptions={{
              style: {
                background: 'var(--surface-raised)',
                border: '1px solid var(--line)',
                color: 'var(--ink)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-float)',
                fontFamily: 'var(--font-sans)',
                fontSize: '0.8125rem',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  );
}
