'use client';

import React from 'react';
import { Compass, MessagesSquare, Plus, User } from 'lucide-react';

export type AppTab = 'explore' | 'chats' | 'create' | 'profile';

interface MobileDockProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  totalChatsCount?: number;
}

const TABS: { id: AppTab; label: string; Icon: typeof Compass }[] = [
  { id: 'explore', label: 'Explore', Icon: Compass },
  { id: 'chats', label: 'Chats', Icon: MessagesSquare },
  { id: 'create', label: 'Create', Icon: Plus },
  { id: 'profile', label: 'Profile', Icon: User },
];

/**
 * iOS-style tab bar: full width, pinned to the bottom edge, icon over label,
 * home-indicator safe area included. Screens that render it add `.pb-dock`
 * to their scrolling content so nothing sits underneath it.
 */
export function MobileDock({ activeTab, onTabChange, totalChatsCount = 0 }: MobileDockProps) {
  return (
    <nav
      aria-label="App navigation"
      className="tabbar fixed inset-x-0 bottom-0 z-40 pb-safe pl-safe pr-safe md:hidden"
    >
      <div className="mx-auto flex h-[3.25rem] max-w-md items-stretch">
        {TABS.map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onTabChange(id)}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              className={`relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1 transition-colors active:opacity-60 ${
                active ? 'text-accent-text' : 'text-ink-3'
              }`}
            >
              <span className="relative">
                <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.1 : 1.7} aria-hidden="true" />
                {id === 'chats' && totalChatsCount > 0 && (
                  <span className="bg-accent text-accent-ink absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none font-semibold tabular-nums">
                    {totalChatsCount > 99 ? '99+' : totalChatsCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] leading-none font-medium">{label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
