'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Key } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Lorebook, LorebookEntry } from '@/lib/supabase/types';
import { Sheet } from '@/components/ui/sheet';

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
  // Guards create buttons against double-submit while a write is in flight.
  const [saving, setSaving] = useState(false);

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
    if (!bookName.trim() || saving) return;

    setSaving(true);
    try {
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
        const { data, error } = await supabase
          .from('lorebooks')
          .insert({
            user_id: userId,
            name: newBook.name,
            description: newBook.description,
          })
          .select()
          .single();
        // Never claim success (or wipe the form) when the row wasn't saved.
        if (error || !data) {
          toast.error('Could not create the lorebook — please try again');
          return;
        }
        setLorebooks([data as Lorebook, ...lorebooks]);
        setSelectedBook(data as Lorebook);
      } else {
        setLorebooks([newBook, ...lorebooks]);
        setSelectedBook(newBook);
      }

      setBookName('');
      setBookDesc('');
      setBookModalOpen(false);
      toast.success(`Lorebook "${newBook.name}" created!`);
    } catch {
      toast.error('Could not create the lorebook — please try again');
    } finally {
      setSaving(false);
    }
  };

  const handleCreateEntry = async () => {
    if (!selectedBook || !entryTitle.trim() || !entryContent.trim() || saving) return;

    const parsedKeys = entryKeys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);

    setSaving(true);
    try {
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
        const { data, error } = await supabase
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
        // Never claim success (or wipe the form) when the row wasn't saved.
        if (error || !data) {
          toast.error('Could not add the entry — please try again');
          return;
        }
        setEntries([data as LorebookEntry, ...entries]);
      } else {
        setEntries([newEntry, ...entries]);
      }

      setEntryTitle('');
      setEntryKeys('');
      setEntryContent('');
      setEntryConstant(false);
      setEntryModalOpen(false);
      toast.success(`Entry "${newEntry.title}" added to world info!`);
    } catch {
      toast.error('Could not add the entry — please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-4 border-b border-line">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="icon-btn min-h-11 min-w-11"
            aria-label="Back to explore"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="type-page truncate">Lorebooks and world info</h1>
            <p className="type-meta mt-0.5 truncate">
              Define worldbuilding, locations, factions, and items that trigger on keywords
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setBookModalOpen(true)}
          className="btn btn-primary flex items-center gap-1.5 shrink-0 min-h-11"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden />
          <span>New lorebook</span>
        </button>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Left: books list */}
        <div className="w-full md:w-80 md:shrink-0 space-y-3">
          <h2 className="type-sec">
            Books ({lorebooks.length})
          </h2>
          {lorebooks.length === 0 ? (
            <div className="surface rounded-xl p-6 text-center">
              <p className="type-sec">No lorebooks</p>
              <p className="type-meta mt-1">
                Create a lorebook to organize your world info entries.
              </p>
            </div>
          ) : (
            <div className="surface rounded-xl divide-y divide-line overflow-hidden">
              {lorebooks.map((book) => {
                const isSelected = selectedBook?.id === book.id;
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => setSelectedBook(book)}
                    aria-pressed={isSelected}
                    className={`w-full min-h-[56px] min-w-0 px-4 py-3 text-left row-press flex flex-col justify-center transition-colors ${
                      isSelected ? 'bg-accent-wash' : ''
                    }`}
                  >
                    <div className="font-semibold text-xs sm:text-sm text-ink truncate w-full">
                      {book.name}
                    </div>
                    <div className="type-meta truncate w-full mt-0.5">
                      {book.description || 'No description'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: entries in selected book */}
        <div className="w-full md:flex-1 min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="type-sec truncate min-w-0">
              {selectedBook ? `${selectedBook.name} entries` : 'Select a lorebook'}
            </h2>

            {selectedBook && (
              <button
                type="button"
                onClick={() => setEntryModalOpen(true)}
                className="btn btn-quiet flex items-center gap-1 shrink-0 min-h-11"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden />
                <span>Add entry</span>
              </button>
            )}
          </div>

          <div className="space-y-3">
            {entries.length === 0 ? (
              <div className="surface rounded-xl p-8 text-center">
                <p className="type-sec">No entries yet</p>
                <p className="type-meta mt-1">
                  Add an entry to define keywords and world information for this book.
                </p>
              </div>
            ) : (
              <div className="surface rounded-xl divide-y divide-line overflow-hidden">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="min-h-[56px] min-w-0 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="font-semibold text-xs sm:text-sm text-ink truncate min-w-0">
                        {entry.title}
                      </span>
                      {entry.constant && (
                        <span className="chip chip-accent shrink-0">
                          Constant
                        </span>
                      )}
                    </div>

                    {!!entry.keys.length && (
                      <div className="flex flex-wrap items-center gap-1">
                        <Key className="w-3 h-3 text-ink-3 shrink-0" aria-hidden />
                        {entry.keys.map((k) => (
                          <span key={k} className="chip type-code truncate max-w-full">
                            {k}
                          </span>
                        ))}
                      </div>
                    )}

                    <p className="text-xs font-serif text-ink-2 leading-relaxed pt-1 break-words">
                      {entry.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create lorebook Sheet */}
      <Sheet
        open={bookModalOpen}
        onOpenChange={(o) => {
          if (!o) setBookModalOpen(false);
        }}
        title="Create lorebook"
        size="tall"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBookModalOpen(false)}
              className="btn btn-quiet flex-1 min-h-11"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateBook}
              disabled={saving}
              className="btn btn-primary flex-1 min-h-11 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create lorebook'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="lorebook-name" className="type-label">
              Name
            </label>
            <input
              id="lorebook-name"
              type="text"
              placeholder="e.g. Cyberpunk slang and factions…"
              value={bookName}
              onChange={(e) => setBookName(e.target.value)}
              className="field"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lorebook-desc" className="type-label">
              Description
            </label>
            <textarea
              id="lorebook-desc"
              rows={3}
              placeholder="Brief description of this world…"
              value={bookDesc}
              onChange={(e) => setBookDesc(e.target.value)}
              className="field resize-y min-h-[7rem]"
            />
          </div>
        </div>
      </Sheet>

      {/* Create entry Sheet */}
      <Sheet
        open={entryModalOpen}
        onOpenChange={(o) => {
          if (!o) setEntryModalOpen(false);
        }}
        title="Add world info entry"
        size="tall"
        footer={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEntryModalOpen(false)}
              className="btn btn-quiet flex-1 min-h-11"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCreateEntry}
              disabled={saving}
              className="btn btn-primary flex-1 min-h-11 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add entry'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="lore-entry-title" className="type-label">
              Title
            </label>
            <input
              id="lore-entry-title"
              type="text"
              placeholder="e.g. Arasaka Corporation…"
              value={entryTitle}
              onChange={(e) => setEntryTitle(e.target.value)}
              className="field"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lore-entry-keys" className="type-label">
              Activation keywords
            </label>
            <input
              id="lore-entry-keys"
              type="text"
              placeholder="e.g. arasaka, megacorp, saburo…"
              value={entryKeys}
              onChange={(e) => setEntryKeys(e.target.value)}
              className="field"
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="lore-entry-content" className="type-label">
              Content
            </label>
            <textarea
              id="lore-entry-content"
              rows={4}
              placeholder="World information added to the prompt when keywords appear…"
              value={entryContent}
              onChange={(e) => setEntryContent(e.target.value)}
              className="field resize-y min-h-[7rem]"
            />
          </div>
          <label className="flex min-h-11 items-center gap-2 text-xs text-ink-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={entryConstant}
              onChange={(e) => setEntryConstant(e.target.checked)}
              className="h-4 w-4 rounded accent-accent"
            />
            <span>Always include this entry, even without keyword matches</span>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
