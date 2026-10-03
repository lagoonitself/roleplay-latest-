'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus, Upload, Sparkles, X, BookOpen, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';

interface CreateDrawerProps {
  open: boolean;
  onClose: () => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenImportGuide?: () => void;
}

export function CreateDrawer({ open, onClose, onImportFile, onOpenImportGuide }: CreateDrawerProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative z-10 w-full max-w-md bg-[#18181b] dark:bg-[#121214] text-white rounded-t-[2.25rem] border-t border-white/[0.12] shadow-2xl p-6 space-y-4 animate-in slide-in-from-bottom duration-300 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-1.5 rounded-full bg-zinc-600/60 mx-auto -mt-2" />

        <div className="flex items-center justify-between pb-1">
          <div>
            <h3 className="font-bold text-base tracking-tight">Create or Import</h3>
            <p className="text-xs text-zinc-400">Add a new partner to your roleplay universe</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {/* Action 1: Create Character from scratch */}
          <Link
            href="/c/new"
            onClick={onClose}
            className="group flex items-center justify-between p-4 rounded-2xl bg-zinc-800/60 hover:bg-zinc-800 border border-white/[0.06] transition-all apple-button"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-purple-600/20 text-purple-400 flex items-center justify-center border border-purple-500/25 shrink-0 group-hover:scale-105 transition-transform">
                <UserPlus className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-sm text-zinc-100 group-hover:text-purple-300 transition-colors">
                  Create Character
                </h4>
                <p className="text-xs text-zinc-400">
                  Full custom studio with personality, scenario & greeting
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
          </Link>

          {/* Action 2: Import Janitor / Chub card */}
          <button
            onClick={() => {
              fileInputRef.current?.click();
            }}
            className="w-full group flex items-center justify-between p-4 rounded-2xl bg-zinc-800/60 hover:bg-zinc-800 border border-white/[0.06] transition-all text-left apple-button"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-2xl bg-blue-600/20 text-blue-400 flex items-center justify-center border border-blue-500/25 shrink-0 group-hover:scale-105 transition-transform">
                <Upload className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-sm text-zinc-100 group-hover:text-blue-300 transition-colors">
                  Import Card (PNG / JSON)
                </h4>
                <p className="text-xs text-zinc-400">
                  Directly drop Janitor AI, Chub AI or Tavern cards
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json, .png, image/png, application/json"
            onChange={(e) => {
              onImportFile(e);
              onClose();
            }}
            className="hidden"
          />
        </div>

        {/* Import guide button */}
        {onOpenImportGuide && (
          <div className="pt-1 text-center">
            <button
              onClick={() => {
                onClose();
                onOpenImportGuide();
              }}
              className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-purple-300 transition-colors"
            >
              <BookOpen className="w-3.5 h-3.5" />
              How do I export cards from Janitor AI?
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
