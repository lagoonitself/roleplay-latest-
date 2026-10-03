export interface ParsedStreamChunk {
  text?: string;
  reasoning?: string;
  reasoningDone?: boolean;
}

/**
 * Robust stream parser that demultiplexes reasoning tokens and final answer tokens.
 * Handles:
 * - Direct `reasoning_content` delta (DeepSeek API, OpenCode Go)
 * - Alternative `reasoning` delta property
 * - `<think>...</think>` and `<thought>...</thought>` tags inside `content` delta
 * - Partial tags split across arbitrary chunk boundaries
 */
export class ThinkingStreamParser {
  private inThinkTag = false;
  private thinkTagSeen = false;
  private hadReasoning = false;
  private reasoningDoneEmitted = false;
  private buffer = '';

  process(delta: {
    content?: string | null;
    reasoning_content?: string | null;
    reasoning?: string | null;
  }): ParsedStreamChunk[] {
    const results: ParsedStreamChunk[] = [];

    // 1. Direct reasoning_content or reasoning field from API
    const directReasoning = delta.reasoning_content || delta.reasoning;
    if (directReasoning) {
      this.hadReasoning = true;
      results.push({ reasoning: directReasoning });
    }

    // 2. Content field (which may contain <think>...</think> tags)
    const content = delta.content;
    if (content) {
      const contentChunks = this.processContentString(content);
      for (const chunk of contentChunks) {
        if (chunk.reasoning) {
          this.hadReasoning = true;
          results.push({ reasoning: chunk.reasoning });
        }
        if (chunk.reasoningDone) {
          if (!this.reasoningDoneEmitted) {
            this.reasoningDoneEmitted = true;
            results.push({ reasoningDone: true });
          }
        }
        if (chunk.text) {
          // If direct reasoning_content was present previously and now the first text chunk arrives,
          // signal that thinking is done
          if (this.hadReasoning && !this.reasoningDoneEmitted) {
            this.reasoningDoneEmitted = true;
            results.push({ reasoningDone: true });
          }
          results.push({ text: chunk.text });
        }
      }
    }

    return results;
  }

  private processContentString(chunk: string): ParsedStreamChunk[] {
    const results: ParsedStreamChunk[] = [];
    this.buffer += chunk;

    const OPEN_TAGS = ['<think>', '<thought>'];
    const CLOSE_TAGS = ['</think>', '</thought>'];

    while (this.buffer.length > 0) {
      if (!this.inThinkTag) {
        // Look for open tag
        let earliestOpenIdx = -1;
        let matchedOpenTag = '';

        for (const tag of OPEN_TAGS) {
          const idx = this.buffer.toLowerCase().indexOf(tag);
          if (idx !== -1 && (earliestOpenIdx === -1 || idx < earliestOpenIdx)) {
            earliestOpenIdx = idx;
            matchedOpenTag = tag;
          }
        }

        if (earliestOpenIdx !== -1) {
          // Text before open tag
          const before = this.buffer.slice(0, earliestOpenIdx);
          if (before) {
            results.push({ text: before });
          }
          this.buffer = this.buffer.slice(earliestOpenIdx + matchedOpenTag.length);
          this.inThinkTag = true;
          this.thinkTagSeen = true;
          continue;
        }

        // Check if buffer ends with a partial open tag (e.g. "<", "<t", "<th", etc.)
        let partialMatchLen = 0;
        const lowerBuf = this.buffer.toLowerCase();
        for (const tag of OPEN_TAGS) {
          for (let len = tag.length - 1; len >= 1; len--) {
            const sub = tag.slice(0, len);
            if (lowerBuf.endsWith(sub)) {
              if (len > partialMatchLen) {
                partialMatchLen = len;
              }
            }
          }
        }

        if (partialMatchLen > 0) {
          const safeText = this.buffer.slice(0, -partialMatchLen);
          if (safeText) {
            results.push({ text: safeText });
          }
          this.buffer = this.buffer.slice(-partialMatchLen);
          break; // wait for next chunk to complete tag
        }

        // No partial tag, emit entire buffer as text
        results.push({ text: this.buffer });
        this.buffer = '';
      } else {
        // Inside think tag: look for close tag
        let earliestCloseIdx = -1;
        let matchedCloseTag = '';

        for (const tag of CLOSE_TAGS) {
          const idx = this.buffer.toLowerCase().indexOf(tag);
          if (idx !== -1 && (earliestCloseIdx === -1 || idx < earliestCloseIdx)) {
            earliestCloseIdx = idx;
            matchedCloseTag = tag;
          }
        }

        if (earliestCloseIdx !== -1) {
          const reasoningText = this.buffer.slice(0, earliestCloseIdx);
          if (reasoningText) {
            results.push({ reasoning: reasoningText });
          }
          results.push({ reasoningDone: true });
          this.buffer = this.buffer.slice(earliestCloseIdx + matchedCloseTag.length);
          // Strip immediate newline after close tag
          if (this.buffer.startsWith('\r\n\r\n')) {
            this.buffer = this.buffer.slice(4);
          } else if (this.buffer.startsWith('\n\n')) {
            this.buffer = this.buffer.slice(2);
          } else if (this.buffer.startsWith('\r\n')) {
            this.buffer = this.buffer.slice(2);
          } else if (this.buffer.startsWith('\n')) {
            this.buffer = this.buffer.slice(1);
          }
          this.inThinkTag = false;
          continue;
        }

        // Check if buffer ends with a partial close tag (e.g. "</", "</t", "</th")
        let partialMatchLen = 0;
        const lowerBuf = this.buffer.toLowerCase();
        for (const tag of CLOSE_TAGS) {
          for (let len = tag.length - 1; len >= 1; len--) {
            const sub = tag.slice(0, len);
            if (lowerBuf.endsWith(sub)) {
              if (len > partialMatchLen) {
                partialMatchLen = len;
              }
            }
          }
        }

        if (partialMatchLen > 0) {
          const safeReasoning = this.buffer.slice(0, -partialMatchLen);
          if (safeReasoning) {
            results.push({ reasoning: safeReasoning });
          }
          this.buffer = this.buffer.slice(-partialMatchLen);
          break; // wait for next chunk
        }

        results.push({ reasoning: this.buffer });
        this.buffer = '';
      }
    }

    return results;
  }

  flush(): ParsedStreamChunk[] {
    const results: ParsedStreamChunk[] = [];
    if (this.buffer.length > 0) {
      if (this.inThinkTag) {
        results.push({ reasoning: this.buffer });
        if (!this.reasoningDoneEmitted) {
          this.reasoningDoneEmitted = true;
          results.push({ reasoningDone: true });
        }
      } else {
        results.push({ text: this.buffer });
      }
      this.buffer = '';
    } else if ((this.inThinkTag || this.hadReasoning) && !this.reasoningDoneEmitted) {
      this.reasoningDoneEmitted = true;
      results.push({ reasoningDone: true });
    }
    return results;
  }
}

/**
 * Extracts thinking block from static content (useful for cleaning saved messages or fallbacks).
 */
export function extractThinking(rawText: string): { text: string; reasoning: string | null } {
  if (!rawText) return { text: '', reasoning: null };
  const thinkMatch = rawText.match(/<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/i);
  if (thinkMatch) {
    const reasoning = thinkMatch[1].trim();
    const cleanText = rawText.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>\s*/gi, '').trim();
    return { text: cleanText, reasoning: reasoning || null };
  }
  return { text: rawText, reasoning: null };
}
