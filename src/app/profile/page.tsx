'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ProfileView } from '@/components/profile/profile-view';
import { MobileDock, type AppTab } from '@/components/mobile-dock';
import { SettingsDialog } from '@/components/settings-dialog';
import { useRouter } from 'next/navigation';

/**
 * Dedicated Profile route — same full section as the dock Profile tab.
 * Deep-linkable PWA destination; raw token counts only.
 */
export default function ProfilePage() {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleTabChange = (tab: AppTab) => {
    if (tab === 'profile') return;
    if (tab === 'create') {
      router.push('/?tab=explore');
      return;
    }
    router.push(tab === 'explore' ? '/' : `/?tab=${tab}`);
  };

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 pt-4 sm:px-6">
        <Link
          href="/"
          className="icon-btn"
          aria-label="Back to home"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="type-page">Profile</h1>
          <p className="type-meta">Your account, personas, and usage</p>
        </div>
      </div>

      <ProfileView onOpenSettingsDialog={() => setSettingsOpen(true)} />

      <MobileDock activeTab="profile" onTabChange={handleTabChange} />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
