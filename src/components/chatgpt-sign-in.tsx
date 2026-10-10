'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, LogOut, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useSettings } from '@/lib/store/settings';

interface DeviceCode {
  deviceAuthId: string;
  userCode: string;
  interval: number;
  verificationUrl: string;
}

/** Device codes expire after 15 minutes. */
const DEVICE_CODE_TTL_MS = 15 * 60 * 1000;

/**
 * "Sign in with ChatGPT": the Codex CLI's device-code login. The person opens
 * auth.openai.com/codex/device, enters the code shown here, and this polls until approved.
 */
export function ChatgptSignIn() {
  const [settings, updateSettings] = useSettings();
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = null;
  };

  useEffect(() => stopPolling, []);

  useEffect(() => {
    if (!device) return;
    const startedAt = Date.now();
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() - startedAt > DEVICE_CODE_TTL_MS) {
        setDevice(null);
        toast.error('The sign-in code expired. Start again.');
        return;
      }
      try {
        const res = await fetch('/api/auth/chatgpt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'poll', deviceAuthId: device.deviceAuthId, userCode: device.userCode }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error || 'ChatGPT sign-in failed.');
        if (data.pending) {
          pollRef.current = setTimeout(poll, device.interval * 1000);
          return;
        }
        updateSettings({ chatgptAuth: data, llmProvider: 'chatgpt' });
        setDevice(null);
        toast.success(`Signed in to ChatGPT${data.email ? ` as ${data.email}` : ''}`);
      } catch (err) {
        if (cancelled) return;
        setDevice(null);
        toast.error(err instanceof Error ? err.message : 'ChatGPT sign-in failed.');
      }
    };

    pollRef.current = setTimeout(poll, device.interval * 1000);
    return () => {
      cancelled = true;
      stopPolling();
    };
    // updateSettings is recreated each render; polling only restarts on a new code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device]);

  const start = async () => {
    setStarting(true);
    // Open the tab inside the click so popup blockers allow it; point it once the code is known.
    const tab = window.open('about:blank', '_blank');
    try {
      const res = await fetch('/api/auth/chatgpt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Couldn’t start ChatGPT sign-in.');
      setDevice(data);
      if (tab) tab.location.href = data.verificationUrl;
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : 'Couldn’t start ChatGPT sign-in.');
    } finally {
      setStarting(false);
    }
  };

  const auth = settings.chatgptAuth;

  if (auth) {
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-ink truncate">{auth.email || 'ChatGPT account'}</div>
          <div className="type-meta truncate">
            Connected{auth.plan ? ` · ${auth.plan.charAt(0).toUpperCase()}${auth.plan.slice(1)} plan` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            updateSettings({ chatgptAuth: null });
            toast.info('Signed out of ChatGPT');
          }}
          className="btn btn-danger shrink-0"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden />
          Sign out
        </button>
      </div>
    );
  }

  if (device) {
    return (
      <div className="space-y-3">
        <p className="type-meta">
          Open the ChatGPT sign-in page, sign in, and enter this code. It expires in 15 minutes.
        </p>
        <div className="flex items-center gap-2">
          <code className="type-code flex-1 rounded-md border border-line bg-sunken px-3 py-2 text-center text-lg tracking-[0.2em] text-ink">
            {device.userCode}
          </code>
          <button
            type="button"
            className="icon-btn"
            aria-label="Copy code"
            onClick={() => {
              navigator.clipboard?.writeText(device.userCode).then(() => toast.success('Code copied'), () => undefined);
            }}
          >
            <Copy className="w-4 h-4" aria-hidden />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="type-meta flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
            Waiting for approval…
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn btn-quiet" onClick={() => setDevice(null)}>
              Cancel
            </button>
            <a href={device.verificationUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
              <ExternalLink className="w-3.5 h-3.5" aria-hidden />
              Open page
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={start} disabled={starting} className="btn btn-primary w-full justify-center">
        {starting && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
        Sign in with ChatGPT
      </button>
      <p className="type-meta">
        Uses your Plus, Pro or Team subscription, the same way the Codex CLI does. If the code is rejected, turn on
        device code sign-in for Codex in ChatGPT’s security settings.
      </p>
    </div>
  );
}
