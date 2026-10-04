'use client';

import React, { useState, useMemo } from 'react';
import {
  X,
  Plus,
  Play,
  RotateCcw,
  Download,
  Upload,
  Sparkles,
  Check,
  Trash2,
  Edit2,
  Sliders,
  Filter,
  Search,
  Code,
  Eye,
  Info,
  Layers,
  ArrowRight,
  ShieldCheck,
  Dices,
  MessageCircle,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  type RegexScript,
  type RegexCategory,
  type RegexScope,
  type RegexTarget,
  testRegexScript,
  DEFAULT_REGEX_SCRIPTS,
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
    URL.revokeObjectURL(url);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/50 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl h-[90vh] max-h-[820px] glass-panel rounded-3xl shadow-2xl border border-white/10 flex flex-col overflow-hidden animate-in zoom-in-[0.98] duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-accent/15 border border-accent/20 flex items-center justify-center text-accent">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-tight text-foreground">
                  Regex Scripts & Output Formatters
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/15 text-accent border border-accent/25">
                  {activeCount} Active
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Client-side dialogue styling, model sanitizers, macros & SillyTavern regex transformations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab & Toolbar Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-black/[0.04] dark:border-white/[0.06] bg-black/[0.01] dark:bg-white/[0.01]">
          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.06]">
            <button
              onClick={() => setActiveTab('rules')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'rules'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Rules & Formatters
            </button>
            <button
              onClick={() => setActiveTab('sandbox')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                activeTab === 'sandbox'
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Live Sandbox Tester
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 text-xs">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-1.5 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              title="Import SillyTavern JSON Regex Scripts"
            >
              <Upload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Import</span>
            </button>
            <button
              onClick={handleExport}
              className="px-2.5 py-1.5 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              title="Export JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Reset all regex formatters to factory defaults?')) {
                  reset();
                  toast.success('Reset to default presets');
                }
              }}
              className="px-2.5 py-1.5 rounded-xl border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
              title="Reset to Defaults"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>
            <button
              onClick={handleCreateNew}
              className="px-3 py-1.5 rounded-xl bg-accent text-white font-semibold flex items-center gap-1.5 hover:opacity-90 transition-all shadow-xs active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Rule</span>
            </button>
          </div>
        </div>

        {/* Tab 1: Rules & Presets */}
        {activeTab === 'rules' && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {/* Filter and Search Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-black/[0.04] dark:border-white/[0.06]">
              {/* Category Pills */}
              <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-0.5 text-xs">
                {[
                  { id: 'all', label: 'All Rules' },
                  { id: 'dialogue', label: 'Dialogue & Prose' },
                  { id: 'sanitizer', label: 'Sanitizers' },
                  { id: 'macro', label: 'Macros & Rolls' },
                  { id: 'visual', label: 'Visual & RPG' },
                  { id: 'custom', label: 'Custom' },
                ].map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1 rounded-full whitespace-nowrap transition-all ${
                      selectedCategory === cat.id
                        ? 'bg-accent text-white font-semibold shadow-xs'
                        : 'bg-black/[0.03] dark:bg-white/[0.05] text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative w-48 sm:w-60">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search rules..."
                  className="w-full pl-8 pr-3 py-1 text-xs rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.08] dark:border-white/[0.1] focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            {/* Rules List */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {filteredScripts.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                  <Sliders className="w-8 h-8 opacity-40 mb-2" />
                  <p className="font-semibold text-sm">No regex rules match your filter</p>
                  <p className="text-xs opacity-75 mt-0.5">Try clearing your search or category filter</p>
                </div>
              ) : (
                filteredScripts.map((script) => (
                  <div
                    key={script.id}
                    className={`p-4 rounded-2xl border transition-all duration-200 glass-card ${
                      script.enabled
                        ? 'border-black/10 dark:border-white/10 shadow-xs'
                        : 'opacity-60 border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.01]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Info & Badges */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm text-foreground">
                            {script.name}
                          </span>

                          {/* Category Badge */}
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              script.category === 'sanitizer'
                                ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                                : script.category === 'dialogue'
                                ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                                : script.category === 'macro'
                                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                                : script.category === 'visual'
                                ? 'bg-purple-500/15 text-purple-600 dark:text-purple-400'
                                : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            {script.category}
                          </span>

                          {/* Scope Badge */}
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground">
                            Scope: {script.scope === 'display' ? 'Client Display' : script.scope === 'prompt' ? 'Prompt Time' : 'Both'}
                          </span>

                          {/* Target Badge */}
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground">
                            Target: {script.target === 'all' ? 'All Roles' : script.target === 'assistant' ? 'AI Assistant' : 'User'}
                          </span>

                          {script.isPreset && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/10 text-blue-500 uppercase">
                              Preset
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {script.description}
                        </p>

                        {/* Regex Pattern details */}
                        <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px] font-mono">
                          <div className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-foreground/80 max-w-full overflow-x-auto">
                            <span className="text-muted-foreground select-none">Pattern: </span>
                            <span className="text-accent">{script.findRegex}</span>
                          </div>
                          {script.replaceString && (
                            <div className="px-2 py-1 rounded-lg bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5 text-foreground/80 max-w-full overflow-x-auto">
                              <span className="text-muted-foreground select-none">→ </span>
                              <span>{script.replaceString}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Right: Toggle Switch & Actions */}
                      <div className="flex items-center gap-3 shrink-0">
                        <button
                          onClick={() => handleEditRule(script)}
                          className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit Rule"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        {!script.isPreset && (
                          <button
                            onClick={() => {
                              if (confirm(`Delete custom rule "${script.name}"?`)) {
                                remove(script.id);
                                toast.success('Rule deleted');
                              }
                            }}
                            className="p-2 rounded-xl hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                            title="Delete Rule"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        {/* Switch */}
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={script.enabled}
                            onChange={() => toggle(script.id)}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-black/20 peer-focus:outline-none rounded-full peer dark:bg-white/20 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accent" />
                        </label>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Live Sandbox Tester */}
        {activeTab === 'sandbox' && (
          <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Left: Input Text Editor */}
            <div className="w-full md:w-1/2 p-4 md:p-6 border-b md:border-b-0 md:border-r border-black/[0.06] dark:border-white/[0.08] flex flex-col space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Sample Input Text
                </span>
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    onClick={() => setSandboxText(SAMPLE_SCENES.roleplay)}
                    className="px-2.5 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground transition-colors"
                  >
                    Roleplay Sample
                  </button>
                  <button
                    onClick={() => setSandboxText(SAMPLE_SCENES.artifacts)}
                    className="px-2.5 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-muted-foreground transition-colors"
                  >
                    AI Artifacts Sample
                  </button>
                </div>
              </div>

              <textarea
                value={sandboxText}
                onChange={(e) => setSandboxText(e.target.value)}
                rows={12}
                className="flex-1 w-full p-3.5 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/10 dark:border-white/10 text-xs sm:text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                placeholder="Type or paste sample roleplay prose, speech, or tags here..."
              />
            </div>

            {/* Right: Live Rendered Output */}
            <div className="w-full md:w-1/2 p-4 md:p-6 flex flex-col space-y-3 overflow-hidden bg-black/[0.01] dark:bg-white/[0.01]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Transformed Output
                </span>
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] text-xs">
                  <button
                    onClick={() => setSandboxView('rendered')}
                    className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                      sandboxView === 'rendered'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground'
                    }`}
                  >
                    Rendered Preview
                  </button>
                  <button
                    onClick={() => setSandboxView('raw')}
                    className={`px-2.5 py-0.5 rounded-md font-medium transition-all ${
                      sandboxView === 'raw'
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground'
                    }`}
                  >
                    Raw Output
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 rounded-2xl glass-card border border-black/10 dark:border-white/10 shadow-xs">
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
                  <pre className="text-xs font-mono whitespace-pre-wrap text-foreground/80 leading-relaxed">
                    {sandboxText}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Modal: Rule Editor / Creator */}
        {isEditorOpen && editingRule && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
            <div className="relative w-full max-w-xl glass-panel rounded-3xl shadow-2xl border border-white/15 p-6 space-y-4 animate-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-black/[0.06] dark:border-white/[0.08] pb-3">
                <h3 className="font-bold text-base text-foreground">
                  {editingRule.id ? 'Edit Regex Formatter' : 'Create Custom Regex Formatter'}
                </h3>
                <button
                  onClick={() => setIsEditorOpen(false)}
                  className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3.5 text-xs max-h-[65vh] overflow-y-auto pr-1">
                {/* Rule Name */}
                <div className="space-y-1">
                  <label className="font-semibold text-foreground/90">Rule Name</label>
                  <input
                    type="text"
                    value={editingRule.name || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
                    placeholder="e.g. Japanese Quote Highlighter or Custom Card Styler"
                    className="w-full p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label className="font-semibold text-foreground/90">Description</label>
                  <input
                    type="text"
                    value={editingRule.description || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, description: e.target.value })}
                    placeholder="Brief description of what this rule does..."
                    className="w-full p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                {/* Category & Scope */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-semibold text-foreground/90">Category</label>
                    <select
                      value={editingRule.category || 'custom'}
                      onChange={(e) => setEditingRule({ ...editingRule, category: e.target.value as RegexCategory })}
                      className="w-full p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="dialogue">Dialogue & Prose</option>
                      <option value="sanitizer">Sanitizer</option>
                      <option value="macro">Macro & Roll</option>
                      <option value="visual">Visual & RPG</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="font-semibold text-foreground/90">Scope</label>
                    <select
                      value={editingRule.scope || 'display'}
                      onChange={(e) => setEditingRule({ ...editingRule, scope: e.target.value as RegexScope })}
                      className="w-full p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="display">Client Display Only</option>
                      <option value="prompt">Prompt-Time (Before Send)</option>
                      <option value="both">Both (Display & Prompt)</option>
                    </select>
                  </div>
                </div>

                {/* Target Role */}
                <div className="space-y-1">
                  <label className="font-semibold text-foreground/90">Target Role</label>
                  <select
                    value={editingRule.target || 'all'}
                    onChange={(e) => setEditingRule({ ...editingRule, target: e.target.value as RegexTarget })}
                    className="w-full p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    <option value="all">All (Both Character & User)</option>
                    <option value="assistant">AI Assistant / Character Only</option>
                    <option value="user">User Messages Only</option>
                  </select>
                </div>

                {/* Find Pattern */}
                <div className="space-y-1">
                  <label className="font-semibold text-foreground/90">Find Regex Pattern</label>
                  <input
                    type="text"
                    value={editingRule.findRegex || ''}
                    onChange={(e) => setEditingRule({ ...editingRule, findRegex: e.target.value })}
                    placeholder="/pattern/flags or pattern"
                    className="w-full p-2.5 rounded-xl font-mono bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Supports <code>/“([^”]+)”/g</code>, <code>&#123;&#123;char&#125;&#125;</code>, and standard regex flags.
                  </p>
                </div>

                {/* Replace String */}
                <div className="space-y-1">
                  <label className="font-semibold text-foreground/90">Replace With</label>
                  <input
                    type="text"
                    value={editingRule.replaceString ?? ''}
                    onChange={(e) => setEditingRule({ ...editingRule, replaceString: e.target.value })}
                    placeholder="e.g. [[rp-dialogue]]$1[[/rp-dialogue]] or empty to delete"
                    className="w-full p-2.5 rounded-xl font-mono bg-black/[0.03] dark:bg-white/[0.05] border border-black/10 dark:border-white/10 focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] text-muted-foreground">Shortcuts: </span>
                    {['$1', '$2', '{{char}}', '{{user}}', '[[rp-dialogue]]$1[[/rp-dialogue]]', '[[rp-action]]$1[[/rp-action]]'].map((tok) => (
                      <button
                        key={tok}
                        type="button"
                        onClick={() => setEditingRule({ ...editingRule, replaceString: (editingRule.replaceString || '') + tok })}
                        className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/10 hover:bg-black/10 text-[10px] font-mono"
                      >
                        {tok}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setIsEditorOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEditor}
                  className="px-4 py-1.5 rounded-xl bg-accent text-white font-semibold flex items-center gap-1.5 hover:opacity-90 transition-all shadow-xs"
                >
                  <Check className="w-3.5 h-3.5" /> Save Rule
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
