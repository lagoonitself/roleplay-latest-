'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sparkles,
  Compass,
  Users,
  BookOpen,
  Settings,
  Plus,
  Flame,
  Sun,
  Moon,
  MessageSquare,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { SettingsDialog } from '@/components/settings-dialog';

export function Navbar() {
  const pathname = usePathname();
  const isChatPage = pathname.startsWith('/chat/');
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // If in active fullscreen chat, hide global header to avoid double navigation on mobile
  if (isChatPage) {
    return <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />;
  }

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-black/[0.06] dark:border-white/[0.08] glass-panel transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Left Brand */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2.5 group">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-accent to-purple-500 flex items-center justify-center shadow-md shadow-accent/20 group-hover:scale-105 transition-transform">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-sm tracking-tight flex items-center gap-1.5">
                  Cadenza
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-medium uppercase tracking-wider">
                    Roleplay
                  </span>
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links */}
            {!isChatPage && (
              <nav className="hidden md:flex items-center gap-1 text-xs font-medium">
                <Link
                  href="/"
                  className={`px-3 py-1.5 rounded-full transition-colors ${
                    pathname === '/'
                      ? 'bg-black/[0.06] dark:bg-white/[0.1] text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5" />
                    Explore
                  </span>
                </Link>
                <Link
                  href="/?tab=chats"
                  className="px-3 py-1.5 rounded-full transition-colors text-muted-foreground hover:text-foreground"
                >
                  <span className="flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5" />
                    My Chats
                  </span>
                </Link>
                <Link
                  href="/personas"
                  className={`px-3 py-1.5 rounded-full transition-colors ${
                    pathname === '/personas'
                      ? 'bg-black/[0.06] dark:bg-white/[0.1] text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    Personas
                  </span>
                </Link>
                <Link
                  href="/lorebooks"
                  className={`px-3 py-1.5 rounded-full transition-colors ${
                    pathname === '/lorebooks'
                      ? 'bg-black/[0.06] dark:bg-white/[0.1] text-foreground font-semibold'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5" />
                    Lorebooks
                  </span>
                </Link>
              </nav>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-2">
            <Link
              href="/c/new"
              className="px-3.5 py-1.5 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-medium apple-button flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Create Character</span>
              <span className="sm:hidden">New</span>
            </Link>

            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              className="p-2 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-muted-foreground hover:text-foreground apple-button w-8 h-8 flex items-center justify-center"
            >
              {mounted ? (
                theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
              ) : (
                <span className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              className="p-2 rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors text-muted-foreground hover:text-foreground apple-button"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
