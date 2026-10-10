'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  type RegexScript,
  DEFAULT_REGEX_SCRIPTS,
  exportToSillyTavernJson,
  importFromRegexJson,
} from '@/lib/formatter/regex-engine';

const STORAGE_KEY = 'cadenza_regex_scripts';
const EVENT_NAME = 'cadenza-regex-changed';

/**
 * Presets are cached in localStorage, so a fixed preset regex never reaches
 * existing users. Swap in the current definition only when the cached copy is
 * still the exact legacy regex, so user edits are left alone.
 */
const LEGACY_PRESET_REGEXES: Record<string, string> = {
  // Matched the inner `*…*` of `**bold**`, rendering bold text as italic action.
  'prose-action-styler': '/(?:\\*([^*\\n]+)\\*)/g',
};

function upgradeLegacyPreset(script: RegexScript): RegexScript {
  const legacy = LEGACY_PRESET_REGEXES[script.id];
  if (legacy === undefined || script.findRegex !== legacy) return script;
  const current = DEFAULT_REGEX_SCRIPTS.find((d) => d.id === script.id);
  return current ? { ...script, findRegex: current.findRegex, description: current.description } : script;
}

/**
 * Loads saved scripts from localStorage and merges with DEFAULT_REGEX_SCRIPTS.
 * Ensures newly introduced presets are preserved while keeping user preferences.
 */
export function getSavedRegexScripts(): RegexScript[] {
  if (typeof window === 'undefined') return DEFAULT_REGEX_SCRIPTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_REGEX_SCRIPTS));
      return DEFAULT_REGEX_SCRIPTS;
    }
    const saved = JSON.parse(raw) as RegexScript[];
    if (!Array.isArray(saved)) return DEFAULT_REGEX_SCRIPTS;

    // Merge: keep all saved scripts (including custom ones), and ensure any missing presets are appended
    const existingIds = new Set(saved.map((s) => s.id));
    const merged = saved.map(upgradeLegacyPreset);

    for (const preset of DEFAULT_REGEX_SCRIPTS) {
      if (!existingIds.has(preset.id)) {
        merged.push(preset);
      }
    }

    return merged;
  } catch (err) {
    console.error('Failed to load regex scripts:', err);
    return DEFAULT_REGEX_SCRIPTS;
  }
}

/**
 * Persists regex scripts to localStorage and emits change notification.
 */
export function saveRegexScripts(scripts: RegexScript[]): RegexScript[] {
  if (typeof window === 'undefined') return scripts;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
    window.dispatchEvent(new Event(EVENT_NAME));
  } catch (err) {
    console.error('Failed to save regex scripts:', err);
  }
  return scripts;
}

export function toggleRegexScript(id: string, enabled?: boolean): RegexScript[] {
  const current = getSavedRegexScripts();
  const updated = current.map((s) => {
    if (s.id === id) {
      return { ...s, enabled: enabled !== undefined ? enabled : !s.enabled };
    }
    return s;
  });
  return saveRegexScripts(updated);
}

export function addRegexScript(script: Omit<RegexScript, 'id'>): RegexScript[] {
  const current = getSavedRegexScripts();
  const newScript: RegexScript = {
    ...script,
    id: `custom-regex-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    isPreset: false,
  };
  const updated = [newScript, ...current];
  return saveRegexScripts(updated);
}

export function updateRegexScript(id: string, updates: Partial<RegexScript>): RegexScript[] {
  const current = getSavedRegexScripts();
  const updated = current.map((s) => {
    if (s.id === id) {
      return { ...s, ...updates };
    }
    return s;
  });
  return saveRegexScripts(updated);
}

export function deleteRegexScript(id: string): RegexScript[] {
  const current = getSavedRegexScripts();
  const updated = current.filter((s) => s.id !== id);
  return saveRegexScripts(updated);
}

export function resetRegexScriptsToDefault(): RegexScript[] {
  return saveRegexScripts(DEFAULT_REGEX_SCRIPTS);
}

/**
 * React hook for consuming and updating regex scripts.
 * Uses lazy initializer for useState to avoid cascading render warnings.
 */
export function useRegexScripts() {
  const [scripts, setScripts] = useState<RegexScript[]>(() => getSavedRegexScripts());

  useEffect(() => {
    const handleSync = () => {
      setScripts(getSavedRegexScripts());
    };

    window.addEventListener(EVENT_NAME, handleSync);
    window.addEventListener('storage', handleSync);

    return () => {
      window.removeEventListener(EVENT_NAME, handleSync);
      window.removeEventListener('storage', handleSync);
    };
  }, []);

  const toggle = useCallback((id: string, enabled?: boolean) => {
    const updated = toggleRegexScript(id, enabled);
    setScripts(updated);
  }, []);

  const add = useCallback((script: Omit<RegexScript, 'id'>) => {
    const updated = addRegexScript(script);
    setScripts(updated);
  }, []);

  const update = useCallback((id: string, updates: Partial<RegexScript>) => {
    const updated = updateRegexScript(id, updates);
    setScripts(updated);
  }, []);

  const remove = useCallback((id: string) => {
    const updated = deleteRegexScript(id);
    setScripts(updated);
  }, []);

  const reset = useCallback(() => {
    const updated = resetRegexScriptsToDefault();
    setScripts(updated);
  }, []);

  const exportJson = useCallback(() => {
    return exportToSillyTavernJson(scripts);
  }, [scripts]);

  const importJson = useCallback((jsonString: string) => {
    const { scripts: imported, error } = importFromRegexJson(jsonString);
    if (error || !imported.length) {
      return { success: false, error: error || 'No valid scripts found' };
    }

    const current = getSavedRegexScripts();
    const existingIds = new Set(current.map((s) => s.id));
    const merged = [...current];

    for (const item of imported) {
      if (!existingIds.has(item.id)) {
        merged.push(item);
      } else {
        // give new ID to avoid conflict
        merged.push({
          ...item,
          id: `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        });
      }
    }

    saveRegexScripts(merged);
    setScripts(merged);
    return { success: true, count: imported.length };
  }, []);

  return {
    scripts,
    toggle,
    add,
    update,
    remove,
    reset,
    exportJson,
    importJson,
  };
}
