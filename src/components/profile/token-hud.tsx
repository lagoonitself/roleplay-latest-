'use client';

import React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Sigma } from 'lucide-react';
import { formatCompactTokenCount, formatTokenCount } from '@/lib/usage/tokens';

interface TokenHudProps {
  input: number;
  output: number;
  total: number;
  loading?: boolean;
  syncedWithAccount?: boolean;
}

/**
 * Token Usage HUD — raw counts only.
 * Strict contract: no model names, no monetary costs.
 */
export function TokenHud({ input, output, total, loading, syncedWithAccount }: TokenHudProps) {
  // Clamp to finite non-negative integers — values arrive from storage and the
  // server, and a bad payload must not render "140% input / -40% output".
  const safeInput = Number.isFinite(input) && input > 0 ? Math.floor(input) : 0;
  const safeOutput = Number.isFinite(output) && output > 0 ? Math.floor(output) : 0;
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;

  // The bar splits input vs output, so its basis must be their sum — using an
  // independent `total` let the two halves not add up to the bar. Gated on
  // `loading` so server render and hydration render the same placeholder.
  const parts = safeInput + safeOutput;
  const inShare = loading ? 0 : parts > 0 ? Math.min(100, Math.max(0, Math.round((safeInput / parts) * 100))) : 0;

  const tiles = [
    {
      key: 'input',
      label: 'Input tokens',
      hint: 'Prompts sent',
      value: safeInput,
      icon: ArrowDownToLine,
    },
    {
      key: 'output',
      label: 'Output tokens',
      hint: 'Replies and thinking',
      value: safeOutput,
      icon: ArrowUpFromLine,
    },
    {
      key: 'total',
      label: 'Total tokens',
      hint: 'All time',
      value: safeTotal,
      icon: Sigma,
    },
  ] as const;

  return (
    <section aria-label="Token usage" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="min-w-0">
          <h3 className="type-sec truncate">Token usage</h3>
          <p className="type-meta mt-0.5 truncate">
            {loading ? 'Syncing…' : syncedWithAccount ? 'Synced across sessions' : 'Kept on this device'}
          </p>
        </div>
        <span
          className={`shrink-0 ${syncedWithAccount ? 'chip chip-ok' : 'chip'}`}
          aria-live="polite"
        >
          {loading ? 'Syncing' : syncedWithAccount ? 'Account' : 'Local'}
        </span>
      </div>

      <div className="surface rounded-xl divide-y divide-line overflow-hidden">
        {/* Stats grid: max 2 columns on mobile, 3 columns on desktop */}
        <div className="grid grid-cols-2 sm:grid-cols-3">
          {tiles.map((t) => {
            const Icon = t.icon;
            const isInput = t.key === 'input';
            const isOutput = t.key === 'output';

            return (
              <div
                key={t.key}
                className={`min-w-0 p-3.5 sm:p-4 ${
                  isInput
                    ? 'border-r border-b border-line sm:border-b-0'
                    : isOutput
                      ? 'border-b border-line sm:border-b-0 sm:border-r'
                      : 'col-span-2 sm:col-span-1'
                }`}
              >
                <div className="flex items-center gap-1.5 text-ink-3">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="type-label truncate">{t.label}</span>
                </div>
                <div
                  className="mt-1.5 font-serif text-2xl tabular-nums text-ink truncate"
                  title={loading ? undefined : formatTokenCount(t.value)}
                >
                  {loading ? '…' : formatCompactTokenCount(t.value)}
                </div>
                <div
                  className="type-meta truncate mt-0.5"
                  title={loading ? undefined : formatTokenCount(t.value)}
                >
                  {t.hint}
                </div>
              </div>
            );
          })}
        </div>

        {/* Input / output ratio bar */}
        <div className="p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-xs text-ink-3 mb-1.5">
            <span className="type-meta">Input share</span>
            <span className="type-code text-ink-3 tabular-nums">{inShare}% input</span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-sunken"
            role="img"
            aria-label={`Input ${inShare} percent, output ${100 - inShare} percent`}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${inShare}%` }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
