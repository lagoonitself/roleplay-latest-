'use client';

import React, { useState, useEffect } from 'react';
import { useSettings } from '@/lib/store/settings';
import { useTheme } from 'next-themes';
import { createClient } from '@/lib/supabase/client';
import {
  X,
  Key,
  Sparkles,
  Flame,
  Sun,
  Moon,
  Laptop,
  Brain,
  ShieldAlert,
  LogOut,
  User,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, updateSettings] = useSettings();
  const { theme, setTheme } = useTheme();
  const supabase = createClient();
  const [user, setUser] = useState<any>(null);

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg overflow-hidden glass-panel rounded-3xl shadow-2xl border border-white/10 p-6 md:p-8 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Studio Settings</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure your OpenCode Go subscription & roleplay preferences
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5 opacity-70" />
          </button>
        </div>

        {/* Content */}
        <div className="py-5 space-y-5 max-h-[72vh] overflow-y-auto pr-1">
          {/* Account / Google OAuth */}
          <div className="p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06]">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center text-accent font-semibold">
                  {user?.user_metadata?.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={user.user_metadata.avatar_url}
                      alt="Avatar"
                      className="w-full h-full rounded-full object-cover"
                    />
                  ) : (
                    <User className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {user ? user.user_metadata?.full_name || user.email : 'Guest Session'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {user ? 'Google Account Connected' : 'Chats saved locally & in active workspace'}
                  </div>
                </div>
              </div>
              {user ? (
                <button
                  onClick={handleSignOut}
                  className="px-3 py-1.5 text-xs font-medium rounded-full bg-red-500/10 text-red-500 hover:bg-red-500/20 apple-button flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              ) : (
                <button
                  onClick={handleGoogleLogin}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-full bg-foreground text-background hover:opacity-90 apple-button"
                >
                  Sign in with Google
                </button>
              )}
            </div>
          </div>

          {/* OpenCode Go API Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-accent" />
                OpenCode Go API Key
              </label>
              <span className="text-[11px] text-muted-foreground">From OpenCode Console</span>
            </div>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Paste your OpenCode Go API key..."
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <p className="text-[11px] text-muted-foreground">
              Stored securely in your browser and used to stream DeepSeek V4.1 Flash turns.
            </p>
          </div>

          {/* Model Selection */}
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              LLM Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              <option value="deepseek-v4.1-flash">DeepSeek V4.1 Flash (Recommended - 1M Context)</option>
              <option value="deepseek-v4-pro">DeepSeek V4 Pro (High Intelligence)</option>
              <option value="deepseek-v4-flash">DeepSeek V4 Flash</option>
              <option value="kimi-k3">Kimi K3</option>
              <option value="glm-5.3-flash">GLM-5.3 Flash</option>
            </select>
          </div>

          {/* Uncensored / NSFW Roleplay Toggle */}
          <div className="p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Flame className="w-4 h-4 text-orange-500" />
                Uncensored Creative Writing (NSFW)
              </div>
              <div className="text-xs text-muted-foreground">
                Enables unrestricted adult fiction, romance, and intense drama without moralizing refusals.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUncensored(!uncensored)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                uncensored ? 'bg-accent' : 'bg-black/20 dark:bg-white/20'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  uncensored ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Thinking Mode Toggle */}
          <div className="p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Brain className="w-4 h-4 text-purple-500" />
                Deep Thinking Mode
              </div>
              <div className="text-xs text-muted-foreground">
                DeepSeek reasons internally before responding. Off by default for faster, lower-cost turns.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setThinking(!thinking)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                thinking ? 'bg-accent' : 'bg-black/20 dark:bg-white/20'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  thinking ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {/* Temperature Slider */}
          <div className="space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="font-semibold tracking-wider text-muted-foreground uppercase">
                Creativity & Temperature ({temperature.toFixed(2)})
              </span>
              <span className="text-[11px] text-muted-foreground">
                {temperature < 0.9 ? 'Grounded' : temperature > 1.25 ? 'Wild & Inventive' : 'Balanced Roleplay'}
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-accent cursor-pointer"
            />
          </div>

          {/* Appearance Theme Switcher */}
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              Appearance
            </label>
            <div className="grid grid-cols-3 gap-2">
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
                    onClick={() => setTheme(t.val)}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-medium transition-all ${
                      isSelected
                        ? 'border-accent bg-accent/10 text-accent font-semibold'
                        : 'border-black/[0.06] dark:border-white/[0.08] hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-black/[0.06] dark:border-white/[0.08] flex justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium rounded-full hover:bg-black/5 dark:hover:bg-white/10 apple-button"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-xs font-semibold rounded-full bg-accent text-white hover:bg-accent-hover apple-button flex items-center gap-1.5 shadow-sm"
          >
            <Check className="w-3.5 h-3.5" />
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
