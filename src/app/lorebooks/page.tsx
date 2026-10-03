'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, BookOpen, Trash2, Key, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Lorebook, LorebookEntry } from '@/lib/supabase/types';

export default function LorebooksPage() {
  const supabase = createClient();

  const [lorebooks, setLorebooks] = useState<Lorebook[]>([]);
  const [selectedBook, setSelectedBook] = useState<Lorebook | null>(null);
  const [entries, setEntries] = useState<LorebookEntry[]>([]);

  // New Lorebook modal
  const [bookModalOpen, setBookModalOpen] = useState(false);
  const [bookName, setBookName] = useState('');
  const [bookDesc, setBookDesc] = useState('');

  // New Entry modal
  const [entryModalOpen, setEntryModalOpen] = useState(false);
  const [entryTitle, setEntryTitle] = useState('');
  const [entryKeys, setEntryKeys] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [entryConstant, setEntryConstant] = useState(false);

  useEffect(() => {
    async function loadBooks() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        // Local mock lorebook
        const mockBook: Lorebook = {
          id: 'lb-default',
          user_id: 'local',
          name: 'Valenreach World Lore',
          description: 'Factions, clockwork technology, and royal lineage of the imperial court.',
          scan_depth: 4,
          token_budget: 1200,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setLorebooks([mockBook]);
        setSelectedBook(mockBook);
        setEntries([
          {
            id: 'entry-1',
            lorebook_id: mockBook.id,
            user_id: 'local',
            title: 'The Imperial Watch',
            keys: ['watch', 'guards', 'constable'],
            secondary_keys: [],
            content: 'The Imperial Watch are the enforcers of the Iron Crown, clad in polished brass armor with steam-powered repeating crossbows.',
            constant: false,
            enabled: true,
            priority: 100,
            case_sensitive: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      const { data } = await supabase
        .from('lorebooks')
        .select('*')
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        setLorebooks(data as Lorebook[]);
        setSelectedBook(data[0] as Lorebook);
      }
    }

    loadBooks();
  }, [supabase]);

  // Load entries when selectedBook changes
  useEffect(() => {
    if (!selectedBook || selectedBook.id === 'lb-default') return;

    supabase
      .from('lorebook_entries')
      .select('*')
      .eq('lorebook_id', selectedBook.id)
      .order('priority', { ascending: false })
      .then(({ data }) => {
        if (data) setEntries(data as LorebookEntry[]);
      });
  }, [selectedBook, supabase]);

  const handleCreateBook = async () => {
    if (!bookName.trim()) return;

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    const newBook: Lorebook = {
      id: 'lb-' + Date.now(),
      user_id: userId || 'local',
      name: bookName.trim(),
      description: bookDesc.trim(),
      scan_depth: 4,
      token_budget: 1200,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (userId) {
      const { data } = await supabase
        .from('lorebooks')
        .insert({
          user_id: userId,
          name: newBook.name,
          description: newBook.description,
        })
        .select()
        .single();
      if (data) {
        setLorebooks([data as Lorebook, ...lorebooks]);
        setSelectedBook(data as Lorebook);
      }
    } else {
      setLorebooks([newBook, ...lorebooks]);
      setSelectedBook(newBook);
    }

    setBookName('');
    setBookDesc('');
    setBookModalOpen(false);
    toast.success(`Lorebook "${newBook.name}" created!`);
  };

  const handleCreateEntry = async () => {
    if (!selectedBook || !entryTitle.trim() || !entryContent.trim()) return;

    const parsedKeys = entryKeys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    const newEntry: LorebookEntry = {
      id: 'entry-' + Date.now(),
      lorebook_id: selectedBook.id,
      user_id: userId || 'local',
      title: entryTitle.trim(),
      keys: parsedKeys,
      secondary_keys: [],
      content: entryContent.trim(),
      constant: entryConstant,
      enabled: true,
      priority: 100,
      case_sensitive: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (userId) {
      const { data } = await supabase
        .from('lorebook_entries')
        .insert({
          lorebook_id: selectedBook.id,
          user_id: userId,
          title: newEntry.title,
          keys: newEntry.keys,
          content: newEntry.content,
          constant: newEntry.constant,
        })
        .select()
        .single();
      if (data) setEntries([data as LorebookEntry, ...entries]);
    } else {
      setEntries([newEntry, ...entries]);
    }

    setEntryTitle('');
    setEntryKeys('');
    setEntryContent('');
    setEntryConstant(false);
    setEntryModalOpen(false);
    toast.success(`Entry "${newEntry.title}" added to world info!`);
  };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Lorebooks & World Info</h1>
            <p className="text-xs text-muted-foreground">
              Define worldbuilding, locations, factions, and items that trigger dynamically on keywords
            </p>
          </div>
        </div>

        <button
          onClick={() => setBookModalOpen(true)}
          className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-semibold apple-button flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          New Lorebook
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Lorebooks list */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Books ({lorebooks.length})
          </h3>
          <div className="space-y-2">
            {lorebooks.map((book) => (
              <button
                key={book.id}
                onClick={() => setSelectedBook(book)}
                className={`w-full text-left p-3.5 rounded-2xl glass-card border transition-all ${
                  selectedBook?.id === book.id
                    ? 'border-accent bg-accent/10 shadow-xs'
                    : 'border-black/[0.06] dark:border-white/[0.08]'
                }`}
              >
                <div className="font-semibold text-xs sm:text-sm">{book.name}</div>
                <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                  {book.description || 'No description'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Entries in selected Lorebook */}
        <div className="md:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {selectedBook ? `${selectedBook.name} Entries` : 'Select a Lorebook'}
            </h3>

            {selectedBook && (
              <button
                onClick={() => setEntryModalOpen(true)}
                className="px-3.5 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-xs font-medium apple-button flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Entry
              </button>
            )}
          </div>

          <div className="space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="p-4 rounded-3xl glass-card border border-black/[0.06] dark:border-white/[0.08] space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs sm:text-sm">{entry.title}</span>
                  {entry.constant && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-500 font-bold uppercase">
                      Constant
                    </span>
                  )}
                </div>

                {/* Activation Keys */}
                <div className="flex flex-wrap items-center gap-1">
                  <Key className="w-3 h-3 text-muted-foreground" />
                  {entry.keys.map((k) => (
                    <span
                      key={k}
                      className="px-2 py-0.5 rounded-md bg-accent/10 text-accent text-[10px] font-medium"
                    >
                      {k}
                    </span>
                  ))}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed pt-1">
                  {entry.content}
                </p>
              </div>
            ))}

            {entries.length === 0 && (
              <div className="p-8 text-center text-xs text-muted-foreground glass-card rounded-3xl">
                No entries in this lorebook yet. Click "Add Entry" to define keywords and world information.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Lorebook Modal */}
      {bookModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md glass-panel rounded-3xl p-6 space-y-4 shadow-2xl border border-white/10">
            <h2 className="text-lg font-bold tracking-tight">Create Lorebook</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Lorebook Name (e.g. Cyberpunk Slang & Factions)"
                value={bookName}
                onChange={(e) => setBookName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <textarea
                rows={2}
                placeholder="Brief description of this world..."
                value={bookDesc}
                onChange={(e) => setBookDesc(e.target.value)}
                className="w-full p-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setBookModalOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-full hover:bg-black/5 dark:hover:bg-white/10 apple-button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBook}
                className="px-5 py-2 text-xs font-semibold rounded-full bg-accent text-white apple-button shadow-sm"
              >
                Create Book
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Entry Modal */}
      {entryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg glass-panel rounded-3xl p-6 space-y-4 shadow-2xl border border-white/10">
            <h2 className="text-lg font-bold tracking-tight">Add World Info Entry</h2>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Title (e.g. Arasaka Corporation)"
                value={entryTitle}
                onChange={(e) => setEntryTitle(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <input
                type="text"
                placeholder="Activation Keywords (comma-separated, e.g. arasaka, megacorp, saburo)"
                value={entryKeys}
                onChange={(e) => setEntryKeys(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <textarea
                rows={4}
                placeholder="World information injected into the LLM prompt when keywords appear..."
                value={entryContent}
                onChange={(e) => setEntryContent(e.target.value)}
                className="w-full p-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={entryConstant}
                  onChange={(e) => setEntryConstant(e.target.checked)}
                  className="rounded text-accent focus:ring-accent"
                />
                Always insert (constant entry, ignores keywords)
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEntryModalOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-full hover:bg-black/5 dark:hover:bg-white/10 apple-button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateEntry}
                className="px-5 py-2 text-xs font-semibold rounded-full bg-accent text-white apple-button shadow-sm"
              >
                Add Entry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
