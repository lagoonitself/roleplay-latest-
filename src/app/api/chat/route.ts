import { NextRequest, NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { streamChatCompletions, getLlmModel } from '@/lib/llm/client';
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      authorsNoteDepth,
      presetContent,
      character: clientCharacter,
      history: clientHistory,
      isSwipe,
      existingAssistantMessageId,
      swipeIndex,
    } = body;

    if (!chatId || !characterId || !userMessage) {
      return NextResponse.json(
        { error: 'Missing required parameters: chatId, characterId, userMessage' },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sgnieclbmerpxlbadymm.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    let supabase: any;
    let userId: string | undefined;

    if (bearerToken) {
      const { createClient: createSupabaseJsClient } = await import('@supabase/supabase-js');
      supabase = createSupabaseJsClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData } = await supabase.auth.getUser(bearerToken);
      userId = authData?.user?.id;
    } else {
      supabase = await createClient();
      const { data: authData } = await supabase.auth.getUser();
      userId = authData?.user?.id;
    }

    // 1. Fetch Character (from database, client payload, or dynamic fallback)
    let character: Character;
    let dbChar: Character | null = null;
    if (UUID_REGEX.test(characterId)) {
      const { data } = await supabase
        .from('characters')
        .select('*')
        .eq('id', characterId)
        .maybeSingle();
      if (data) dbChar = data as Character;
    }

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

    // If user is authenticated and character is not yet in Supabase, sync it now so foreign keys succeed
    if (userId && !dbChar) {
      try {
        const { data: savedChar, error: charSaveErr } = await supabase
          .from('characters')
          .insert({
            user_id: userId,
            name: character.name || 'Character',
            avatar_url: character.avatar_url || null,
            tagline: character.tagline || '',
            description: character.description || '',
            personality: character.personality || '',
            scenario: character.scenario || '',
            first_message: character.first_message || '',
            alternate_greetings: character.alternate_greetings || [],
            example_dialogue: character.example_dialogue || '',
            speech_style: character.speech_style || '',
            system_prompt: character.system_prompt || '',
            post_history_instructions: character.post_history_instructions || '',
            tags: character.tags || ['Custom'],
            content_rating: character.content_rating || 'mature',
            behavior: character.behavior || {},
            generation: character.generation || {},
            accent_color: character.accent_color || null,
          })
          .select()
          .single();

        if (!charSaveErr && savedChar) {
          character = savedChar as Character;
        }
      } catch (e) {
        console.warn('Failed to auto-sync character to Supabase:', e);
      }
    }

    // 2. Fetch Persona
    let persona: Persona | null = null;
    if (clientPersona && clientPersona.name) {
      persona = clientPersona as Persona;
    } else if (personaId && userId && UUID_REGEX.test(personaId)) {
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

    // 2.5 Ensure Chat exists in Supabase for authenticated users
    let resolvedChatId = chatId;
    if (userId) {
      const isChatUuid = UUID_REGEX.test(chatId);
      let existingChatRow = null;
      if (isChatUuid) {
        const { data: cRow } = await supabase
          .from('chats')
          .select('id')
          .eq('id', chatId)
          .maybeSingle();
        existingChatRow = cRow;
      }

      if (!existingChatRow) {
        try {
          const { data: newChatRow, error: newChatErr } = await supabase
            .from('chats')
            .insert({
              user_id: userId,
              character_id: character.id,
              title: `Chat with ${character.name}`,
              persona_id: persona?.id && UUID_REGEX.test(persona.id) ? persona.id : null,
              last_message_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (!newChatErr && newChatRow) {
            resolvedChatId = newChatRow.id;
            // Also seed character opening greeting in DB so the transcript starts from turn 0
            const firstMsg = character.first_message || '*I look at you quietly.*';
            const formattedGreeting = formatRoleplayText(firstMsg, character.name, persona.name);
            await supabase.from('messages').insert({
              chat_id: resolvedChatId,
              user_id: userId,
              parent_id: null,
              role: 'assistant',
              content: formattedGreeting,
              status: 'done',
              meta: {
                swipes: [formattedGreeting, ...(character.alternate_greetings || []).map((g) => formatRoleplayText(g, character.name, persona.name))],
                active_swipe_index: 0,
              },
            });
          }
        } catch (e) {
          console.warn('Failed to auto-create chat in Supabase:', e);
        }
      }
    }

    // 3. Save User Message to Database (if authenticated and NOT a swipe variation)
    let savedUserMsgId: string | null = null;
    if (userId && !isSwipe) {
      const safeParentId = (parentMessageId && UUID_REGEX.test(parentMessageId)) ? parentMessageId : null;
      try {
        let { data: userMsgRow, error: userMsgErr } = await supabase
          .from('messages')
          .insert({
            chat_id: resolvedChatId,
            user_id: userId,
            parent_id: safeParentId,
            role: 'user',
            content: userMessage,
            status: 'done',
          })
          .select('id')
          .single();

        if (userMsgErr && safeParentId) {
          console.warn('User message insert failed with parent_id, falling back to parent_id: null', userMsgErr);
          const fallbackRes = await supabase
            .from('messages')
            .insert({
              chat_id: resolvedChatId,
              user_id: userId,
              parent_id: null,
              role: 'user',
              content: userMessage,
              status: 'done',
            })
            .select('id')
            .single();
          userMsgRow = fallbackRes.data;
          userMsgErr = fallbackRes.error;
        }

        if (userMsgErr) {
          console.error('Failed to insert user message in DB:', userMsgErr);
        } else {
          savedUserMsgId = userMsgRow?.id || null;
        }
      } catch (e) {
        console.error('Exception inserting user message:', e);
      }
    }

    // 4. Fetch Recent History (newest N turns, returned chronologically)
    let history: Message[] = [];
    if (userId) {
      try {
        const { data: historyData } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', resolvedChatId)
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

    // 5. Retrieve Context (memories, summary, state, lore via SillyTavern World Info and Vectors).
    let retrieved: RetrievedContext = {
      pinnedMemories: [],
      relevantMemories: [],
      summary: null,
      chatState: null,
      triggeredLore: [],
    };

    if (userId) {
      try {
        retrieved = await retrieveContextForChat({
          chatId: resolvedChatId,
          character,
          persona,
          history,
          latestUserMessage: userMessage,
        });
      } catch (e) {
        console.warn('Memory retrieval skipped:', e);
      }
    }

    // Apply SillyTavern system preset override if provided
    const effectiveCharacter = presetContent?.trim()
      ? { ...character, system_prompt: presetContent.trim() }
      : character;

    // 6. Assemble SillyTavern PromptManager Messages & In-Chat Injections
    const assembledMessages = assemblePrompt({
      character: effectiveCharacter,
      persona,
      history,
      retrievedMemories: retrieved.relevantMemories,
      pinnedMemories: retrieved.pinnedMemories,
      vectorMemories: retrieved.vectorMemories,
      summary: retrieved.summary,
      chatState: retrieved.chatState,
      triggeredLore: retrieved.triggeredLore,
      activatedLore: retrieved.activatedLore,
      authorsNote: authorsNote || '',
      authorsNoteDepth: typeof authorsNoteDepth === 'number' ? authorsNoteDepth : 4,
      latestUserMessage: userMessage,
    });

    // 7. Generation parameters
    const verbosity = character.behavior?.verbosity || 'medium';
    const effectiveTemp = temperature ?? character.behavior?.temperature ?? 1.0;
    const effectiveThinking = thinking ?? character.behavior?.thinking_enabled ?? false;
    const userDisplayName = persona.name || 'User';
    const effectiveModel = getLlmModel();
    const effectiveMaxTokens = (VERBOSITY_GUIDE[verbosity] ?? VERBOSITY_GUIDE.medium).maxTokens;
    const effectiveStop = [`\n${userDisplayName}:`, `\n${userDisplayName.toUpperCase()}:`];
    const logKind = isSwipe ? 'swipe' : 'chat';

    const llmStreamResponse = await streamChatCompletions(assembledMessages, {
      apiKey: clientApiKey,
      sessionId: chatId, // routes to cached prefix on OpenCode Go
      temperature: effectiveTemp,
      thinking: effectiveThinking,
      max_tokens: effectiveMaxTokens,
      presence_penalty: character.behavior?.presence_penalty,
      frequency_penalty: character.behavior?.frequency_penalty,
      // Hard backstop: if the model starts writing the user's next turn, cut it off.
      stop: effectiveStop,
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
    let reasoningEndTime: number | null = null;
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
                      if (!reasoningEndTime) reasoningEndTime = Date.now();
                      controller.enqueue(
                        encoder.encode(`data: ${JSON.stringify({ reasoningDone: true })}\n\n`)
                      );
                    }
                    if (chunk.text) {
                      if (!reasoningEndTime) reasoningEndTime = Date.now();
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
              if (!reasoningEndTime) reasoningEndTime = Date.now();
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ reasoningDone: true })}\n\n`)
              );
            }
            if (chunk.text) {
              if (!reasoningEndTime) reasoningEndTime = Date.now();
              fullAssistantContent += chunk.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: chunk.text })}\n\n`)
              );
            }
          }
          if (fullReasoningContent && !reasoningEndTime) {
            reasoningEndTime = Date.now();
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

          // 9. Persist Assistant Message in Supabase (BEFORE closing the stream)
          const reasoningDurationSeconds = fullReasoningContent
            ? Math.max(1, Math.round(((reasoningEndTime || Date.now()) - streamStartTime) / 1000))
            : undefined;
          let assistantMsgRow: { id: string } | null = null;

          if (userId && (fullAssistantContent || fullReasoningContent)) {
            const cleanedAssistant = cleanReply(fullAssistantContent, character.name);
            const safeAssistantParentId = (savedUserMsgId && UUID_REGEX.test(savedUserMsgId)) ? savedUserMsgId : null;

            try {
              if (isSwipe && existingAssistantMessageId && UUID_REGEX.test(existingAssistantMessageId)) {
                // Update existing assistant message row's swipes array instead of inserting duplicate turn
                const { data: existingRow } = await supabase
                  .from('messages')
                  .select('meta, content, reasoning')
                  .eq('id', existingAssistantMessageId)
                  .single();

                const currentMeta = ((existingRow?.meta || {}) as Record<string, any>);
                const currentSwipes = Array.isArray(currentMeta.swipes) ? [...currentMeta.swipes] : [existingRow?.content || ''];
                const currentReasoningSwipes = Array.isArray(currentMeta.reasoning_swipes) ? [...currentMeta.reasoning_swipes] : [existingRow?.reasoning || ''];
                const currentDurations = Array.isArray(currentMeta.reasoning_durations) ? [...currentMeta.reasoning_durations] : [];

                const targetSwipeIdx = typeof swipeIndex === 'number' ? swipeIndex : currentSwipes.length;
                const formattedNewSwipe = formatRoleplayText(cleanedAssistant, character.name, persona.name);
                currentSwipes[targetSwipeIdx] = formattedNewSwipe;
                currentReasoningSwipes[targetSwipeIdx] = fullReasoningContent || null;
                currentDurations[targetSwipeIdx] = reasoningDurationSeconds;

                await supabase
                  .from('messages')
                  .update({
                    content: formattedNewSwipe,
                    reasoning: fullReasoningContent || null,
                    meta: {
                      ...currentMeta,
                      model: effectiveModel,
                      swipes: currentSwipes,
                      active_swipe_index: targetSwipeIdx,
                      reasoning_swipes: currentReasoningSwipes,
                      reasoning_durations: currentDurations,
                      reasoning_duration_seconds: reasoningDurationSeconds,
                      tokens_in: finalInput > 0 ? finalInput : currentMeta.tokens_in,
                      tokens_out: finalOutput > 0 ? finalOutput : currentMeta.tokens_out,
                      cached_tokens: providerCachedTokens > 0 ? providerCachedTokens : currentMeta.cached_tokens,
                    },
                  })
                  .eq('id', existingAssistantMessageId);

                assistantMsgRow = { id: existingAssistantMessageId };
              } else {
                let assistantInsertRes = await supabase
                  .from('messages')
                  .insert({
                    chat_id: resolvedChatId,
                    user_id: userId,
                    parent_id: safeAssistantParentId,
                    role: 'assistant',
                    content: formatRoleplayText(cleanedAssistant, character.name, persona.name),
                    reasoning: fullReasoningContent || null,
                    status: 'done',
                    meta: {
                      model: effectiveModel,
                      reasoning_duration_seconds: reasoningDurationSeconds,
                      tokens_in: finalInput > 0 ? finalInput : undefined,
                      tokens_out: finalOutput > 0 ? finalOutput : undefined,
                      cached_tokens: providerCachedTokens > 0 ? providerCachedTokens : undefined,
                    },
                  })
                  .select('id')
                  .single();

                if (assistantInsertRes.error && safeAssistantParentId) {
                  console.warn('Assistant insert with parent_id failed, falling back to parent_id: null', assistantInsertRes.error);
                  assistantInsertRes = await supabase
                    .from('messages')
                    .insert({
                      chat_id: resolvedChatId,
                      user_id: userId,
                      parent_id: null,
                      role: 'assistant',
                      content: formatRoleplayText(cleanedAssistant, character.name, persona.name),
                      reasoning: fullReasoningContent || null,
                      status: 'done',
                      meta: {
                        model: effectiveModel,
                        reasoning_duration_seconds: reasoningDurationSeconds,
                        tokens_in: finalInput > 0 ? finalInput : undefined,
                        tokens_out: finalOutput > 0 ? finalOutput : undefined,
                        cached_tokens: providerCachedTokens > 0 ? providerCachedTokens : undefined,
                      },
                    })
                    .select('id')
                    .single();
                }

                if (assistantInsertRes.error) {
                  console.error('Failed to insert assistant message in DB:', assistantInsertRes.error);
                } else {
                  assistantMsgRow = assistantInsertRes.data;
                }
              }
            } catch (e) {
              console.error('Exception saving assistant message:', e);
            }

            if (assistantMsgRow?.id) {
              await supabase
                .from('chats')
                .update({ leaf_id: assistantMsgRow.id, last_message_at: new Date().toISOString() })
                .eq('id', resolvedChatId);

              // Background non-blocking extraction of facts, state update, and periodic summarization
              const backgroundTask = async () => {
                try {
                  await extractMemoriesAndState({
                    chatId: resolvedChatId,
                    userId,
                    charName: character.name,
                    userName: persona?.name || 'User',
                    userMessage,
                    assistantMessage: cleanedAssistant,
                    existingMemories: retrieved.relevantMemories,
                    currentState: retrieved.chatState?.state || {},
                    apiKey: clientApiKey,
                  });
                } catch (err) {
                  console.error('Background memory extractor error:', err);
                }

                try {
                  const { summarizeChatIfNeeded } = await import('@/lib/memory/summarizer');
                  await summarizeChatIfNeeded({
                    chatId: resolvedChatId,
                    userId,
                    charName: character.name,
                    userName: persona?.name || 'User',
                    history: [
                      ...history,
                      { id: savedUserMsgId || 'user-now', role: 'user', content: userMessage } as any,
                      { id: assistantMsgRow?.id || 'assistant-now', role: 'assistant', content: cleanedAssistant } as any,
                    ],
                    apiKey: clientApiKey,
                  });
                } catch (err) {
                  console.error('Background summarizer error:', err);
                }
              };

              try {
                after(backgroundTask);
              } catch {
                backgroundTask();
              }
            }
          }

          // Feature 2 (additive): persist one ledger row per turn + token meta.
          if ((finalInput > 0 || finalOutput > 0) && userId) {
            try {
              await supabase.from('usage_events').insert({
                user_id: userId,
                chat_id: UUID_REGEX.test(resolvedChatId) ? resolvedChatId : null,
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

          // Developer LLM log (additive): ship complete assembled prompt and persist a server row.
          let llmLogServerId: string | number | null = null;
          const llmLogPayload = {
            chatId: resolvedChatId,
            characterId: character.id,
            characterName: character.name,
            kind: logKind,
            model: effectiveModel,
            params: {
              temperature: effectiveTemp,
              max_tokens: effectiveMaxTokens,
              thinking: effectiveThinking,
              top_p: 0.95,
              presence_penalty: character.behavior?.presence_penalty,
              frequency_penalty: character.behavior?.frequency_penalty,
              stop: effectiveStop,
            },
            requestMessages: assembledMessages,
            userMessage,
            output: fullAssistantContent,
            reasoning: fullReasoningContent || null,
            usage: {
              input: finalInput,
              output: finalOutput,
              total: finalInput + finalOutput,
              cached: providerCachedTokens,
            },
            latencyMs: Date.now() - streamStartTime,
          };
          if (userId) {
            try {
              const { data: logRow } = await supabase
                .from('llm_logs')
                .insert({
                  user_id: userId,
                  chat_id: UUID_REGEX.test(resolvedChatId) ? resolvedChatId : null,
                  character_id: UUID_REGEX.test(character.id) ? character.id : null,
                  kind: logKind,
                  model: effectiveModel,
                  params: llmLogPayload.params,
                  request_messages: assembledMessages,
                  user_message: userMessage,
                  output: fullAssistantContent,
                  reasoning: fullReasoningContent || null,
                  prompt_tokens: finalInput,
                  completion_tokens: finalOutput,
                  cached_tokens: providerCachedTokens,
                  latency_ms: llmLogPayload.latencyMs,
                })
                .select('id')
                .single();
              if (logRow?.id != null) llmLogServerId = logRow.id;
            } catch (e) {
              console.warn('llm_logs insert skipped:', e);
            }
          }

          try {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ llmLog: { ...llmLogPayload, serverId: llmLogServerId } })}\n\n`
              )
            );
          } catch {}

          // Sync generated database IDs to the client SSE stream so client state uses real UUIDs
          if (savedUserMsgId || assistantMsgRow?.id || resolvedChatId !== chatId) {
            try {
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    metaSync: {
                      chatId: resolvedChatId,
                      userMsgId: savedUserMsgId,
                      assistantMsgId: assistantMsgRow?.id,
                      reasoning_duration_seconds: reasoningDurationSeconds,
                    },
                  })}\n\n`
                )
              );
            } catch {}
          }

          // Signal stream completion AND close
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
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
