'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { parseCharacterCardJson } from '@/lib/cards/card-parser';
import { toast } from 'sonner';

export default function CreateCharacterPage() {
  const router = useRouter();
  const [settings] = useSettings();
  const supabase = createClient();

  const [activeTab, setActiveTab] = useState<'basics' | 'definition' | 'greetings' | 'advanced'>('basics');

  // Character state
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
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

  // AI Generation Modal
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Card Import
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = parseCharacterCardJson(text);

        if (parsed.name) setName(parsed.name);
        if (parsed.description) setDescription(parsed.description);
        if (parsed.personality) setPersonality(parsed.personality);
        if (parsed.scenario) setScenario(parsed.scenario);
        if (parsed.first_message) setFirstMessage(parsed.first_message);
        if (parsed.alternate_greetings) setAlternateGreetings(parsed.alternate_greetings);
        if (parsed.example_dialogue) setExampleDialogue(parsed.example_dialogue);
        if (parsed.system_prompt) setSystemPrompt(parsed.system_prompt);
        if (parsed.post_history_instructions) setPostHistory(parsed.post_history_instructions);
        if (parsed.tags) setTags(parsed.tags.join(', '));

        toast.success(`Imported character card: "${parsed.name || 'Character'}"`);
      } catch {
        toast.error('Failed to parse card file. Ensure it is a valid Character Card JSON.');
      }
    };
    reader.readAsText(file);
  };

  // AI Generation
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
      if (char.speech_style) setSpeechStyle(char.speech_style);
      if (char.example_dialogue) setExampleDialogue(char.example_dialogue);
      if (char.tags) setTags(char.tags.join(', '));
      if (char.content_rating) setContentRating(char.content_rating);

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
      avatar_url: avatarUrl.trim() || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
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

      toast.success(`Character "${name}" saved!`);
      router.push(`/c/${data.id}`);
      return;
    }

    // Local session fallback
    toast.success(`Character "${name}" ready! Starting chat...`);
    const localChatId = 'local-' + Date.now();
    router.push(`/chat/${localChatId}?charId=${encodeURIComponent(name.trim())}`);
  };

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 md:py-10 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Create Character</h1>
            <p className="text-xs text-muted-foreground">
              Define appearance, psychology, speech style, and opening scenario
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* Card Import */}
          <label className="px-3.5 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-xs font-medium apple-button flex items-center gap-1.5 cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
            <span>Import Card</span>
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>

          {/* AI Generate */}
          <button
            onClick={() => setAiModalOpen(true)}
            className="px-3.5 py-1.5 rounded-full bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20 text-xs font-medium apple-button flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate with AI
          </button>

          {/* Save & Chat */}
          <button
            onClick={handleSaveCharacter}
            className="px-4 py-1.5 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-semibold apple-button flex items-center gap-1.5 shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            Save & Chat
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] w-full sm:w-auto overflow-x-auto scrollbar-none text-xs font-medium">
        {[
          { id: 'basics', label: '1. Identity & Look' },
          { id: 'definition', label: '2. Persona & Scenario' },
          { id: 'greetings', label: '3. Greetings' },
          { id: 'advanced', label: '4. Advanced & Dialogue' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-1.5 rounded-xl transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-background text-foreground shadow-xs font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Basics */}
      {activeTab === 'basics' && (
        <div className="space-y-6 glass-card p-6 sm:p-8 rounded-3xl animate-in fade-in duration-150">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Avatar Preview */}
            <div className="flex flex-col items-center space-y-3">
              <div className="w-36 h-36 rounded-3xl overflow-hidden bg-black/10 border-2 border-dashed border-black/10 dark:border-white/10 flex items-center justify-center relative shadow-sm">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt="Preview"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground text-center px-4">
                    Paste image URL below
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground">Avatar Preview</span>
            </div>

            {/* Inputs */}
            <div className="md:col-span-2 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Character Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Seraphina Vance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Tagline (One-line Hook)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Ruthless spymaster in the gilded clockwork court."
                  value={tagline}
                  onChange={(e) => setTagline(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                  Avatar Image URL
                </label>
                <input
                  type="url"
                  placeholder="https://images.unsplash.com/..."
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Tags (Comma-separated)
                  </label>
                  <input
                    type="text"
                    placeholder="Fantasy, Romance, Mystery"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                    Content Rating
                  </label>
                  <select
                    value={contentRating}
                    onChange={(e) => setContentRating(e.target.value as any)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="sfw">SFW (General Audiences)</option>
                    <option value="mature">Mature 18+ (Intense drama, adult themes)</option>
                    <option value="explicit">Explicit 18+ (Unrestricted fiction)</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Definition */}
      {activeTab === 'definition' && (
        <div className="space-y-5 glass-card p-6 sm:p-8 rounded-3xl animate-in fade-in duration-150">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Description & Appearance
            </label>
            <textarea
              rows={3}
              placeholder="Physical features, clothing, sensory presence, voice tone..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Personality & Psychology
            </label>
            <textarea
              rows={3}
              placeholder="Motivations, psychological depth, flaws, habits, quirks, moral alignment..."
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Scenario & Setting
            </label>
            <textarea
              rows={3}
              placeholder="Where does the roleplay begin? What is the current atmosphere and situation between {{char}} and {{user}}?"
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Speech Style & Cadence
            </label>
            <input
              type="text"
              placeholder="e.g. Velvety, aristocratic cadence with dry wit and subtle menace."
              value={speechStyle}
              onChange={(e) => setSpeechStyle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>
      )}

      {/* Tab 3: Greetings */}
      {activeTab === 'greetings' && (
        <div className="space-y-6 glass-card p-6 sm:p-8 rounded-3xl animate-in fade-in duration-150">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                First Message (Opening Scene) *
              </label>
              <span className="text-[11px] text-muted-foreground">
                Use *italics* for actions, "quotes" for dialogue
              </span>
            </div>
            <textarea
              rows={6}
              placeholder='*Rain lashes against the window...* "You are late," she says quietly.'
              value={firstMessage}
              onChange={(e) => setFirstMessage(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 leading-relaxed"
            />
          </div>

          {/* Alternate Greetings */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Alternate Greetings (Swipes)
              </label>
              <button
                type="button"
                onClick={() => setAlternateGreetings([...alternateGreetings, ''])}
                className="px-3 py-1 rounded-full bg-accent/10 text-accent hover:bg-accent/20 text-xs font-semibold apple-button flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Alternate
              </button>
            </div>

            {alternateGreetings.map((greeting, idx) => (
              <div key={idx} className="flex gap-2">
                <textarea
                  rows={3}
                  value={greeting}
                  onChange={(e) => {
                    const copy = [...alternateGreetings];
                    copy[idx] = e.target.value;
                    setAlternateGreetings(copy);
                  }}
                  placeholder={`Alternate greeting #${idx + 2}...`}
                  className="flex-1 p-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <button
                  type="button"
                  onClick={() =>
                    setAlternateGreetings(alternateGreetings.filter((_, i) => i !== idx))
                  }
                  className="p-2 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors self-start"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: Advanced */}
      {activeTab === 'advanced' && (
        <div className="space-y-5 glass-card p-6 sm:p-8 rounded-3xl animate-in fade-in duration-150">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Example Dialogue (Character Card V2 Style)
            </label>
            <textarea
              rows={4}
              placeholder={`<START>\n<USER>: "What do you want?"\n<BOT>: *Smirks slightly* "Everything."`}
              value={exampleDialogue}
              onChange={(e) => setExampleDialogue(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Custom Creator Instructions (System Prompt Override)
            </label>
            <textarea
              rows={3}
              placeholder="Additional directives passed directly to the model..."
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="w-full p-3.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Post-History Steering Instructions
            </label>
            <input
              type="text"
              placeholder="Directive appended at the very end of every turn..."
              value={postHistory}
              onChange={(e) => setPostHistory(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>
        </div>
      )}

      {/* AI Generate Modal */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg glass-panel rounded-3xl p-6 space-y-4 shadow-2xl border border-white/10">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-purple-500 font-semibold text-sm">
                <Sparkles className="w-4 h-4" />
                Generate Character with DeepSeek V4.1 Flash
              </div>
              <button
                onClick={() => setAiModalOpen(false)}
                className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Describe your character concept in one sentence. DeepSeek will invent the name, background, psychology, opening scene, and dialogue style.
            </p>

            <textarea
              rows={3}
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              placeholder="e.g. A brooding cyberpunk bounty hunter with cybernetic eyes who tracks a rogue android through a neon rainstorm..."
              className="w-full p-3.5 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setAiModalOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-full hover:bg-black/5 dark:hover:bg-white/10 apple-button"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerateWithAI}
                disabled={aiLoading || !aiPrompt.trim()}
                className="px-5 py-2 text-xs font-semibold rounded-full bg-purple-600 hover:bg-purple-700 text-white apple-button flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                {aiLoading ? (
                  <>
                    <Sparkles className="w-3.5 h-3.5 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Generate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
