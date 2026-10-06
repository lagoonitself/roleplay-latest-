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
  const safeTotal = Math.max(0, total);
  const inShare = safeTotal > 0 ? Math.round((input / safeTotal) * 100) : 0;

  const tiles = [
    {
      key: 'input',
      label: 'Input tokens',
      hint: 'Prompts sent',
      value: input,
      icon: ArrowDownToLine,
    },
    {
      key: 'output',
      label: 'Output tokens',
      hint: 'Replies and thinking',
      value: output,
      icon: ArrowUpFromLine,
    },
    {
      key: 'total',
      label: 'Total tokens',
      hint: 'All time',
      value: total,
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
                title={formatTokenCount(t.value)}
              >
                {loading ? '…' : formatCompactTokenCount(t.value)}
              </div>
              <div className="type-label mt-1">{t.label}</div>
              <div className="type-meta" title={formatTokenCount(t.value)}>
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
