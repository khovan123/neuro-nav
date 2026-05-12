/* ============================================================
   SETTINGS PAGE — Connection & security configuration
   Matches CLI .env: NAV_SECRET, NAV_SERVER, NAV_HTTP_PORT
   ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import { IconShieldLock, IconCheck, IconAlertTriangle, IconGlobe } from '@/shared/ui/Icons';

interface StoredSettings {
  navSecret: string;
  navDaemonUrl: string;
  navDaemonPort: string;
}

const DEFAULTS: StoredSettings = {
  navSecret: '',
  navDaemonUrl: 'ws://127.0.0.1',
  navDaemonPort: '9500',
};

export function Settings() {
  const [settings, setSettings] = useState<StoredSettings>(DEFAULTS);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Load from chrome.storage
  useEffect(() => {
    chrome.storage.local.get(
      ['navSecret', 'navDaemonUrl', 'navDaemonPort'],
      (result) => {
        setSettings({
          navSecret: result.navSecret || DEFAULTS.navSecret,
          navDaemonUrl: result.navDaemonUrl || DEFAULTS.navDaemonUrl,
          navDaemonPort: result.navDaemonPort || DEFAULTS.navDaemonPort,
        });
      },
    );
  }, []);

  const update = useCallback(
    (key: keyof StoredSettings, value: string) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
      setError('');
    },
    [],
  );

  const handleSave = useCallback(() => {
    // Validate
    if (settings.navSecret.trim().length < 8) {
      setError('Connection key must be at least 8 characters.');
      return;
    }
    const port = Number(settings.navDaemonPort);
    if (!port || port < 1 || port > 65535) {
      setError('Port must be between 1 and 65535.');
      return;
    }

    chrome.storage.local.set(
      {
        navSecret: settings.navSecret.trim(),
        navDaemonUrl: settings.navDaemonUrl.trim() || DEFAULTS.navDaemonUrl,
        navDaemonPort: String(port),
      },
      () => {
        setSaved(true);
        setError('');
        setTimeout(() => setSaved(false), 2500);
      },
    );
  }, [settings]);

  return (
    <div className="h-full overflow-y-auto custom-scrollbar">
      <div className="p-4 space-y-4 animate-fade-in">
        {/* Section: Connection Key */}
        <section className="glass-panel p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <IconShieldLock size={15} className="text-accent-primary" />
            <h2 className="text-xs font-semibold text-text-primary">Connection Key</h2>
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            Must match the <code className="text-accent-primary font-mono text-[10px] bg-surface-overlay px-1 rounded">NAV_SECRET</code> set in your daemon. Run <code className="text-accent-primary font-mono text-[10px] bg-surface-overlay px-1 rounded">nav init</code> to generate one.
          </p>
          <input
            id="settings-secret"
            type="password"
            value={settings.navSecret}
            onChange={(e) => update('navSecret', e.target.value)}
            placeholder="Paste your key here"
            className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 transition-all"
          />
        </section>

        {/* Section: Daemon Address */}
        <section className="glass-panel p-4 space-y-2.5">
          <div className="flex items-center gap-2">
            <IconGlobe size={15} className="text-accent-secondary" />
            <h2 className="text-xs font-semibold text-text-primary">Daemon Address</h2>
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            Where the Neuro-Nav daemon is running. Default works for most setups.
          </p>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-text-tertiary mb-0.5 block">Host</label>
              <input
                id="settings-host"
                type="text"
                value={settings.navDaemonUrl}
                onChange={(e) => update('navDaemonUrl', e.target.value)}
                placeholder="ws://127.0.0.1"
                className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 transition-all"
              />
            </div>
            <div className="w-20">
              <label className="text-[10px] text-text-tertiary mb-0.5 block">Port</label>
              <input
                id="settings-port"
                type="text"
                inputMode="numeric"
                value={settings.navDaemonPort}
                onChange={(e) => update('navDaemonPort', e.target.value.replace(/\D/g, ''))}
                placeholder="9500"
                className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary font-mono text-center outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 transition-all"
              />
            </div>
          </div>
        </section>

        {/* Error */}
        {error && (
          <p className="text-[11px] text-red-400 flex items-center gap-1 px-1">
            <IconAlertTriangle size={12} /> {error}
          </p>
        )}

        {/* Save */}
        <button
          id="settings-save"
          onClick={handleSave}
          className="w-full py-2.5 bg-accent-primary text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
        >
          {saved ? (
            <>
              <IconCheck size={14} /> Saved
            </>
          ) : (
            'Save Changes'
          )}
        </button>

        {/* Footer hint */}
        <p className="text-[10px] text-text-tertiary text-center leading-snug">
          After saving, the extension will reconnect automatically.
        </p>
      </div>
    </div>
  );
}
