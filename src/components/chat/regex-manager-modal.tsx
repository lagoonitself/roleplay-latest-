'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  Plus,
  RotateCcw,
  Download,
  Upload,
  Sparkles,
  Check,
  Trash2,
  Edit2,
  Sliders,
  Search,
  Eye,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type RegexScript,
  type RegexCategory,
  type RegexScope,
  type RegexTarget,
} from '@/lib/formatter/regex-engine';
import { useRegexScripts } from '@/lib/store/regex-store';
import { RoleplayMessageContent } from '@/components/chat/roleplay-message-content';

interface RegexManagerModalProps {
  open: boolean;
  onClose: () => void;
  characterName?: string;
  userName?: string;
  accentColor?: string | null;
}

const SAMPLE_SCENES = {
  roleplay: `*She pauses for a moment, her eyes shimmering with genuine intrigue.*

"Did you truly believe you could sneak past the citadel guard without notice?"

*Seraphina folds her arms, tossing a pair of dice onto the obsidian table.*
{{roll::2d6+2}}

<card title="Citadel Access Key" badge="Rare Item" icon="quest">
A weathered brass key stamped with the crest of the Silver Hand. Grants access to the lower vaults.
</card>

<status hp="85/100" mp="42/50" gold="150" />

<thought>
I wonder if they know what awaits them beneath the tower...
</thought>

((OOC: Feel free to roll your stealth check or attempt persuasion!))

---`,
  artifacts: `<think>
The user is asking a challenging question about ancient lore. I need to formulate a response that is immersive while maintaining Seraphina's secretive personality.
</think>

Certainly! Here is the continuation of the scene:

Seraphina: "Knowledge comes at a steep price in these forgotten halls." <|im_end|>

I hope this response meets your expectations! Let me know if you would like to continue.`,
};

export function RegexManagerModal({
  open,
  onClose,
  characterName = 'Seraphina',
  userName = 'Traveler',
  accentColor,
}: RegexManagerModalProps) {
  const { scripts, toggle, add, update, remove, reset, exportJson, importJson } = useRegexScripts();

  const [activeTab, setActiveTab] = useState<'rules' | 'sandbox'>('rules');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sandbox state
  const [sandboxText, setSandboxText] = useState(SAMPLE_SCENES.roleplay);
  const [sandboxView, setSandboxView] = useState<'rendered' | 'raw'>('rendered');

  // Rule editor state
  const [editingRule, setEditingRule] = useState<Partial<RegexScript> | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  // File import ref
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const activeCount = useMemo(() => scripts.filter((s) => s.enabled).length, [scripts]);

  // Escape closes regardless of where focus is (the modal previously had no
  // keyboard way to dismiss it at all).
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // Filtered scripts list
  const filteredScripts = useMemo(() => {
    return scripts.filter((script) => {
      if (selectedCategory !== 'all' && script.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          script.name.toLowerCase().includes(q) ||
          script.description.toLowerCase().includes(q) ||
          script.findRegex.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [scripts, selectedCategory, searchQuery]);

  if (!open) return null;

  // Handle Export
  const handleExport = () => {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cadenza-regex-scripts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // Deferred revoke: revoking synchronously can cancel the download in
    // some browsers before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Regex scripts exported (SillyTavern compatible)');
  };

  // Handle Import
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      const res = importJson(content);
      if (res.success) {
        toast.success(`Successfully imported ${res.count} regex rule${res.count === 1 ? '' : 's'}!`);
      } else {
        toast.error(`Import failed: ${res.error}`);
      }
    };
    reader.onerror = () => {
      toast.error('Could not read that file — please try another');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Open editor for a new rule
  const handleCreateNew = () => {
    setEditingRule({
      name: '',
      description: '',
      findRegex: '',
      replaceString: '',
      flags: 'g',
      scope: 'display',
      target: 'all',
      enabled: true,
      category: 'custom',
    });
    setIsEditorOpen(true);
  };

  // Open editor for existing rule
  const handleEditRule = (rule: RegexScript) => {
    setEditingRule({ ...rule });
    setIsEditorOpen(true);
  };

  // Save rule from editor
  const handleSaveEditor = () => {
    if (!editingRule?.name?.trim()) {
      toast.error('Rule name is required');
      return;
    }
    if (!editingRule?.findRegex?.trim()) {
      toast.error('Find regex pattern is required');
      return;
    }

    if (editingRule.id) {
      update(editingRule.id, editingRule);
      toast.success(`Updated "${editingRule.name}"`);
    } else {
      add({
        name: editingRule.name.trim(),
        description: editingRule.description?.trim() || 'Custom regex rule',
        findRegex: editingRule.findRegex.trim(),
        replaceString: editingRule.replaceString || '',
        flags: editingRule.flags || 'g',
        scope: (editingRule.scope as RegexScope) || 'display',
        target: (editingRule.target as RegexTarget) || 'all',
        enabled: editingRule.enabled ?? true,
        category: (editingRule.category as RegexCategory) || 'custom',
        isPreset: false,
      });
      toast.success(`Created rule "${editingRule.name}"`);
    }
    setIsEditorOpen(false);
    setEditingRule(null);
  };

  return (
    <div
      className="animate-in fade-in fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] p-0 sm:p-6 duration-200"
      style={{ height: 'var(--app-height, 100dvh)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Regex scripts and formatters"
        className="panel animate-in fade-in relative flex h-full max-h-none sm:h-[min(820px,calc(var(--app-height,100dvh)-1.5rem))] sm:max-h-[min(820px,calc(var(--app-height,100dvh)-1.5rem))] w-full max-w-4xl flex-col overflow-hidden rounded-none sm:rounded-2xl border-0 sm:border border-line bg-raised shadow-float duration-200 pt-safe pl-safe pr-safe sm:pl-0 sm:pr-0"
      >
        {/* Header — sticky on mobile and desktop */}
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-line bg-raised px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
            <Sparkles aria-hidden="true" className="h-5 w-5 shrink-0 text-accent-text" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                <h2 className="type-sec text-sm sm:text-base truncate">
                  Regex scripts & formatters
                </h2>
                <span className="chip chip-accent">
                  {activeCount} active
                </span>
              </div>
              <p className="type-meta mt-0.5 hidden xs:block sm:block truncate">
                Dialogue styling, model sanitizers, macros and SillyTavern regex transformations
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close regex manager"
            className="icon-btn shrink-0 min-h-11 min-w-11 sm:h-9 sm:w-9"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>

        {/* Tab & Toolbar Bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b border-line bg-raised px-4 py-2.5 sm:px-6 sm:py-3">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 rounded-full border border-line p-1 text-xs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'rules'}
              onClick={() => setActiveTab('rules')}
              className={`flex min-h-11 sm:min-h-[30px] items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors ${
                activeTab === 'rules'
                  ? 'bg-accent-wash font-semibold text-accent-text'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Layers aria-hidden="true" className="h-3.5 w-3.5" />
              Rules & formatters
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'sandbox'}
              onClick={() => setActiveTab('sandbox')}
              className={`flex min-h-11 sm:min-h-[30px] items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors ${
                activeTab === 'sandbox'
                  ? 'bg-accent-wash font-semibold text-accent-text'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              <Eye aria-hidden="true" className="h-3.5 w-3.5" />
              Live sandbox
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-1 text-xs">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
              aria-hidden
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn btn-quiet min-h-11 min-w-11 sm:min-h-8 sm:min-w-0 px-2.5"
              title="Import SillyTavern JSON regex scripts"
              aria-label="Import regex scripts"
            >
              <Upload aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Import</span>
            </button>
            <button
              type="button"
              onClick={handleExport}
              className="btn btn-quiet min-h-11 min-w-11 sm:min-h-8 sm:min-w-0 px-2.5"
              title="Export JSON"
              aria-label="Export JSON"
            >
              <Download aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (confirm('Reset all regex formatters to factory defaults?')) {
                  reset();
                  toast.success('Reset to default presets');
                }
              }}
              className="btn btn-quiet min-h-11 min-w-11 sm:min-h-8 sm:min-w-0 px-2.5"
              title="Reset to defaults"
              aria-label="Reset to default regex formatters"
            >
              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <button
              type="button"
              onClick={handleCreateNew}
              className="btn btn-primary min-h-11 sm:min-h-8 px-3.5"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              <span>New rule</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Rules & Presets */}
        {activeTab === 'rules' && (
          <div className="flex flex-1 flex-col overflow-hidden min-h-0">
            {/* Filter and Search Bar */}
            <div className="flex shrink-0 flex-col gap-2.5 border-b border-line bg-raised px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              {/* Category Pills */}
              <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto py-0.5 text-xs max-w-full">
                {[
                  { id: 'all', label: 'All rules' },
                  { id: 'dialogue', label: 'Dialogue & prose' },
                  { id: 'sanitizer', label: 'Sanitizers' },
                  { id: 'macro', label: 'Macros & rolls' },
                  { id: 'visual', label: 'Visual & RPG' },
                  { id: 'custom', label: 'Custom' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    aria-pressed={selectedCategory === cat.id}
                    className={
                      selectedCategory === cat.id
                        ? 'whitespace-nowrap shrink-0 rounded-full bg-accent px-3 py-1 font-semibold text-accent-ink min-h-11 sm:min-h-7 flex items-center'
                        : 'chip whitespace-nowrap shrink-0 min-h-11 sm:min-h-7 px-3'
                    }
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative w-full sm:w-60">
                <Search aria-hidden="true" className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
                <input
                  type="search"
                  enterKeyHint="search"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search rules, e.g. dialogue quotes…"
                  aria-label="Search rules"
                  className="field py-1.5 pl-8 text-xs min-h-11 sm:min-h-8"
                />
              </div>
            </div>

            {/* Rules List */}
            <div className="scroll-y flex-1 min-h-0 px-4 py-4 sm:px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:pb-6">
              {filteredScripts.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center gap-1.5 p-6 text-center">
                  <Sliders aria-hidden="true" className="mb-1 h-6 w-6 text-ink-3" />
                  <p className="type-sec">No rules match your filter</p>
                  <p className="type-meta">Clear the search or pick a different category.</p>
                </div>
              ) : (
                <div className="surface divide-y divide-line rounded-xl overflow-hidden">
                  {filteredScripts.map((script) => (
                    <div
                      key={script.id}
                      className={`p-3.5 sm:p-4 transition-[opacity] duration-150 ${
                        script.enabled ? '' : 'opacity-50'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 sm:gap-4">
                        {/* Left: Info & Badges */}
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium text-ink truncate max-w-[240px] sm:max-w-none">
                              {script.name}
                            </span>

                            {/* Category Badge */}
                            <span
                              className={
                                selectedCategory === script.category ? 'chip chip-accent' : 'chip'
                              }
                            >
                              {script.category}
                            </span>

                            {/* Scope Badge */}
                            <span className="chip">
                              Scope: {script.scope === 'display' ? 'Client display' : script.scope === 'prompt' ? 'Prompt time' : 'Both'}
                            </span>

                            {/* Target Badge */}
                            <span className="chip">
                              Target: {script.target === 'all' ? 'All roles' : script.target === 'assistant' ? 'AI assistant' : 'User'}
                            </span>

                            {script.isPreset && (
                              <span className="chip">
                                Preset
                              </span>
                            )}
                          </div>

                          <p className="text-xs leading-relaxed text-ink-2 break-words">
                            {script.description}
                          </p>

                          {/* Regex Pattern details */}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <div className="well type-code max-w-full overflow-x-auto px-2 py-1 text-ink-2">
                              <span className="select-none">Pattern: </span>
                              <span className="text-accent-text truncate">{script.findRegex}</span>
                            </div>
                            {script.replaceString && (
                              <div className="well type-code max-w-full overflow-x-auto px-2 py-1 text-ink-2">
                                <span aria-hidden="true" className="select-none">→ </span>
                                <span className="truncate">{script.replaceString}</span>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right: Toggle Switch & Actions — always visible, >=44px */}
                        <div className="flex shrink-0 items-center justify-between sm:justify-end gap-2 border-t border-line pt-2 sm:border-t-0 sm:pt-0">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleEditRule(script)}
                              aria-label={`Edit rule ${script.name}`}
                              title="Edit rule"
                              className="icon-btn min-h-11 min-w-11 sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
                            >
                              <Edit2 aria-hidden="true" className="h-4 w-4" />
                            </button>

                            {!script.isPreset && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (confirm(`Delete custom rule "${script.name}"?`)) {
                                    remove(script.id);
                                    toast.success('Rule deleted');
                                  }
                                }}
                                aria-label={`Delete rule ${script.name}`}
                                title="Delete rule"
                                className="icon-btn text-danger min-h-11 min-w-11 sm:h-8 sm:w-8 sm:min-h-0 sm:min-w-0"
                              >
                                <Trash2 aria-hidden="true" className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          {/* Switch */}
                          <label className="relative inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              checked={script.enabled}
                              onChange={() => toggle(script.id)}
                              aria-label={`Enable rule ${script.name}`}
                              className="peer sr-only"
                            />
                            <div aria-hidden="true" className="relative h-6 w-11 rounded-full bg-line-strong transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--accent-line)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-ink after:transition-transform after:content-[''] peer-checked:after:translate-x-full peer-checked:after:bg-accent-ink" />
                          </label>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Live Sandbox Tester */}
        {activeTab === 'sandbox' && (
          <div className="scroll-y flex flex-1 min-h-0 flex-col sm:flex-row pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:pb-0">
            {/* Left: Input Text Editor */}
            <div className="flex w-full flex-col space-y-3 border-b border-line p-4 sm:w-1/2 sm:border-b-0 sm:border-r sm:p-6 shrink-0 sm:shrink">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="type-label">
                  Sample input
                </span>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setSandboxText(SAMPLE_SCENES.roleplay)}
                    className="btn btn-quiet min-h-11 sm:min-h-8 px-2.5"
                  >
                    Roleplay sample
                  </button>
                  <button
                    type="button"
                    onClick={() => setSandboxText(SAMPLE_SCENES.artifacts)}
                    className="btn btn-quiet min-h-11 sm:min-h-8 px-2.5"
                  >
                    AI artifacts sample
                  </button>
                </div>
              </div>

              <textarea
                value={sandboxText}
                onChange={(e) => setSandboxText(e.target.value)}
                aria-label="Sandbox sample input"
                rows={8}
                className="field w-full flex-1 resize-y sm:resize-none font-mono text-[12px] leading-relaxed min-h-[160px]"
                placeholder="Paste sample prose here, e.g. dialogue with {{roll::2d6}}…"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            {/* Right: Live Rendered Output */}
            <div className="flex w-full flex-col space-y-3 p-4 sm:w-1/2 sm:p-6 shrink-0 sm:shrink min-h-[280px]">
              <div className="flex items-center justify-between gap-2">
                <span className="type-label">
                  Transformed output
                </span>
                <div className="flex items-center gap-1 rounded-full border border-line p-0.5 text-xs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sandboxView === 'rendered'}
                    onClick={() => setSandboxView('rendered')}
                    className={`min-h-11 sm:min-h-[26px] rounded-full px-3 py-1 sm:py-0.5 font-medium transition-colors ${
                      sandboxView === 'rendered'
                        ? 'bg-accent-wash text-accent-text'
                        : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    Rendered
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sandboxView === 'raw'}
                    onClick={() => setSandboxView('raw')}
                    className={`min-h-11 sm:min-h-[26px] rounded-full px-3 py-1 sm:py-0.5 font-medium transition-colors ${
                      sandboxView === 'raw'
                        ? 'bg-accent-wash text-accent-text'
                        : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    Raw
                  </button>
                </div>
              </div>

              <div className="well scroll-y flex-1 p-4 max-h-[50vh] sm:max-h-none">
                {sandboxView === 'rendered' ? (
                  <RoleplayMessageContent
                    content={sandboxText}
                    characterName={characterName}
                    userName={userName}
                    accentColor={accentColor}
                    role="assistant"
                    scripts={scripts}
                  />
                ) : (
                  <pre className="type-code whitespace-pre-wrap leading-relaxed text-ink-2">
                    {sandboxText}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal: Rule Editor / Creator */}
        {isEditorOpen && editingRule && (
          <div className="animate-in fade-in fixed inset-0 z-[60] flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_45%,transparent)] p-0 sm:p-4 duration-150">
            <div
              role="dialog"
              aria-modal="true"
              aria-label={editingRule.id ? 'Edit regex formatter' : 'New regex rule'}
              className="panel animate-in fade-in flex h-full max-h-none sm:h-auto sm:max-h-[85dvh] w-full max-w-xl flex-col rounded-none sm:rounded-xl border-0 sm:border border-line bg-raised shadow-float duration-150 pt-safe pl-safe pr-safe sm:pl-0 sm:pr-0 overflow-hidden"
            >
              {/* Sticky Header */}
              <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-line bg-raised px-4 py-3 sm:px-6 sm:py-4">
                <h3 className="type-sec text-base">
                  {editingRule.id ? 'Edit regex formatter' : 'New regex rule'}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  aria-label="Close rule editor"
                  className="icon-btn min-h-11 min-w-11 sm:h-8 sm:w-8"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable Form Body */}
              <div className="scroll-y flex-1 min-h-0 space-y-4 px-4 py-4 sm:px-6 text-xs">
                {/* Rule Name */}
                <div className="space-y-1">
                  <label className="type-label" htmlFor="regex-rule-name">Rule name</label>
                  <input
                    id="regex-rule-name"
                    type="text"
                    value={editingRule.name || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                    placeholder="E.g. dialogue quote highlighter…"
                    className="field min-h-11 sm:min-h-9"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label className="type-label" htmlFor="regex-rule-description">Description</label>
                  <input
                    id="regex-rule-description"
                    type="text"
                    value={editingRule.description || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                    placeholder="What this rule does, e.g. wraps quotes in dialogue tags…"
                    className="field min-h-11 sm:min-h-9"
                  />
                </div>

                {/* Category & Scope */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="type-label" htmlFor="regex-rule-category">Category</label>
                    <select
                      id="regex-rule-category"
                      value={editingRule.category || 'custom'}
                      onChange={(e) => setEditingRule({ ...editingRule, category: e.target.value as RegexCategory })}
                      className="field min-h-11 sm:min-h-9"
                    >
                      <option value="dialogue">Dialogue & prose</option>
                      <option value="sanitizer">Sanitizer</option>
                      <option value="macro">Macro & roll</option>
                      <option value="visual">Visual & RPG</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="type-label" htmlFor="regex-rule-scope">Scope</label>
                    <select
                      id="regex-rule-scope"
                      value={editingRule.scope || 'display'}
                      onChange={(e) => setEditingRule({ ...editingRule, scope: e.target.value as RegexScope })}
                      className="field min-h-11 sm:min-h-9"
                    >
                      <option value="display">Client display only</option>
                      <option value="prompt">Prompt time (before send)</option>
                      <option value="both">Both (display & prompt)</option>
                    </select>
                  </div>
                </div>

                {/* Target Role */}
                <div className="space-y-1">
                  <label className="type-label" htmlFor="regex-rule-target">Target role</label>
                  <select
                    id="regex-rule-target"
                    value={editingRule.target || 'all'}
                    onChange={(e) => setEditingRule({ ...editingRule, target: e.target.value as RegexTarget })}
                    className="field min-h-11 sm:min-h-9"
                  >
                    <option value="all">All (both character & user)</option>
                    <option value="assistant">AI assistant / character only</option>
                    <option value="user">User messages only</option>
                  </select>
                </div>

                {/* Find Pattern */}
                <div className="space-y-1">
                  <label className="type-label" htmlFor="regex-rule-find">Find pattern</label>
                  <input
                    id="regex-rule-find"
                    type="text"
                    value={editingRule.findRegex || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, findRegex: e.target.value })}
                    placeholder="/pattern/flags, e.g. /“([^”]+)”/g…"
                    className="field font-mono min-h-11 sm:min-h-9"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="type-meta">
                    Supports standard regex flags, {'{{char}}'}, and {'{{user}}'} macros.
                  </p>
                </div>

                {/* Replace String */}
                <div className="space-y-1">
                  <label className="type-label" htmlFor="regex-rule-replace">Replace with</label>
                  <input
                    id="regex-rule-replace"
                    type="text"
                    value={editingRule.replaceString ?? ''}
                    onChange={(e) => setEditingRule({ ...editingRule, replaceString: e.target.value })}
                    placeholder="E.g. [[rp-dialogue]]$1[[/rp-dialogue]]…"
                    className="field font-mono min-h-11 sm:min-h-9"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="type-meta">Shortcuts: </span>
                    {['$1', '$2', '{{char}}', '{{user}}', '[[rp-dialogue]]$1[[/rp-dialogue]]', '[[rp-action]]$1[[/rp-action]]'].map((tok) => (
                      <button
                        key={tok}
                        type="button"
                        onClick={() => setEditingRule({ ...editingRule, replaceString: (editingRule.replaceString || '') + tok })}
                        className="chip type-code min-h-9 px-2.5"
                      >
                        {tok}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Buttons Footer with safe area */}
              <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-end gap-2 border-t border-line bg-raised px-4 py-3 sm:px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:pb-4">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="btn btn-quiet min-h-11 sm:min-h-9 px-4"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditor}
                  className="btn btn-primary min-h-11 sm:min-h-9 px-4"
                >
                  <Check aria-hidden="true" className="h-3.5 w-3.5" /> Save rule
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
