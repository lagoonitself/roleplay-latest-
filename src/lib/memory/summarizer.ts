/**
 * Summary API
 * -----------
 * The user-facing surface of the automatic memory engine for the *running story
 * summary*: regenerate it on demand, or save a hand-edited one and lock it against
 * auto-overwrite.
 *
 * The summary itself is produced by `engine.ts`, which regenerates it together with
 * the fact bank and scene state in one pass. Everything here is either a thin
 * wrapper over that pass or pure formatting.
 */

import { createClient } from '@/lib/supabase/server';
import {
  DEFAULT_SUMMARY_WORDS,
  SUMMARY_TOKEN_CAP,
  cleanSummaryOutput,
  runMemoryPass,
  type MemoryPassInput,
} from './engine';
import { estimateTokens, truncateToTokensMiddle } from '@/lib/prompt/tokens';
import type { Summary } from '@/lib/supabase/types';

export { cleanSummaryOutput, DEFAULT_SUMMARY_WORDS };

/** How many messages trigger an automatic pass (SillyTavern's summary interval). */
export const DEFAULT_SUMMARY_INTERVAL = 10;
export const DEFAULT_SUMMARY_TEMPLATE = '[Summary: {{summary}}]';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formats summary into prompt text using the SillyTavern template. */
export function formatSummaryPrompt(summaryContent: string, template: string = DEFAULT_SUMMARY_TEMPLATE): string {
  if (!summaryContent?.trim()) return '';
  return template.replace(/\{\{\s*summary\s*\}\}/gi, summaryContent.trim());
}

export interface SummarizeNowParams extends Omit<MemoryPassInput, 'summaryWords'> {
  promptWords?: number;
}

/**
 * Regenerates the summary on demand (the "Summarize now" button).
 * Delegates to the memory pass so facts and scene state stay in step with it.
 */
export async function summarizeChatNow(
  params: SummarizeNowParams,
  options: { supabase?: Awaited<ReturnType<typeof createClient>>; isDbBacked?: boolean } = {}
): Promise<Summary | null> {
  const result = await runMemoryPass(
    { ...params, summaryWords: params.promptWords ?? DEFAULT_SUMMARY_WORDS },
    {
      supabase: options.supabase as never,
      isDbBacked: options.isDbBacked ?? UUID_REGEX.test(params.chatId),
    }
  );
  return result.summary;
}

/**
 * Saves a hand-edited summary. It is marked `user_edited`, which freezes it:
 * the automatic pass will never overwrite a summary the writer has locked.
 */
export async function saveSummaryEdit(params: {
  chatId: string;
  userId: string;
  content: string;
}): Promise<Summary | null> {
  const content = (params.content || '').trim();
  if (!content) return null;

  const summaryRow: Summary = {
    id: `sum-${Date.now()}`,
    chat_id: params.chatId,
    user_id: params.userId,
    level: 'chunk',
    content,
    message_ids: [],
    last_message_id: null,
    token_estimate: estimateTokens(content),
    user_edited: true,
    superseded: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!UUID_REGEX.test(params.chatId) || !UUID_REGEX.test(params.userId)) return summaryRow;

  try {
    const supabase = await createClient();
    const { data: activeSummary } = await supabase
      .from('summaries')
      .select('*')
      .eq('chat_id', params.chatId)
      .eq('superseded', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeSummary?.id) {
      await supabase.from('summaries').update({ superseded: true }).eq('id', activeSummary.id);
    }

    const { data: newRow, error } = await supabase
      .from('summaries')
      .insert({
        chat_id: params.chatId,
        user_id: params.userId,
        level: 'chunk',
        content: truncateToTokensMiddle(content, SUMMARY_TOKEN_CAP),
        user_edited: true,
        superseded: false,
      })
      .select()
      .single();

    if (!error && newRow) return newRow as Summary;
  } catch (err) {
    console.warn('saveSummaryEdit: falling back to local summary:', err);
  }

  return summaryRow;
}
