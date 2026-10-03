'use client';

import React from 'react';
import { Compass, MessageSquare, Plus, User, Sparkles } from 'lucide-react';

export type AppTab = 'explore' | 'chats' | 'create' | 'profile';

interface MobileDockProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  totalChatsCount?: number;
}

export function MobileDock({ activeTab, onTabChange, totalChatsCount = 0 }: MobileDockProps) {
  return (
    <nav
      aria-label="App Navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex justify-center pointer-events-none pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] px-4"
    >
      <div className="pointer-events-auto flex items-center gap-1.5 p-1.5 rounded-full bg-[#1c1c1f]/90 dark:bg-[#121214]/90 backdrop-blur-2xl border border-white/[0.12] shadow-2xl shadow-black/60 transition-all">
        {/* Tab 1: Explore / Home */}
        <button
          onClick={() => onTabChange('explore')}
          className={`flex items-center justify-center w-12 h-12 rounded-full transition-all apple-button ${
            activeTab === 'explore'
              ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-white/10'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="Explore Characters"
          aria-label="Explore"
        >
          <Compass className="w-5 h-5" />
        </button>

        {/* Tab 2: My Chats (Matches JanitorAI signature spiral/chat pill) */}
        <button
          onClick={() => onTabChange('chats')}
          className={`relative flex items-center justify-center w-14 h-12 rounded-full transition-all apple-button ${
            activeTab === 'chats'
              ? 'bg-[#2a2438] text-purple-300 ring-1 ring-purple-500/30 shadow-inner'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="My Chats"
          aria-label="My Chats"
        >
          {/* Custom spiral / roleplay swirl icon resembling JanitorAI's iconic spiral */}
          <div className="relative flex items-center justify-center">
            <svg
              className={`w-6 h-6 transition-transform ${activeTab === 'chats' ? 'scale-105' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 16a6 6 0 1 1 6-6 6 6 0 0 1-6 6zm0-8a2 2 0 1 0 2 2 2 2 0 0 0-2-2z" />
            </svg>
            {totalChatsCount > 0 && (
              <span className="absolute -top-1 -right-2 px-1.5 py-0.2 rounded-full bg-purple-600 text-white font-bold text-[9px] min-w-[16px] text-center border border-black/40">
                {totalChatsCount > 99 ? '99+' : totalChatsCount}
              </span>
            )}
          </div>
        </button>

        {/* Tab 3: Create Character / Import Card */}
        <button
          onClick={() => onTabChange('create')}
          className={`flex items-center justify-center w-12 h-12 rounded-full transition-all apple-button ${
            activeTab === 'create'
              ? 'bg-purple-600 text-white shadow-md shadow-purple-600/30'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="Create Character or Import Card"
          aria-label="Create or Import"
        >
          <Plus className="w-5 h-5" />
        </button>

        {/* Tab 4: Personas & Settings Profile */}
        <button
          onClick={() => onTabChange('profile')}
          className={`flex items-center justify-center w-12 h-12 rounded-full transition-all apple-button ${
            activeTab === 'profile'
              ? 'bg-zinc-800 text-white shadow-sm ring-1 ring-white/10'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
          title="Personas & Settings"
          aria-label="Profile"
        >
          <User className="w-5 h-5" />
        </button>
      </div>
    </nav>
  );
}
