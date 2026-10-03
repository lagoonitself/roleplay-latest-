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
      accent: 'text-sky-300',
      chip: 'bg-sky-500/15 border-sky-400/25',
    },
    {
      key: 'output',
      label: 'Output tokens',
      hint: 'Replies + thinking',
      value: output,
      icon: ArrowUpFromLine,
      accent: 'text-violet-300',
      chip: 'bg-violet-500/15 border-violet-400/25',
    },
    {
      key: 'total',
      label: 'Total tokens',
      hint: 'All time',
      value: total,
      icon: Sigma,
      accent: 'text-emerald-300',
      chip: 'bg-emerald-500/15 border-emerald-400/25',
    },
  ] as const;

  return (
    <section aria-label="Token usage" className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#151518]/90 shadow-xl shadow-black/30">
      <div className="flex items-center justify-between px-5 pt-4">
        <div>
          <h3 className="text-sm font-bold tracking-tight text-white">Token usage</h3>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            {loading ? 'Syncing…' : syncedWithAccount ? 'Synced across sessions' : 'Kept on this device'}
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
            syncedWithAccount
              ? 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
              : 'border-white/10 bg-white/[0.04] text-zinc-300'
          }`}
          aria-live="polite"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${syncedWithAccount ? 'bg-emerald-400' : 'bg-zinc-400'}`} />
          {loading ? 'Syncing' : syncedWithAccount ? 'Account' : 'Local'}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 px-3 pb-3 pt-3 sm:gap-2.5 sm:px-4">
        {tiles.map((t, i) => {
          const Icon = t.icon;
          return (
            <div
              key={t.key}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-3 sm:px-4"
              style={{ animationDelay: `${i * 45}ms` }}
            >
              <div className={`mb-2 inline-flex h-7 w-7 items-center justify-center rounded-lg border ${t.chip}`}>
                <Icon className={`h-3.5 w-3.5 ${t.accent}`} aria-hidden />
              </div>
              <div
                className="text-lg font-bold tabular-nums tracking-tight text-white sm:text-xl"
                title={formatTokenCount(t.value)}
              >
                {loading ? '…' : formatCompactTokenCount(t.value)}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-zinc-300">{t.label}</div>
              <div className="text-[10px] text-zinc-500" title={formatTokenCount(t.value)}>
                {t.hint}
                <span className="hidden sm:inline"> · {formatTokenCount(t.value)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 pb-5">
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]"
          role="img"
          aria-label={`Input ${inShare} percent, output ${100 - inShare} percent`}
        >
          <div className="h-full rounded-full bg-sky-400/80 transition-[width] duration-300" style={{ width: `${inShare}%` }} />
          <div className="h-full flex-1 rounded-r-full bg-violet-500/80" />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-zinc-500">
          <span>{inShare}% in</span>
          <span>{100 - inShare}% out</span>
        </div>
      </div>
    </section>
  );
}
