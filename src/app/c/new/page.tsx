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
  FileCode,
  Image as ImageIcon,
  Link2,
  X,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  BookOpen,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { parseCharacterCardJson, parseCharacterFromPng } from '@/lib/cards/card-parser';
import { CharacterAvatar } from '@/components/character-avatar';
import { toast } from 'sonner';

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
  const [accentColor, setAccentColor] = useState('#8b5cf6');
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
        } catch (err: any) {
          toast.error(err.message || 'Failed to read PNG character card');
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
        const parsed = parseCharacterCardJson(text);

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
          apiKey: settings.opencodeApiKey,
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
      toast.success(`Generated "${char.name}" with DeepSeek V4.1 Flash!`);
    } catch (err: any) {
      toast.error(err.message || 'Generation error');
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
        const localList = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
        const filtered = localList.filter((c: any) => c.name !== name.trim());
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
      const localList = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      const filtered = localList.filter((c: any) => c.name !== name.trim());
      localStorage.setItem('cadenza_local_characters', JSON.stringify([localChar, ...filtered]));
    } catch {}

    toast.success(`Character "${name}" created! Starting chat...`);
    const localChatId = 'local-' + Date.now();
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
      {/* Studio Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            title="Back to Roster"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Character Studio</h1>
              <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-semibold uppercase tracking-wider">
                V2 Studio
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Design persona, sensory details, and opening narrative
            </p>
          </div>
        </div>

        {/* Global Toolbar Actions */}
        <div className="flex items-center flex-wrap gap-2">
          {/* Card Import */}
          <button
            onClick={() => cardInputRef.current?.click()}
            className="px-3.5 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-xs font-medium apple-button flex items-center gap-1.5"
            title="Import Janitor AI, Chub AI, or Tavern Card"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Card</span>
          </button>
          <input
            ref={cardInputRef}
            type="file"
            accept=".json, .png, image/png, application/json"
            onChange={handleCardUpload}
            className="hidden"
          />

          {/* AI Generator CTA */}
          <button
            onClick={() => setAiModalOpen(true)}
            className="px-3.5 py-1.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 text-xs font-medium apple-button flex items-center gap-1.5 border border-purple-500/20"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate with AI</span>
          </button>

          {/* Primary Save & Start Chat */}
          <button
            onClick={handleSaveCharacter}
            className="px-4 py-1.5 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-semibold apple-button flex items-center gap-1.5 shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Save & Start</span>
          </button>
        </div>
      </div>

      {/* 2-Column Responsive Studio Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: Sticky Live Preview & Identity Card */}
        <div className="lg:col-span-4 xl:col-span-4 space-y-6 lg:sticky lg:top-6">
          {/* Live Card Preview */}
          <div className="glass-card rounded-3xl overflow-hidden border border-black/[0.06] dark:border-white/[0.08] shadow-sm">
            {/* Live Avatar Preview Container */}
            <div className="relative h-64 sm:h-72 w-full overflow-hidden bg-black/10 flex items-center justify-center">
              <CharacterAvatar
                name={name || 'Character'}
                avatarUrl={avatarUrl}
                accentColor={accentColor}
                className="w-full h-full"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent pointer-events-none" />

              {/* Rating Badge */}
              {contentRating !== 'sfw' && (
                <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-red-500/80 backdrop-blur-md text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1 shadow-sm">
                  <Flame className="w-3 h-3" />
                  18+
                </div>
              )}

              {/* Bottom Card Title Overlay */}
              <div className="absolute bottom-4 left-4 right-4 text-white">
                <h2 className="font-bold text-lg sm:text-xl tracking-tight line-clamp-1">
                  {name || 'Character Name'}
                </h2>
                <p className="text-xs text-white/80 line-clamp-2 mt-0.5 leading-relaxed">
                  {tagline || 'Your character tagline and hook will appear here...'}
                </p>
              </div>
            </div>

            {/* Avatar Controls Bar */}
            <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] border-t border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-[11px] font-medium apple-button flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  Upload Image
                </button>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileUpload}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="px-2.5 py-1.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-[11px] font-medium apple-button flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  Image URL
                </button>
              </div>

              {avatarUrl && (
                <button
                  type="button"
                  onClick={() => setAvatarUrl('')}
                  className="px-2 py-1 rounded-xl text-red-500 hover:bg-red-500/10 text-[11px] font-medium transition-colors"
                  title="Remove image and use procedural SVG"
                >
                  Clear Image
                </button>
              )}
            </div>

            {/* URL Input Drawer */}
            {showUrlInput && (
              <div className="p-3 border-t border-black/[0.04] dark:border-white/[0.06] bg-black/[0.02] dark:bg-white/[0.02] space-y-2">
                <input
                  type="url"
                  placeholder="https://example.com/character.png"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-lg bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <p className="text-[10px] text-muted-foreground">
                  Leave blank to use the high-fidelity SVG avatar with custom monogram.
                </p>
              </div>
            )}
          </div>

          {/* Identity & Metadata Form Box */}
          <div className="glass-card rounded-3xl p-5 space-y-4 border border-black/[0.06] dark:border-white/[0.08]">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Identity & Configuration
            </h3>

            {/* Character Name */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/90">
                Name <span className="text-accent">*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. Seraphina Vance"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-medium"
              />
            </div>

            {/* Tagline */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/90">
                Tagline (Hook)
              </label>
              <input
                type="text"
                placeholder="e.g. Ruthless spymaster in the gilded court."
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>

            {/* Content Rating */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/90">
                Content Rating
              </label>
              <select
                value={contentRating}
                onChange={(e) => setContentRating(e.target.value as any)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 cursor-pointer"
              >
                <option value="sfw">SFW (General Audiences)</option>
                <option value="mature">Mature 18+ (Intense drama, adult themes)</option>
                <option value="explicit">Explicit 18+ (Unrestricted fiction)</option>
              </select>
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground/90">
                Tags (Comma-separated)
              </label>
              <input
                type="text"
                placeholder="Fantasy, Romance, Mystery"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              {/* Quick Tag Pills */}
              <div className="flex flex-wrap gap-1 pt-1">
                {POPULAR_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAddTag(tag)}
                    className="px-2 py-0.5 rounded-md bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    +{tag}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Streamlined Canvas & Editor */}
        <div className="lg:col-span-8 xl:col-span-8 space-y-6">
          {/* Section 1: Opening Scene (Most Critical) */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 space-y-4 border border-black/[0.06] dark:border-white/[0.08]">
            <div className="flex items-center justify-between border-b border-black/[0.04] dark:border-white/[0.06] pb-3">
              <div>
                <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-accent" />
                  First Message & Opening Scene
                  <span className="text-accent">*</span>
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The initial greeting that kickstarts your roleplay session
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                *actions*, "dialogue"
              </span>
            </div>

            <div className="space-y-2">
              <textarea
                rows={7}
                placeholder='*Rain lashes against the stained-glass window as she turns slowly to face you...*&#10;&#10;"You kept me waiting," she murmurs, her gaze piercing through the shadows. "I trust you brought what I asked for?"'
                value={firstMessage}
                onChange={(e) => setFirstMessage(e.target.value)}
                className="w-full p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40 font-normal"
              />
            </div>

            {/* Alternate Greetings / Swipes */}
            <div className="pt-2 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Alternate Greetings (Swipes)
                </span>
                <button
                  type="button"
                  onClick={() => setAlternateGreetings([...alternateGreetings, ''])}
                  className="px-3 py-1 rounded-full bg-accent/10 text-accent hover:bg-accent/20 text-xs font-semibold apple-button flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Swipe Option
                </button>
              </div>

              {alternateGreetings.map((greeting, idx) => (
                <div key={idx} className="flex gap-2 items-start">
                  <div className="flex-1 space-y-1">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Swipe #{idx + 2}
                    </span>
                    <textarea
                      rows={3}
                      value={greeting}
                      onChange={(e) => {
                        const copy = [...alternateGreetings];
                        copy[idx] = e.target.value;
                        setAlternateGreetings(copy);
                      }}
                      placeholder={`Alternate opening scenario #${idx + 2}...`}
                      className="w-full p-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-xs focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAlternateGreetings(alternateGreetings.filter((_, i) => i !== idx))
                    }
                    className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors mt-5"
                    title="Remove alternate greeting"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Personality & Psychology */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 space-y-4 border border-black/[0.06] dark:border-white/[0.08]">
            <div className="border-b border-black/[0.04] dark:border-white/[0.06] pb-3">
              <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-500" />
                Personality & Psychology
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Core desires, internal conflicts, temperament, behavioral quirks, and relationship dynamics
              </p>
            </div>
            <textarea
              rows={5}
              placeholder="e.g. Enigmatic, sharp-tongued, fiercely calculating. Distrusts easy intimacy due to past betrayals. Softens only when pushed to vulnerability..."
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="w-full p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Section 3: Scenario & Setting */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 space-y-4 border border-black/[0.06] dark:border-white/[0.08]">
            <div className="border-b border-black/[0.04] dark:border-white/[0.06] pb-3">
              <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-emerald-500" />
                Scenario & Setting
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                The world setting, immediate environment, atmosphere, and the existing tension with the user
              </p>
            </div>
            <textarea
              rows={4}
              placeholder="e.g. High above the smog of the neo-Victorian metropolis, inside a dimly lit clocktower library. A storm rages outside. You have arrived seeking forbidden trade secrets..."
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="w-full p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Section 4: Physical Presence & Appearance */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 space-y-4 border border-black/[0.06] dark:border-white/[0.08]">
            <div className="border-b border-black/[0.04] dark:border-white/[0.06] pb-3">
              <h2 className="text-base font-semibold tracking-tight">
                Appearance & Sensory Presence
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Physical features, attire, facial expressions, scent, posture, and sensory impact
              </p>
            </div>
            <textarea
              rows={4}
              placeholder="e.g. Tall and slender with an effortless aristocratic posture. Raven-black hair pinned loosely with silver quills, piercing amber eyes, tailored velvet coat..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Section 5: Speech Style & Cadence */}
          <div className="glass-card rounded-3xl p-6 sm:p-7 space-y-4 border border-black/[0.06] dark:border-white/[0.08]">
            <div className="border-b border-black/[0.04] dark:border-white/[0.06] pb-3">
              <h2 className="text-base font-semibold tracking-tight">
                Speech Style & Voice Cadence
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                How they speak: rhythm, formal vs casual, accents, catchphrases, and emotional tone
              </p>
            </div>
            <input
              type="text"
              placeholder="e.g. Speaks in a low, measured cadence with razor-sharp wit and subtle dry irony."
              value={speechStyle}
              onChange={(e) => setSpeechStyle(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Section 6: Advanced Directives (Collapsible Accordion) */}
          <div className="glass-card rounded-3xl overflow-hidden border border-black/[0.06] dark:border-white/[0.08]">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full p-6 text-left flex items-center justify-between hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Sliders className="w-4 h-4 text-muted-foreground" />
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">
                    Advanced Directives & Card V2 Definitions
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Example dialogues, custom system prompt overrides, and post-history directives
                  </p>
                </div>
              </div>
              {showAdvanced ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>

            {showAdvanced && (
              <div className="p-6 pt-0 space-y-5 border-t border-black/[0.04] dark:border-white/[0.06] animate-in fade-in duration-150">
                {/* Example Dialogue */}
                <div className="space-y-1.5 pt-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Example Dialogue (Character Card V2 Style)
                    </label>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      &lt;START&gt; &lt;USER&gt;: ... &lt;BOT&gt;: ...
                    </span>
                  </div>
                  <textarea
                    rows={5}
                    placeholder={`<START>\n<USER>: "Do you really think you can get away with this?"\n<BOT>: *A slow, razor-edged smile touches her lips.* "My dear, I already have."`}
                    value={exampleDialogue}
                    onChange={(e) => setExampleDialogue(e.target.value)}
                    className="w-full p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>

                {/* System Prompt Override */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Custom System Prompt Directives
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Instructions injected directly into the system message (e.g. Always respond in first-person; prioritize sensory descriptions of the weather...)"
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="w-full p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>

                {/* Post History Steering */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Post-History Steering Instruction
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. [Write with atmospheric nuance. Never summarize or speak on behalf of {{user}}.]"
                    value={postHistory}
                    onChange={(e) => setPostHistory(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Bottom Save Bar for convenience on mobile and desktop */}
          <div className="flex items-center justify-between p-4 rounded-3xl glass-card border border-black/[0.06] dark:border-white/[0.08]">
            <p className="text-xs text-muted-foreground">
              Ready to roleplay? All 14 traits are saved to your roster.
            </p>
            <button
              onClick={handleSaveCharacter}
              className="px-6 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover text-xs sm:text-sm font-semibold apple-button flex items-center gap-2 shadow-md shadow-accent/20"
            >
              <Check className="w-4 h-4" />
              <span>Save & Start Roleplay</span>
            </button>
          </div>
        </div>
      </div>

      {/* AI Generate Modal */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-xl glass-panel rounded-3xl p-6 sm:p-7 space-y-4 shadow-2xl border border-white/15">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-purple-500 font-semibold text-sm">
                <Sparkles className="w-4 h-4" />
                <span>DeepSeek V4.1 Flash • Character Generator</span>
              </div>
              <button
                onClick={() => setAiModalOpen(false)}
                className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Describe your idea, <strong>or paste copied text/bio from Janitor AI or Character.AI</strong>. DeepSeek will auto-generate all 14 traits: name, appearance, opening greeting, scenario, psychology, and speech style.
            </p>

            <textarea
              rows={6}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="Enter a prompt (e.g. 'A stoic ex-knight who runs a secret apothecary in an enemy kingdom...') OR paste copied text from another character..."
              className="w-full p-4 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 leading-relaxed"
            />

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                Full 8,192 token output • Uncapped roleplay depth
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={() => setAiModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium rounded-full hover:bg-black/5 dark:hover:bg-white/10 apple-button"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateWithAI}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="px-5 py-2 text-xs font-semibold rounded-full bg-purple-600 hover:bg-purple-700 text-white apple-button flex items-center gap-1.5 shadow-md shadow-purple-600/20 disabled:opacity-50"
                >
                  {aiLoading ? (
                    <>
                      <Sparkles className="w-3.5 h-3.5 animate-spin" />
                      Generating Character...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Generate Character
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
