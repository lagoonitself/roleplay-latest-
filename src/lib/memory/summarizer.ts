/**
 * SillyTavern-Compatible Chat Summarization Engine
 *
 * Implements:
 * - Interval-based automatic chat summarization (default: every 10 turns)
 * - Incremental expansion: builds upon previous summary with new dialogue turns
 * - SillyTavern's exact summarization system prompt & template formatting
 * - Persistence to Supabase `summaries` table
 * - Injection into chat prompt at depth (default: depth 2) or relative prompt order
 */

import { createClient } from '@/lib/supabase/server';
import { substituteMacros, formatRoleplayText } from '@/lib/prompt/macros';
import { estimateTokens } from '@/lib/prompt/tokens';
import type { Message, Summary } from '@/lib/supabase/types';

export const DEFAULT_SUMMARY_INTERVAL = 10;
export const DEFAULT_SUMMARY_WORDS = 250;
export const DEFAULT_SUMMARY_PROMPT =
  'Ignore previous instructions. Summarize the most important facts and events in the story so far. If a summary already exists in your memory, use that as a base and expand with new facts. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.';
export const DEFAULT_SUMMARY_TEMPLATE = '[Summary: {{summary}}]';

export interface SummarizeParams {
  chatId: string;
  userId: string;
  charName: string;
  userName: string;
  history: Message[];
  apiKey?: string;
  promptWords?: number;
  interval?: number;
}

/**
 * Strips reasoning tokens or markdown headers from the generated summary
 */
function cleanSummaryOutput(raw: string): string {
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\n/i, '')
    .replace(/\n```$/i, '')
    .trim();

  // If the model prefixed with "Summary: " or "[Summary: ...]", clean it to raw text so template formatting stays clean
  cleaned = cleaned.replace(/^\[?summary:\s*/i, '').replace(/\]$/, '').trim();
  return cleaned;
}

/**
 * Checks if the chat requires a new summary turn and executes summarization if needed.
 */
export async function summarizeChatIfNeeded(params: SummarizeParams): Promise<Summary | null> {
  const {
    chatId,
    userId,
    charName,
    userName,
    history,
    apiKey,
    promptWords = DEFAULT_SUMMARY_WORDS,
    interval = DEFAULT_SUMMARY_INTERVAL,
  } = params;

  if (!chatId || !userId || history.length < interval) {
    return null;
  }

  const supabase = await createClient();

  // 1. Fetch latest active summary
  const { data: latestSummaryData } = await supabase
    .from('summaries')
    .select('*')
    .eq('chat_id', chatId)
    .eq('superseded', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const latestSummary: Summary | null = latestSummaryData || null;

  // 2. Count messages since last summary
  let messagesSinceLastSummary = 0;
  const turnsToSummarize: Message[] = [];

  if (latestSummary?.last_message_id) {
    const lastSummaryIndex = history.findIndex((m) => m.id === latestSummary.last_message_id);
    if (lastSummaryIndex !== -1) {
      turnsToSummarize.push(...history.slice(lastSummaryIndex + 1));
      messagesSinceLastSummary = turnsToSummarize.length;
    } else {
      // If last_message_id not in recent window, check recent slice
      turnsToSummarize.push(...history.slice(-interval));
      messagesSinceLastSummary = turnsToSummarize.length;
    }
  } else {
    // No previous summary exists
    turnsToSummarize.push(...history);
    messagesSinceLastSummary = history.length;
  }

  if (messagesSinceLastSummary < interval) {
    return latestSummary;
  }

  // 3. Build summarization prompt and dialogue buffer
  const systemPrompt = substituteMacros(DEFAULT_SUMMARY_PROMPT, charName, userName)
    .replace(/\{\{\s*words\s*\}\}/gi, String(promptWords));

  const bufferLines: string[] = [];
  if (latestSummary?.content) {
    bufferLines.push(`[Previous Summary of Story So Far]:\n${latestSummary.content}`);
  }

  bufferLines.push('[Recent Story Exchanges]:');
  for (const msg of turnsToSummarize) {
    if (msg.role === 'system' || !msg.content?.trim()) continue;
    const speaker = msg.role === 'assistant' ? charName : userName;
    bufferLines.push(`${speaker}: ${formatRoleplayText(msg.content, charName, userName)}`);
  }

  const userPromptContent = bufferLines.join('\n\n');

  // 4. Call LLM for summarization
  try {
    const { streamChatCompletions } = await import('@/lib/llm/client');

    const res = await streamChatCompletions(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPromptContent },
      ],
      {
        apiKey,
        sessionId: `summary-${chatId}`,
        temperature: 0.3,
        thinking: false,
        max_tokens: 600,
      }
    );

    if (!res.body) return latestSummary;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6));
            const delta = data.choices?.[0]?.delta?.content;
            if (delta) accumulatedText += delta;
          } catch {}
        }
      }
    }

    const cleanSummary = cleanSummaryOutput(accumulatedText);
    if (!cleanSummary || cleanSummary.length < 15) {
      return latestSummary;
    }

    // 5. Supersede previous summary and insert new active summary in Supabase
    if (latestSummary?.id) {
      await supabase
        .from('summaries')
        .update({ superseded: true })
        .eq('id', latestSummary.id);
    }

    const lastMsgId = turnsToSummarize[turnsToSummarize.length - 1]?.id || null;
    const msgIds = turnsToSummarize.map((m) => m.id).filter(Boolean);

    const { data: newSummaryRow, error } = await supabase
      .from('summaries')
      .insert({
        chat_id: chatId,
        user_id: userId,
        level: 'chunk',
        content: cleanSummary,
        message_ids: msgIds,
        last_message_id: lastMsgId,
        token_estimate: estimateTokens(cleanSummary),
        user_edited: false,
        superseded: false,
      })
      .select()
      .single();

    if (error) {
      console.warn('Failed to insert new summary:', error.message);
      return latestSummary;
    }

    return (newSummaryRow as Summary) || null;
  } catch (err) {
    console.error('Error generating chat summary:', err);
    return latestSummary;
  }
}

/**
 * Formats summary into prompt text using SillyTavern template
 */
export function formatSummaryPrompt(summaryContent: string, template: string = DEFAULT_SUMMARY_TEMPLATE): string {
  if (!summaryContent?.trim()) return '';
  return template.replace(/\{\{\s*summary\s*\}\}/gi, summaryContent.trim());
}
