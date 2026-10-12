'use client';

import React, { useRef } from 'react';
import Link from 'next/link';
import { UserPlus, Upload, BookOpen, ChevronRight } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';

interface CreateDrawerProps {
  open: boolean;
  onClose: () => void;
  onImportFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenImportGuide?: () => void;
}

export function CreateDrawer({ open, onClose, onImportFile, onOpenImportGuide }: CreateDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Create or import"
      description="Add a new character to your library"
      bodyClassName="px-5 pb-5 space-y-4"
    >
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {/* Action 1: Create Character from scratch */}
        <Link
          href="/c/new"
          onClick={onClose}
          className="row-press group flex min-h-[56px] items-center justify-between gap-3 p-4 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <UserPlus className="h-5 w-5 shrink-0 text-ink-2" aria-hidden="true" />
            <div className="min-w-0 flex-1">
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
          type="button"
          onClick={() => {
            fileInputRef.current?.click();
          }}
          className="row-press group flex min-h-[56px] w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3.5">
            <Upload className="h-5 w-5 shrink-0 text-ink-2" aria-hidden="true" />
            <div className="min-w-0 flex-1">
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
            type="button"
            onClick={() => {
              onClose();
              onOpenImportGuide();
            }}
            className="btn btn-quiet min-h-11 px-3 text-xs text-ink-2"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            How do I export a card?
          </button>
        </div>
      )}
    </Sheet>
  );
}
