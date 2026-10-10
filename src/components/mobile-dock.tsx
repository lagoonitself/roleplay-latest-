'use client';

import React from 'react';
import { Compass, MessagesSquare, Plus, User } from 'lucide-react';

export type AppTab = 'explore' | 'chats' | 'create' | 'profile';

interface MobileDockProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  totalChatsCount?: number;
}

export function MobileDock({ activeTab, onTabChange, totalChatsCount = 0 }: MobileDockProps) {
  const tabClass = (active: boolean) =>
    `flex h-12 w-12 items-center justify-center rounded-full transition-colors ${
      active ? 'text-accent-text bg-accent-wash' : 'text-ink-3 hover:text-ink'
    }`;

  return (
    <nav
      aria-label="App Navigation"
      className="pointer-events-none fixed right-0 bottom-0 left-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:hidden"
    >
      <div className="panel bg-raised pointer-events-auto flex items-center gap-1 rounded-full border-line px-2 py-1.5 shadow-float">
        {/* Tab 1: Explore / Home */}
        <button
          onClick={() => onTabChange('explore')}
          className={tabClass(activeTab === 'explore')}
          title="Explore Characters"
          aria-label="Explore"
        >
          <Compass className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* Tab 2: My Chats */}
        <button
          onClick={() => onTabChange('chats')}
          className={`relative ${tabClass(activeTab === 'chats')}`}
          title="My Chats"
          aria-label="My Chats"
        >
          <MessagesSquare className="h-5 w-5" aria-hidden="true" />
          {totalChatsCount > 0 && (
            <span className="chip chip-accent absolute -top-1 -right-1 min-w-[18px] justify-center px-1 tabular-nums">
              {totalChatsCount > 99 ? '99+' : totalChatsCount}
            </span>
          )}
        </button>

        {/* Tab 3: Create Character / Import Card */}
        <button
          onClick={() => onTabChange('create')}
          className={tabClass(activeTab === 'create')}
          title="Create Character or Import Card"
          aria-label="Create or Import"
        >
          <Plus className="h-5 w-5" aria-hidden="true" />
        </button>

        {/* Tab 4: Dedicated Profile section (account, personas, token usage) */}
        <button
          onClick={() => onTabChange('profile')}
          className={tabClass(activeTab === 'profile')}
          title="Profile"
          aria-label="Profile"
        >
          <User className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
