import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { streamChatCompletions } from '@/lib/llm/client';
import { assemblePrompt } from '@/lib/prompt/assembler';
import { VERBOSITY_GUIDE } from '@/lib/prompt/system-prompt';
import { retrieveContextForChat, type RetrievedContext } from '@/lib/memory/retriever';
import { extractMemoriesAndState } from '@/lib/memory/extractor';
import { makeCharacter } from '@/lib/cards/card-parser';
import { formatRoleplayText } from '@/lib/prompt/macros';
import { estimateTokens } from '@/lib/prompt/tokens';
import { ThinkingStreamParser } from '@/lib/llm/stream-parser';
import type { Character, Persona, Message } from '@/lib/supabase/types';

/** Removes a leading "Name:" speaker tag the model sometimes adds, and trailing whitespace. */
function cleanReply(text: string, charName: string): string {
  const escaped = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`^\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*`, 'i'), '').trim();
}

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      chatId,
      characterId,
      personaId,
      persona: clientPersona,
      userMessage,
      parentMessageId,
      apiKey: clientApiKey,
      temperature,
      thinking,
      authorsNote,
      character: clientCharacter,
      history: clientHistory,
    } = body;

    if (!chatId || !characterId || !userMessage) {
      return NextResponse.json(
        { error: 'Missing required parameters: chatId, characterId, userMessage' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    // 1. Fetch Character (from database, client payload, or dynamic fallback)
    let character: Character;
    const { data: dbChar } = await supabase
      .from('characters')
      .select('*')
      .eq('id', characterId)
      .maybeSingle();

    if (dbChar) {
      character = dbChar as Character;
    } else if (clientCharacter) {
      character = makeCharacter(clientCharacter);
    } else {
      const cleanName = decodeURIComponent(characterId)
        .replace(/^local-char-\d+-?/, '')
        .replace(/-/g, ' ');

      character = makeCharacter({
        id: characterId,
        user_id: userId || 'guest',
        name: cleanName || 'Roleplay Partner',
        tagline: 'Custom Character',
        description: 'An interactive roleplay character.',
        personality: 'Immersive, responsive, staying firmly in character.',
        scenario: 'An ongoing interactive narrative.',
        first_message: '...',
        speech_style: 'Descriptive, evocative prose.',
        tags: ['Custom'],
        content_rating: 'mature',
      });
    }

    // 2. Fetch Persona
    let persona: Persona | null = null;
    if (clientPersona && clientPersona.name) {
      persona = clientPersona as Persona;
    } else if (personaId && userId) {
      const { data: dbPersona } = await supabase
        .from('personas')
        .select('*')
        .eq('id', personaId)
        .maybeSingle();
      persona = (dbPersona as Persona) || null;
    }

    if (!persona) {
      persona = {
        id: 'default-user',
        user_id: userId || 'guest',
        name: 'User',
        avatar_url: null,
        description: '',
        is_default: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    // 3. Save User Message to Database (if authenticated)
    let savedUserMsgId: string | null = null;
    if (userId) {
      const { data: userMsgRow } = await supabase
        .from('messages')
        .insert({
          chat_id: chatId,
          user_id: userId,
          parent_id: parentMessageId || null,
          role: 'user',
          content: userMessage,
          status: 'done',
        })
        .select('id')
        .single();

      savedUserMsgId = userMsgRow?.id || null;
    }

    // 4. Fetch Recent History (newest N turns, returned chronologically)
    let history: Message[] = [];
    if (userId) {
      try {
        const { data: historyData } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: false })
          .limit(80);

        history = ((historyData as Message[]) || []).reverse();
      } catch (err) {
        console.warn('Failed to fetch history from Supabase:', err);
      }
    }

    if (history.length === 0 && Array.isArray(clientHistory) && clientHistory.length > 0) {
      history = clientHistory;
    }

    // 5. Retrieve Context (memories, summary, state, lore).
    // Lore/memory matching scans the latest message plus the last few turns so that
    // keywords mentioned a moment ago keep their lore active.
    const scanText = [
      ...history.slice(-4).map((m) => m.content || ''),
      userMessage,
    ].join('\n');

    let retrieved: RetrievedContext = {
      pinnedMemories: [],
      relevantMemories: [],
      summary: null,
      chatState: null,
      triggeredLore: [],
    };

    if (userId) {
      try {
        retrieved = await retrieveContextForChat(chatId, character.id, scanText);
      } catch (e) {
        console.warn('Memory retrieval skipped:', e);
      }
    }

    // 6. Assemble Cache-Optimized Prompt
    const assembledMessages = assemblePrompt({
      character,
      persona,
      history,
      retrievedMemories: retrieved.relevantMemories,
      pinnedMemories: retrieved.pinnedMemories,
      summary: retrieved.summary,
      chatState: retrieved.chatState,
      triggeredLore: retrieved.triggeredLore,
      authorsNote: authorsNote || '',
      latestUserMessage: userMessage,
    });

    // 7. Generation parameters
    const verbosity = character.behavior?.verbosity || 'medium';
    const effectiveTemp = temperature ?? character.behavior?.temperature ?? 1.0;
    const effectiveThinking = thinking ?? character.behavior?.thinking_enabled ?? false;
    const userDisplayName = persona.name || 'User';

    const llmStreamResponse = await streamChatCompletions(assembledMessages, {
      apiKey: clientApiKey,
      sessionId: chatId, // routes to cached prefix on OpenCode Go
      temperature: effectiveTemp,
      thinking: effectiveThinking,
      max_tokens: (VERBOSITY_GUIDE[verbosity] ?? VERBOSITY_GUIDE.medium).maxTokens,
      presence_penalty: character.behavior?.presence_penalty,
      frequency_penalty: character.behavior?.frequency_penalty,
      // Hard backstop: if the model starts writing the user's next turn, cut it off.
      stop: [`\n${userDisplayName}:`, `\n${userDisplayName.toUpperCase()}:`],
      signal: req.signal,
    });

    if (!llmStreamResponse.body) {
      throw new Error('No response body from OpenCode Go stream');
    }

    // 8. Transform OpenAI SSE to Client SSE stream and collect full message for DB saving
    const reader = llmStreamResponse.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const streamStartTime = Date.now();
    let fullAssistantContent = '';
    let fullReasoningContent = '';
    const parser = new ThinkingStreamParser();
    // Feature 2 (additive): exact provider token counts for the Token HUD.
    // Never touches reasoning/text parsing — only observes `usage` payloads.
    let providerPromptTokens = 0;
    let providerCompletionTokens = 0;
    let providerCachedTokens = 0;

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(':')) continue;

              if (trimmed === 'data: [DONE]') {
                break;
              }

              if (trimmed.startsWith('data: ')) {
                const jsonStr = trimmed.slice(6);
                try {
                  const data = JSON.parse(jsonStr);
                  // Feature 2 (additive): capture exact usage when the provider
                  // attaches it to a chunk (usually the final chunk, no delta).
                  const u =
                    data?.usage && typeof data.usage === 'object' ? data.usage : null;
                  if (u) {
                    const p =
                      u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? 0;
                    const c =
                      u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? 0;
                    const cached =
                      u.prompt_tokens_details?.cached_tokens ??
                      u.prompt_cache_hit_tokens ??
                      0;
                    if (Number.isFinite(Number(p)) && Number(p) > 0)
                      providerPromptTokens = Math.floor(Number(p));
                    if (Number.isFinite(Number(c)) && Number(c) > 0)
                      providerCompletionTokens = Math.floor(Number(c));
                    if (Number.isFinite(Number(cached)) && Number(cached) >= 0)
                      providerCachedTokens = Math.floor(Number(cached));
                    // Usage chunks carry no text — keep reasoning flow untouched.
                    if (!data.choices?.[0]?.delta) continue;
                  }
                  const delta = data.choices?.[0]?.delta;
                  if (!delta) continue;

                  const parsedChunks = parser.process({
                    content: delta.content,
                    reasoning_content: delta.reasoning_content,
                    reasoning: delta.reasoning,
                  });

                  for (const chunk of parsedChunks) {
                    if (chunk.reasoning) {
                      fullReasoningContent += chunk.reasoning;
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ reasoning: chunk.reasoning })}\n\n`)
                      );
                    }
                    if (chunk.reasoningDone) {
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ reasoningDone: true })}\n\n`)
                      );
                    }
                    if (chunk.text) {
                      fullAssistantContent += chunk.text;
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ text: chunk.text })}\n\n`)
                      );
                    }
                  }
                } catch {
                  // ignore non-json lines
                }
              }
            }
          }

          const flushed = parser.flush();
          for (const chunk of flushed) {
            if (chunk.reasoning) {
              fullReasoningContent += chunk.reasoning;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ reasoning: chunk.reasoning })}\n\n`)
              );
            }
            if (chunk.reasoningDone) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ reasoningDone: true })}\n\n`)
              );
            }
            if (chunk.text) {
              fullAssistantContent += chunk.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: chunk.text })}\n\n`)
              );
            }
          }

          // SAFETY RECOVERY: If the model generated reasoning but was cut off (e.g. hit token limit)
          // or stopped before outputting the reply, run an immediate continuation to generate the prose.
          if (fullAssistantContent.trim().length === 0 && fullReasoningContent.trim().length > 0) {
            try {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ reasoningDone: true })}\n\n`)
              );

              const continuationMessages = [
                ...assembledMessages,
                {
                  role: 'system' as const,
                  content: `You completed your internal thinking: [${fullReasoningContent.slice(0, 1500)}]. Now immediately write your in-character roleplay response. Output only the story prose in character without repeating the reasoning.`
                }
              ];

              const contStream = await streamChatCompletions(continuationMessages, {
                apiKey: clientApiKey,
                sessionId: `${chatId}-continue`,
                temperature: effectiveTemp,
                thinking: false,
                max_tokens: (VERBOSITY_GUIDE[verbosity] ?? VERBOSITY_GUIDE.medium).maxTokens,
                presence_penalty: character.behavior?.presence_penalty,
                frequency_penalty: character.behavior?.frequency_penalty,
                stop: [`\n${userDisplayName}:`, `\n${userDisplayName.toUpperCase()}:`],
                signal: req.signal,
              });

              if (contStream.body) {
                const contReader = contStream.body.getReader();
                let contBuf = '';
                while (true) {
                  const { done: cDone, value: cVal } = await contReader.read();
                  if (cDone) break;
                  contBuf += decoder.decode(cVal, { stream: true });
                  const cLines = contBuf.split('\n');
                  contBuf = cLines.pop() || '';
                  for (const cLine of cLines) {
                    const cTrim = cLine.trim();
                    if (!cTrim || cTrim.startsWith(':') || cTrim === 'data: [DONE]') continue;
                    if (cTrim.startsWith('data: ')) {
                      try {
                        const cData = JSON.parse(cTrim.slice(6));
                        const cText = cData.choices?.[0]?.delta?.content;
                        if (cText) {
                          fullAssistantContent += cText;
                          controller.enqueue(
                            encoder.encode(`data: ${JSON.stringify({ text: cText })}\n\n`)
                          );
                        }
                      } catch {}
                    }
                  }
                }
              }
            } catch (recoveryErr) {
              console.warn('Reasoning continuation recovery failed:', recoveryErr);
            }
          }

          // Feature 2 (additive): finalize exact token counts.
          // Provider usage wins; otherwise estimate so guests still accumulate.
          // Output already includes thinking/reasoning tokens server-side.
          let finalInput = providerPromptTokens;
          let finalOutput = providerCompletionTokens;
          if (finalInput <= 0 || finalOutput <= 0) {
            const estIn = estimateTokens(userMessage);
            const estOut =
              estimateTokens(fullAssistantContent) +
              estimateTokens(fullReasoningContent);
            if (finalInput <= 0) finalInput = estIn;
            if (finalOutput <= 0) finalOutput = estOut;
          }
          if (finalInput > 0 || finalOutput > 0) {
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    usage: { input: finalInput, output: finalOutput, total: finalInput + finalOutput },
                  })}\n\n`
                )
              );
            } catch {}
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          // Feature 2 (additive): persist one ledger row per turn + token meta.
          if ((finalInput > 0 || finalOutput > 0) && userId) {
            try {
              await supabase.from('usage_events').insert({
                user_id: userId,
                chat_id: chatId,
                kind: 'chat',
                model: 'chat-completion',
                prompt_tokens: finalInput,
                completion_tokens: finalOutput,
                cached_tokens: providerCachedTokens,
              });
            } catch (e) {
              console.warn('usage_events insert skipped:', e);
            }
          }

          // 9. Persist Assistant Message & Trigger Background Memory Extraction
          if (userId && (fullAssistantContent || fullReasoningContent)) {
            const cleanedAssistant = cleanReply(fullAssistantContent, character.name);
            const reasoningDurationSeconds = fullReasoningContent
              ? Math.max(1, Math.round((Date.now() - streamStartTime) / 1000))
              : undefined;

            const { data: assistantMsgRow } = await supabase
              .from('messages')
              .insert({
                chat_id: chatId,
                user_id: userId,
                parent_id: savedUserMsgId,
                role: 'assistant',
                content: formatRoleplayText(cleanedAssistant, character.name, persona.name),
                reasoning: fullReasoningContent || null,
                status: 'done',
                meta: {
                  model: 'deepseek-v4.1-flash',
                  reasoning_duration_seconds: reasoningDurationSeconds,
                  tokens_in: finalInput > 0 ? finalInput : undefined,
                  tokens_out: finalOutput > 0 ? finalOutput : undefined,
                  cached_tokens: providerCachedTokens > 0 ? providerCachedTokens : undefined,
                },
              })
              .select('id')
              .single();

            if (assistantMsgRow?.id) {
              await supabase
                .from('chats')
                .update({ leaf_id: assistantMsgRow.id, last_message_at: new Date().toISOString() })
                .eq('id', chatId);

              // Background non-blocking extraction of facts & state update
              extractMemoriesAndState({
                chatId,
                userId,
                charName: character.name,
                userName: persona?.name || 'User',
                userMessage,
                assistantMessage: cleanedAssistant,
                existingMemories: retrieved.relevantMemories,
                currentState: retrieved.chatState?.state || {},
                apiKey: clientApiKey,
              }).catch((err) => console.error('Background memory extractor error:', err));
            }
          }
        } catch (err: any) {
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('API /api/chat error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
