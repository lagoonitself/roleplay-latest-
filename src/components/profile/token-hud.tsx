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
    <section aria-label="Token usage" className="surface rounded-xl p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="type-sec">Token usage</h3>
          <p className="type-meta mt-0.5">
            {loading ? 'Syncing…' : syncedWithAccount ? 'Synced across sessions' : 'Kept on this device'}
          </p>
        </div>
        <span
          className={syncedWithAccount ? 'chip chip-ok' : 'chip'}
          aria-live="polite"
        >
          {loading ? 'Syncing' : syncedWithAccount ? 'Account' : 'Local'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 divide-x divide-line rounded-lg border border-line">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <div key={t.key} className="px-3 py-3 sm:px-4 min-w-0">
              <Icon className="h-4 w-4 text-ink-3" aria-hidden />
              <div
                className="mt-2 font-serif text-2xl tabular-nums text-ink truncate"
                title={loading ? undefined : formatTokenCount(t.value)}
              >
                {loading ? '…' : formatCompactTokenCount(t.value)}
              </div>
              <div className="type-label mt-1">{t.label}</div>
              <div className="type-meta" title={loading ? undefined : formatTokenCount(t.value)}>
                {t.hint}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <div
          className="h-[3px] w-full overflow-hidden rounded-full bg-sunken"
          role="img"
          aria-label={`Input ${inShare} percent, output ${100 - inShare} percent`}
        >
          <div className="h-full rounded-full bg-accent" style={{ width: `${inShare}%` }} />
        </div>
        <p className="type-code text-ink-3 mt-1.5">
          {inShare}% input
        </p>
      </div>
    </section>
  );
}
