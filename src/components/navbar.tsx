'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus, Sun, Moon, Settings } from 'lucide-react';
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

  const links = [
    { href: '/', label: 'Explore', active: pathname === '/' },
    { href: '/?tab=chats', label: 'My chats', active: false },
    { href: '/personas', label: 'Personas', active: pathname === '/personas' },
    {
      href: '/duo',
      label: 'Duo',
      active: pathname === '/duo' || pathname.startsWith('/duo/'),
    },
    { href: '/lorebooks', label: 'Lorebooks', active: pathname === '/lorebooks' },
  ];

  return (
    <>
      <header className="bg-background sticky top-0 z-40 w-full border-b border-line pt-safe">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          {/* Left Brand */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-baseline gap-2">
              <span className="type-display text-xl leading-none">Cadenza</span>
              <span className="chip chip-accent">Roleplay</span>
            </Link>

            {/* Desktop Navigation Links */}
            {!isChatPage && (
              <nav className="hidden items-center gap-5 md:flex" aria-label="Primary">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={link.active ? 'page' : undefined}
                    className={`relative py-2 text-[13px] transition-colors ${
                      link.active ? 'text-ink font-medium' : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    {link.label}
                    {link.active && (
                      <span
                        aria-hidden="true"
                        className="bg-accent-line absolute inset-x-0 -bottom-[1px] h-px"
                      />
                    )}
                  </Link>
                ))}
              </nav>
            )}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1.5">
            <Link href="/c/new" className="btn btn-ghost text-xs">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Create character</span>
              <span className="sm:hidden">New</span>
            </Link>

            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
              className="icon-btn"
            >
              {mounted ? (
                theme === 'dark' ? (
                  <Sun className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden="true" />
                )
              ) : (
                <span className="h-4 w-4" />
              )}
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
              className="icon-btn"
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
