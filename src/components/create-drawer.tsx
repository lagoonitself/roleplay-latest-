'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus, Upload, X, BookOpen, ChevronRight } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="panel bg-raised relative z-10 w-full max-w-md space-y-4 rounded-t-3xl rounded-b-none border-x-0 border-b-0 border-t border-line p-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] animate-in slide-in-from-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-line-strong mx-auto -mt-2 h-1.5 w-12 rounded-full" />

        <div className="flex items-center justify-between pb-1">
          <div>
            <h3 className="type-sec text-base">Create or import</h3>
            <p className="mt-0.5 text-xs text-ink-2">Add a new character to your library</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="icon-btn">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {/* Action 1: Create Character from scratch */}
          <Link
            href="/c/new"
            onClick={onClose}
            className="group flex items-center justify-between gap-3 p-4 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
          >
            <div className="flex min-w-0 items-center gap-3.5">
              <UserPlus className="h-5 w-5 shrink-0 text-ink-2" aria-hidden="true" />
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-ink">Create character</h4>
                <p className="mt-0.5 text-xs text-ink-2">
                  Design a personality, scenario and first message from scratch
                </p>
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>

          {/* Action 2: Import character card */}
          <button
            onClick={() => {
              fileInputRef.current?.click();
            }}
            className="group flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
          >
            <div className="flex min-w-0 items-center gap-3.5">
              <Upload className="h-5 w-5 shrink-0 text-ink-2" aria-hidden="true" />
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-ink">Import card (PNG or JSON)</h4>
                <p className="mt-0.5 text-xs text-ink-2">
                  Bring a character file you already have
                </p>
              </div>
            </div>
            <ChevronRight
              className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".json, .png, image/png, application/json"
            aria-label="Choose a character card file"
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
              className="btn btn-quiet text-xs text-ink-2"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              How do I export a card?
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
