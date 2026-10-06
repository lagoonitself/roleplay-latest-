'use client';

import React, { useState, useEffect } from 'react';
import { useSettings } from '@/lib/store/settings';
import { useTheme } from 'next-themes';
import { createClient } from '@/lib/supabase/client';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  X,
  Key,
  Sparkles,
  Flame,
  Sun,
  Moon,
  Laptop,
  Brain,
  LogOut,
  User,
  Check,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { toast } from 'sonner';
import { useSoundEffects, playReceiveSound } from '@/lib/audio/sound-effects';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-line transition-[background-color] duration-150 ${
        checked ? 'bg-accent' : 'bg-line-strong'
      }`}
    >
      <span
        aria-hidden
        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-raised transition-transform duration-150 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, updateSettings] = useSettings();
  const { theme, setTheme } = useTheme();
  const supabase = createClient();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [soundEnabled, toggleSound] = useSoundEffects();

  const [apiKey, setApiKey] = useState(settings.opencodeApiKey);
  const [model, setModel] = useState(settings.opencodeModel);
  const [endpoint, setEndpoint] = useState(settings.opencodeEndpoint);
  const [uncensored, setUncensored] = useState(settings.uncensoredMode);
  const [temperature, setTemperature] = useState(settings.defaultTemperature);
  const [thinking, setThinking] = useState(settings.thinkingEnabled);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, [supabase]);

  useEffect(() => {
    setApiKey(settings.opencodeApiKey);
    setModel(settings.opencodeModel);
    setEndpoint(settings.opencodeEndpoint);
    setUncensored(settings.uncensoredMode);
    setTemperature(settings.defaultTemperature);
    setThinking(settings.thinkingEnabled);
  }, [settings, open]);

  if (!open) return null;

  const handleSave = () => {
    updateSettings({
      opencodeApiKey: apiKey.trim(),
      opencodeModel: model,
      opencodeEndpoint: endpoint.trim(),
      uncensoredMode: uncensored,
      defaultTemperature: temperature,
      thinkingEnabled: thinking,
    });
    toast.success('Settings updated successfully');
    onClose();
  };

  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      toast.error('Google Sign-in failed: ' + error.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    toast.info('Signed out');
  };

  const temperatureWord = temperature < 0.9 ? 'Grounded' : temperature > 1.25 ? 'Inventive' : 'Balanced';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Studio settings"
        onClick={(e) => e.stopPropagation()}
        className="panel relative w-full max-w-lg overflow-hidden rounded-2xl p-6 md:p-8 animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-line">
          <div>
            <h2 className="type-page">Settings</h2>
            <p className="type-meta mt-0.5">Your connection and roleplay preferences</p>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close settings">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        {/* Content */}
        <div className="py-5 space-y-4 max-h-[72vh] overflow-y-auto pr-1">
          {/* Account / Google OAuth */}
          <div className="surface rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-md bg-sunken border border-line flex items-center justify-center text-ink-2 shrink-0 overflow-hidden">
                  {user?.user_metadata?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.user_metadata.avatar_url}
                      alt="Your avatar"
                      className="w-full h-full rounded-md object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5" aria-hidden />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">
                    {user ? user.user_metadata?.full_name || user.email : 'Guest session'}
                  </div>
                  <div className="type-meta truncate">
                    {user ? 'Google account connected' : 'Chats saved locally and in your active workspace'}
                  </div>
                </div>
              </div>
              {user ? (
                <button onClick={handleSignOut} className="btn btn-danger shrink-0">
                  <LogOut className="w-3.5 h-3.5" aria-hidden />
                  Sign out
                </button>
              ) : (
                <button onClick={handleGoogleLogin} className="btn btn-ghost shrink-0">
                  Sign in with Google
                </button>
              )}
            </div>
          </div>

          {/* OpenCode Go API Key */}
          <div className="surface rounded-lg p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="settings-api-key" className="type-sec flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-ink-3" aria-hidden />
                OpenCode Go API key
              </label>
              <span className="type-meta">From OpenCode console</span>
            </div>
            <input
              id="settings-api-key"
              type="password"
              autoComplete="off"
              name="apiKey"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your key, e.g. oc_…"
              className="field"
            />
            <p className="type-meta">Stored in your browser and used to stream your turns.</p>
          </div>

          {/* Model Selection */}
          <div className="surface rounded-lg p-4 space-y-2">
            <label htmlFor="settings-model" className="type-sec flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-ink-3" aria-hidden />
              Model
            </label>
            <select
              id="settings-model"
              name="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="field bg-sunken text-ink"
            >
              <option value="deepseek-v4.1-flash">DeepSeek V4.1 Flash (Recommended - 1M Context)</option>
              <option value="deepseek-v4-pro">DeepSeek V4 Pro (High Intelligence)</option>
              <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
              <option value="kimi-k3">Kimi K3</option>
              <option value="glm-5.3-flash">GLM-5.3 Flash</option>
            </select>
            <p className="type-meta">Endpoint is configured automatically.</p>
          </div>

          {/* Uncensored / NSFW Roleplay Toggle */}
          <div className="surface rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <div className="type-sec flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-ink-3" aria-hidden />
                Uncensored creative writing
              </div>
              <div className="type-meta">Allows adult fiction, romance and intense drama without refusals.</div>
            </div>
            <Switch checked={uncensored} onChange={setUncensored} label="Uncensored creative writing" />
          </div>

          {/* Thinking Mode Toggle */}
          <div className="surface rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <div className="type-sec flex items-center gap-1.5">
                <Brain className="w-4 h-4 text-ink-3" aria-hidden />
                Deep thinking mode
              </div>
              <div className="type-meta">The model reasons first. Off is faster and cheaper.</div>
            </div>
            <Switch checked={thinking} onChange={setThinking} label="Deep thinking mode" />
          </div>

          {/* Temperature Slider */}
          <div className="surface rounded-lg p-4 space-y-2">
            <div className="flex justify-between items-center gap-2">
              <label htmlFor="settings-temperature" className="type-label">
                Creativity
              </label>
              <span className="type-code">
                {temperature.toFixed(2)}, {temperatureWord}
              </span>
            </div>
            <input
              id="settings-temperature"
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={temperature}
              aria-label="Creativity"
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-[var(--accent)] cursor-pointer"
            />
          </div>

          {/* Soundscape & Audio Effects Toggle */}
          <div className="surface rounded-lg p-4 flex items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <div className="type-sec flex items-center gap-1.5">
                {soundEnabled ? (
                  <Volume2 className="w-4 h-4 text-ink-3" aria-hidden />
                ) : (
                  <VolumeX className="w-4 h-4 text-ink-3" aria-hidden />
                )}
                Audio feedback
              </div>
              <div className="type-meta">Soft chimes when your turn arrives.</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {soundEnabled && (
                <button
                  type="button"
                  onClick={() => playReceiveSound()}
                  className="btn btn-quiet"
                  title="Play preview chime"
                >
                  Test
                </button>
              )}
              <Switch
                checked={soundEnabled}
                onChange={(next) => {
                  toggleSound(next);
                  if (next) playReceiveSound();
                  toast.info(next ? 'Sound effects enabled' : 'Sound effects muted');
                }}
                label="Audio feedback"
              />
            </div>
          </div>

          {/* Appearance Theme Switcher */}
          <div className="surface rounded-lg p-4 space-y-2">
            <span className="type-sec">Appearance</span>
            <div
              role="group"
              aria-label="Appearance"
              className="flex rounded-full border border-line p-1 gap-1"
            >
              {[
                { name: 'Light', val: 'light', icon: Sun },
                { name: 'Dark', val: 'dark', icon: Moon },
                { name: 'System', val: 'system', icon: Laptop },
              ].map((t) => {
                const Icon = t.icon;
                const isSelected = theme === t.val;
                return (
                  <button
                    key={t.val}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setTheme(t.val)}
                    className={`flex flex-1 items-center justify-center gap-2 py-2 px-3 rounded-full text-xs font-medium ${
                      isSelected
                        ? 'bg-accent-wash text-accent-text border border-accent-line'
                        : 'chip border-transparent'
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden />
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-line flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-quiet">
            Cancel
          </button>
          <button onClick={handleSave} className="btn btn-primary">
            <Check className="w-3.5 h-3.5" aria-hidden />
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
