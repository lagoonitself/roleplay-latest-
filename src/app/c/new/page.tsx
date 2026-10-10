'use client';

import React, { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Sparkles,
  Upload,
  Plus,
  Trash2,
  Check,
  Flame,
  Brain,
  Sliders,
  Image as ImageIcon,
  Link2,
  X,
  ChevronDown,
  MessageSquare,
  BookOpen,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { parseCharacterCardJson, parseCharacterFromPng } from '@/lib/cards/card-parser';
import { CharacterAvatar } from '@/components/character-avatar';
import { toast } from 'sonner';
import { saveLocalChat } from '@/lib/chats/chat-manager';
import type { Character } from '@/lib/supabase/types';
import { resolveLlmKey } from '@/lib/llm/credentials';

const POPULAR_TAGS = ['Fantasy', 'Romance', 'Sci-Fi', 'Cyberpunk', 'Mystery', 'Supernatural', 'Adventure', 'Companion'];

export default function CreateCharacterPage() {
  const router = useRouter();
  const [settings] = useSettings();
  const supabase = createClient();
  const imageInputRef = useRef<HTMLInputElement>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);

  // Character Core State
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [personality, setPersonality] = useState('');
  const [scenario, setScenario] = useState('');
  const [firstMessage, setFirstMessage] = useState('');
  const [alternateGreetings, setAlternateGreetings] = useState<string[]>([]);
  const [exampleDialogue, setExampleDialogue] = useState('');
  const [speechStyle, setSpeechStyle] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [postHistory, setPostHistory] = useState('');
  const [tags, setTags] = useState('Fantasy, Romance');
  const [contentRating, setContentRating] = useState<'sfw' | 'mature' | 'explicit'>('mature');

  // UI State
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Direct avatar file upload
  const handleAvatarFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose a valid image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setAvatarUrl(dataUrl);
      toast.success('Custom avatar loaded!');
    };
    reader.readAsDataURL(file);
  };

  // Card Import (supports Character Card V2 JSON and PNG embedded cards from Janitor AI, Chub AI, Tavern)
  const handleCardUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const buffer = event.target?.result as ArrayBuffer;
          const { character: parsed, avatarDataUrl } = parseCharacterFromPng(buffer);

          if (parsed.name) setName(parsed.name);
          if (parsed.tagline) setTagline(parsed.tagline);
          if (parsed.description) setDescription(parsed.description);
          if (parsed.personality) setPersonality(parsed.personality);
          if (parsed.scenario) setScenario(parsed.scenario);
          if (parsed.first_message) setFirstMessage(parsed.first_message);
          if (parsed.alternate_greetings && parsed.alternate_greetings.length > 0) {
            setAlternateGreetings(parsed.alternate_greetings);
          }
          if (parsed.example_dialogue) setExampleDialogue(parsed.example_dialogue);
          if (parsed.system_prompt) setSystemPrompt(parsed.system_prompt);
          if (parsed.post_history_instructions) setPostHistory(parsed.post_history_instructions);
          if (parsed.tags && parsed.tags.length > 0) setTags(parsed.tags.join(', '));
          if (avatarDataUrl) setAvatarUrl(avatarDataUrl);

          toast.success(`Imported PNG card: "${parsed.name || file.name}" with avatar!`);
        } catch (err) {
          toast.error((err instanceof Error ? err.message : '') || 'Failed to read PNG character card');
        }
      };
      reader.readAsArrayBuffer(file);
      return;
    }

    // JSON character card
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const { character: parsed } = parseCharacterCardJson(text);

        if (parsed.name) setName(parsed.name);
        if (parsed.tagline) setTagline(parsed.tagline);
        if (parsed.description) setDescription(parsed.description);
        if (parsed.personality) setPersonality(parsed.personality);
        if (parsed.scenario) setScenario(parsed.scenario);
        if (parsed.first_message) setFirstMessage(parsed.first_message);
        if (parsed.alternate_greetings && parsed.alternate_greetings.length > 0) {
          setAlternateGreetings(parsed.alternate_greetings);
        }
        if (parsed.example_dialogue) setExampleDialogue(parsed.example_dialogue);
        if (parsed.system_prompt) setSystemPrompt(parsed.system_prompt);
        if (parsed.post_history_instructions) setPostHistory(parsed.post_history_instructions);
        if (parsed.tags && parsed.tags.length > 0) setTags(parsed.tags.join(', '));

        toast.success(`Imported character card: "${parsed.name || 'Character'}"`);
      } catch {
        toast.error('Failed to parse card file. Ensure it is a valid Character Card JSON.');
      }
    };
    reader.readAsText(file);
  };

  // AI Generation with DeepSeek V4.1 Flash
  const handleGenerateWithAI = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);

    try {
      const res = await fetch('/api/character/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: aiPrompt.trim(),
          apiKey: await resolveLlmKey(settings),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Generation failed');
      }

      const char = await res.json();
      if (char.name) setName(char.name);
      if (char.tagline) setTagline(char.tagline);
      if (char.description) setDescription(char.description);
      if (char.personality) setPersonality(char.personality);
      if (char.scenario) setScenario(char.scenario);
      if (char.first_message) setFirstMessage(char.first_message);
      if (char.alternate_greetings && Array.isArray(char.alternate_greetings) && char.alternate_greetings.length > 0) {
        setAlternateGreetings(char.alternate_greetings);
      }
      if (char.example_dialogue) setExampleDialogue(char.example_dialogue);
      if (char.speech_style) setSpeechStyle(char.speech_style);
      if (char.system_prompt) setSystemPrompt(char.system_prompt);
      if (char.post_history_instructions) setPostHistory(char.post_history_instructions);
      if (char.tags) {
        if (Array.isArray(char.tags)) setTags(char.tags.join(', '));
        else if (typeof char.tags === 'string') setTags(char.tags);
      }
      if (char.content_rating) setContentRating(char.content_rating);
      if (char.accent_color) setAccentColor(char.accent_color);

      setAiModalOpen(false);
      setAiPrompt('');
      toast.success(`Generated "${char.name}" successfully!`);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : '') || 'Generation error');
    } finally {
      setAiLoading(false);
    }
  };

  // Save Character
  const handleSaveCharacter = async () => {
    if (!name.trim()) {
      toast.error('Character Name is required');
      return;
    }
    if (!firstMessage.trim()) {
      toast.error('First Message is required to start a roleplay');
      return;
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    const parsedTags = tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const characterPayload = {
      name: name.trim(),
      avatar_url: avatarUrl.trim() || null,
      accent_color: accentColor || null,
      tagline: tagline.trim(),
      description: description.trim(),
      personality: personality.trim(),
      scenario: scenario.trim(),
      first_message: firstMessage.trim(),
      alternate_greetings: alternateGreetings,
      example_dialogue: exampleDialogue.trim(),
      speech_style: speechStyle.trim(),
      system_prompt: systemPrompt.trim(),
      post_history_instructions: postHistory.trim(),
      tags: parsedTags,
      content_rating: contentRating,
      behavior: {
        pov: '2nd',
        tense: 'present',
        verbosity: 'medium',
        temperature: settings.defaultTemperature,
      },
    };

    if (userId) {
      const { data, error } = await supabase
        .from('characters')
        .insert({
          user_id: userId,
          ...characterPayload,
        })
        .select()
        .single();

      if (error) {
        toast.error('Database save error: ' + error.message);
        return;
      }

      // Persist to local cache for instant offline access
      try {
        const localList: Character[] = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
        const filtered = localList.filter((c) => c.name !== name.trim());
        localStorage.setItem('cadenza_local_characters', JSON.stringify([data, ...filtered]));
      } catch {}

      toast.success(`Character "${name}" saved!`);
      router.push(`/c/${data.id}`);
      return;
    }

    // Local session fallback
    const localCharId = `local-char-${Date.now()}`;
    const localChar = {
      id: localCharId,
      user_id: 'guest',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...characterPayload,
    };
    try {
      const localList: Character[] = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      const filtered = localList.filter((c) => c.name !== name.trim());
      localStorage.setItem('cadenza_local_characters', JSON.stringify([localChar, ...filtered]));
    } catch {}

    toast.success(`Character "${name}" created! Starting chat...`);
    const localChatId = 'local-' + Date.now();
    saveLocalChat({
      id: localChatId,
      user_id: 'guest',
      character_id: localCharId,
      character: localChar as Character,
      persona_id: null,
      title: `Chat with ${name}`,
      leaf_id: null,
      memory_cursor_id: null,
      authors_note: '',
      settings: {},
      pinned: false,
      archived: false,
      message_count: 1,
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    router.push(`/chat/${localChatId}?charId=${encodeURIComponent(localCharId)}`);
  };

  const handleAddTag = (tagToAdd: string) => {
    const current = tags.split(',').map((t) => t.trim()).filter(Boolean);
    if (!current.includes(tagToAdd)) {
      setTags([...current, tagToAdd].join(', '));
    }
  };

  return (
    <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
      {/* Studio header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-line">
        <div className="flex items-center gap-3">
          <Link href="/" className="icon-btn" aria-label="Back to explore">
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="type-page">Character studio</h1>
            </div>
            <p className="type-meta mt-0.5">
              Design persona, sensory details, and opening narrative
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            type="button"
            onClick={() => cardInputRef.current?.click()}
            className="btn btn-quiet flex items-center gap-1.5"
            title="Import Janitor AI, Chub AI, or Tavern card"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden />
            <span>Import card</span>
          </button>
          <input
            ref={cardInputRef}
            type="file"
            accept=".json, .png, image/png, application/json"
            onChange={handleCardUpload}
            className="hidden"
            aria-label="Import character card file"
          />

          <button
            type="button"
            onClick={() => setAiModalOpen(true)}
            className="btn btn-ghost flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            <span>Generate with AI</span>
          </button>

          <button
            type="button"
            onClick={handleSaveCharacter}
            className="btn btn-primary flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" aria-hidden />
            <span>Save and start</span>
          </button>
        </div>
      </div>

      {/* 2-column studio layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left column: sticky live preview and identity */}
        <div className="lg:col-span-4 xl:col-span-4 space-y-6 lg:sticky lg:top-6">
          {/* Live preview plate */}
          <div>
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-line">
              <CharacterAvatar
                name={name || 'Character'}
                avatarUrl={avatarUrl}
                accentColor={accentColor}
                className="w-full h-full"
              />
              {contentRating !== 'sfw' && (
                <div className="absolute top-3 left-3">
                  <span className="chip chip-danger flex items-center gap-1">
                    <Flame className="w-3 h-3" aria-hidden />
                    18+
                  </span>
                </div>
              )}
            </div>
            <h2 className="type-display text-xl mt-3 line-clamp-1">
              {name || 'Character name'}
            </h2>
            <p className="type-meta mt-0.5 line-clamp-2 leading-relaxed">
              {tagline || 'Your character tagline and hook will appear here…'}
            </p>

            {/* Avatar controls */}
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="btn btn-quiet flex items-center gap-1"
                >
                  <ImageIcon className="w-3.5 h-3.5" aria-hidden />
                  Upload image
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileUpload}
                  className="hidden"
                  aria-label="Upload avatar image"
                />
                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="btn btn-quiet flex items-center gap-1"
                >
                  <Link2 className="w-3.5 h-3.5" aria-hidden />
                  Image URL
                </button>
              </div>

              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="btn btn-quiet text-danger"
                  title="Remove image and use procedural avatar"
                >
                  Clear image
                </button>
              )}
            </div>

            {showUrlInput && (
              <div className="mt-2 space-y-2">
                <label htmlFor="studio-avatar-url" className="type-label">
                  Image URL
                </label>
                <input
                  id="studio-avatar-url"
                  type="url"
                  placeholder="https://example.com/character.png…"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  className="field"
                />
                <p className="type-meta">
                  Leave blank to use the generated avatar with a custom monogram.
                </p>
              </div>
            )}
          </div>

          {/* Identity and metadata */}
          <div className="surface rounded-xl p-5 space-y-4">
            <h3 className="type-sec">Identity and configuration</h3>

            <div className="space-y-1.5">
              <label htmlFor="studio-name" className="type-label">
                Name <span className="text-accent-text">*</span>
              </label>
              <input
                id="studio-name"
                type="text"
                placeholder="e.g. Seraphina Vance…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="field font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="studio-tagline" className="type-label">
                Tagline
              </label>
              <input
                id="studio-tagline"
                type="text"
                placeholder="e.g. Ruthless spymaster in the gilded court…"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="field"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="studio-rating" className="type-label">
                Content rating
              </label>
              <select
                id="studio-rating"
                value={contentRating}
                onChange={(e) => setContentRating(e.target.value as 'sfw' | 'mature' | 'explicit')}
                className="field cursor-pointer"
              >
                <option value="sfw">SFW (general audiences)</option>
                <option value="mature">Mature 18+ (intense drama, adult themes)</option>
                <option value="explicit">Explicit 18+ (unrestricted fiction)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="studio-tags" className="type-label">
                Tags
              </label>
              <input
                id="studio-tags"
                type="text"
                placeholder="Fantasy, Romance, Mystery…"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="field"
              />
              <div className="flex flex-wrap gap-1.5 pt-1">
                {POPULAR_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAddTag(tag)}
                    className="chip"
                  >
                    +{tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right column: editor */}
        <div className="lg:col-span-8 xl:col-span-8 space-y-6">
          {/* First message */}
          <div className="surface rounded-xl p-6 sm:p-7 space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h2 className="type-sec flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-ink-3" aria-hidden />
                  First message and opening scene
                  <span className="text-accent-text">*</span>
                </h2>
                <p className="type-meta mt-0.5">
                  The initial greeting that starts your roleplay session
                </p>
              </div>
              <span className="type-code text-ink-3 hidden sm:inline">
                *actions*, dialogue
              </span>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="studio-first-message" className="type-label">
                Opening message
              </label>
              <textarea
                id="studio-first-message"
                rows={9}
                placeholder='*Rain lashes against the stained-glass window as she turns slowly to face you…*&#10;&#10;"You kept me waiting," she murmurs, her gaze piercing through the shadows. "I trust you brought what I asked for?"…'
                value={firstMessage}
                onChange={(e) => setFirstMessage(e.target.value)}
                className="field font-serif text-[0.95rem] leading-[1.7]"
              />
            </div>

            {/* Alternate greetings */}
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between">
                <span className="type-label">
                  Alternate greetings
                </span>
                <button
                  type="button"
                  onClick={() => setAlternateGreetings([...alternateGreetings, ''])}
                  className="btn btn-quiet flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden />
                  Add greeting
                </button>
              </div>

              {alternateGreetings.map((greeting, idx) => (
                <div key={idx} className="surface rounded-xl flex gap-2 items-start p-3">
                  <div className="flex-1 space-y-1 min-w-0">
                    <span className="type-code text-ink-3">
                      Swipe {idx + 2}
                    </span>
                    <label htmlFor={`studio-swipe-${idx}`} className="sr-only">
                      Alternate greeting {idx + 2}
                    </label>
                    <textarea
                      id={`studio-swipe-${idx}`}
                      rows={3}
                      value={greeting}
                      onChange={(e) => {
                        const copy = [...alternateGreetings];
                        copy[idx] = e.target.value;
                        setAlternateGreetings(copy);
                      }}
                      placeholder={`Alternate opening scenario ${idx + 2}…`}
                      className="field"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAlternateGreetings(alternateGreetings.filter((_, i) => i !== idx))
                    }
                    className="icon-btn shrink-0"
                    aria-label={`Remove alternate greeting ${idx + 2}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Personality */}
          <div className="surface rounded-xl p-6 sm:p-7 space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="type-sec flex items-center gap-2">
                <Brain className="w-4 h-4 text-ink-3" aria-hidden />
                Personality and psychology
              </h2>
              <p className="type-meta mt-0.5">
                Core desires, internal conflicts, temperament, quirks, and relationship dynamics
              </p>
            </div>
            <label htmlFor="studio-personality" className="sr-only">
              Personality and psychology
            </label>
            <textarea
              id="studio-personality"
              rows={5}
              placeholder="e.g. Enigmatic, sharp-tongued, fiercely calculating. Distrusts easy intimacy after past betrayals…"
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="field leading-relaxed"
            />
          </div>

          {/* Scenario */}
          <div className="surface rounded-xl p-6 sm:p-7 space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="type-sec flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-ink-3" aria-hidden />
                Scenario and setting
              </h2>
              <p className="type-meta mt-0.5">
                The world, the immediate environment, and the tension with you
              </p>
            </div>
            <label htmlFor="studio-scenario" className="sr-only">
              Scenario and setting
            </label>
            <textarea
              id="studio-scenario"
              rows={4}
              placeholder="e.g. High above the smog of the neo-Victorian metropolis, inside a dimly lit clocktower library. A storm rages outside…"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="field leading-relaxed"
            />
          </div>

          {/* Appearance */}
          <div className="surface rounded-xl p-6 sm:p-7 space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="type-sec">
                Appearance and sensory presence
              </h2>
              <p className="type-meta mt-0.5">
                Physical features, attire, expression, scent, posture, and sensory impact
              </p>
            </div>
            <label htmlFor="studio-appearance" className="sr-only">
              Appearance and sensory presence
            </label>
            <textarea
              id="studio-appearance"
              rows={4}
              placeholder="e.g. Tall and slender with an effortless aristocratic posture. Raven-black hair pinned loosely with silver quills…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="field leading-relaxed"
            />
          </div>

          {/* Speech style */}
          <div className="surface rounded-xl p-6 sm:p-7 space-y-4">
            <div className="border-b border-line pb-3">
              <h2 className="type-sec">
                Speech style and voice cadence
              </h2>
              <p className="type-meta mt-0.5">
                How they speak: rhythm, register, accent, catchphrases, and emotional tone
              </p>
            </div>
            <label htmlFor="studio-speech" className="sr-only">
              Speech style and voice cadence
            </label>
            <input
              id="studio-speech"
              type="text"
              placeholder="e.g. Speaks in a low, measured cadence with razor-sharp wit and dry irony…"
              value={speechStyle}
              onChange={(e) => setSpeechStyle(e.target.value)}
              className="field"
            />
          </div>

          {/* Advanced directives */}
          <div className="surface rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full p-6 text-left flex items-center justify-between"
              aria-expanded={showAdvanced}
            >
              <div className="flex items-center gap-2.5">
                <Sliders className="w-4 h-4 text-ink-3" aria-hidden />
                <div>
                  <h3 className="type-sec">
                    Advanced directives
                  </h3>
                  <p className="type-meta">
                    Example dialogue, system prompt overrides, and post-history directives
                  </p>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-ink-3 transition-transform duration-150 ${showAdvanced ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>

            {showAdvanced && (
              <div className="p-6 pt-0 space-y-5 border-t border-line animate-in fade-in duration-150">
                <div className="space-y-1.5 pt-4">
                  <div className="flex items-center justify-between">
                    <label htmlFor="studio-example-dialogue" className="type-label">
                      Example dialogue
                    </label>
                    <span className="type-code text-ink-3">
                      &lt;START&gt; &lt;USER&gt; … &lt;BOT&gt; …
                    </span>
                  </div>
                  <textarea
                    id="studio-example-dialogue"
                    rows={5}
                    placeholder={`<START>\n<USER>: "Do you really think you can get away with this?"\n<BOT>: *A slow, razor-edged smile touches her lips.* "My dear, I already have."…`}
                    value={exampleDialogue}
                    onChange={(e) => setExampleDialogue(e.target.value)}
                    className="field type-code !text-[0.8rem] !leading-relaxed"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="studio-system-prompt" className="type-label">
                    Custom system prompt
                  </label>
                  <textarea
                    id="studio-system-prompt"
                    rows={4}
                    placeholder="Instructions for the system message (e.g. Always respond in first person; linger on sensory detail…)…"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="field"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="studio-post-history" className="type-label">
                    Post-history steering
                  </label>
                  <input
                    id="studio-post-history"
                    type="text"
                    placeholder="e.g. [Write with atmospheric nuance. Never speak on behalf of {{user}}.]…"
                    value={postHistory}
                    onChange={(e) => setPostHistory(e.target.value)}
                    className="field"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bottom save bar */}
          <div className="surface rounded-xl flex items-center justify-between gap-4 p-4">
            <p className="type-meta">
              Ready to roleplay? Your character saves to your roster.
            </p>
            <button
              type="button"
              onClick={handleSaveCharacter}
              className="btn btn-primary flex items-center gap-2 shrink-0"
            >
              <Check className="w-4 h-4" aria-hidden />
              <span>Save and start roleplay</span>
            </button>
          </div>
        </div>
      </div>

      {/* AI generator modal */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="panel rounded-2xl shadow-float w-full max-w-xl p-6 sm:p-7 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 type-sec">
                <Sparkles className="w-4 h-4 text-ink-3" aria-hidden />
                <span>AI character generator</span>
              </div>
              <button
                type="button"
                onClick={() => setAiModalOpen(false)}
                className="icon-btn"
                aria-label="Close generator"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>

            <p className="type-meta leading-relaxed">
              Describe your idea, or paste a bio from another app. Details you specify — name,
              traits, tone, rating — are kept exactly; the generator only fills the gaps: appearance,
              greeting, scenario, psychology, and speech style.
            </p>

            <label htmlFor="studio-ai-prompt" className="sr-only">
              Character idea
            </label>
            <textarea
              id="studio-ai-prompt"
              rows={6}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. A stoic ex-knight who runs a secret apothecary in an enemy kingdom…"
              className="field leading-relaxed"
            />

            <div className="flex items-center justify-between pt-2">
              <span className="type-meta hidden sm:inline">
                Full output, uncapped roleplay depth
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setAiModalOpen(false)}
                  className="btn btn-quiet"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleGenerateWithAI}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="btn btn-primary flex items-center gap-1.5 disabled:opacity-50"
                >
                  {aiLoading ? (
                    <>
                      <Sparkles className="w-3.5 h-3.5 animate-spin" aria-hidden />
                      Generating character…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" aria-hidden />
                      Generate character
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
