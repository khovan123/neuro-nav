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
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

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
      setError('Key must be at least 8 characters.');
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

  const handleResetData = useCallback(async () => {
    const confirmed = window.confirm(
      '⚠️ WARNING: This will permanently delete:\n\n' +
      '• All search data\n' +
      '• Browsing history\n' +
      '• Saved workspaces\n' +
      '• Saved tabs\n\n' +
      'Your sessions will be preserved.\n\n' +
      'This action cannot be undone. Continue?'
    );
    if (!confirmed) return;

    setResetting(true);
    try {
      // 1. Clear search index IDB (neuro-nav-search)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('neuro-nav-search', 2);
        req.onsuccess = () => {
          const db = req.result;
          if (db.objectStoreNames.contains('chunks')) {
            const tx = db.transaction('chunks', 'readwrite');
            tx.objectStore('chunks').clear();
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
          } else {
            db.close();
            resolve();
          }
        };
        req.onerror = () => reject(req.error);
      });

      // 2. Clear main IDB stores EXCEPT branches (neuro-nav)
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('neuro-nav', 1);
        req.onsuccess = () => {
          const db = req.result;
          const storesToClear = ['workspaces', 'stash', 'history'].filter(
            (s) => db.objectStoreNames.contains(s)
          );
          if (storesToClear.length === 0) { db.close(); resolve(); return; }
          const tx = db.transaction(storesToClear, 'readwrite');
          for (const name of storesToClear) {
            tx.objectStore(name).clear();
          }
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });

      // 3. Clear chrome.storage.local (except secrets & branch data)
      const all = await chrome.storage.local.get(null);
      const preserved: Record<string, unknown> = {};
      for (const key of ['navSecret', 'navDaemonUrl', 'navDaemonPort']) {
        if (all[key] !== undefined) preserved[key] = all[key];
      }
      for (const key of Object.keys(all)) {
        if (key.startsWith('branch_') || key === 'activeBranches') {
          preserved[key] = all[key];
        }
      }
      await chrome.storage.local.clear();
      await chrome.storage.local.set(preserved);

      setResetDone(true);
      setTimeout(() => setResetDone(false), 3000);
    } catch (err) {
      console.error('[Neuro-Nav] Reset failed:', err);
      setError('Reset failed. Check console for details.');
    } finally {
      setResetting(false);
    }
  }, []);

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
            Paste the key shown when you set up the Neuro-Nav server. It keeps your connection secure.
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
            <h2 className="text-xs font-semibold text-text-primary">Server Address</h2>
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            Where the Neuro-Nav server is running. The default works for most setups.
          </p>

          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-text-tertiary mb-0.5 block">Address</label>
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
          <p className="text-[11px] text-accent-danger flex items-center gap-1 px-1">
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

        {/* Danger Zone: Reset Data */}
        <section className="glass-panel p-4 space-y-2.5 border border-accent-danger/20">
          <div className="flex items-center gap-2">
            <IconAlertTriangle size={15} className="text-accent-danger" />
            <h2 className="text-xs font-semibold text-accent-danger">Danger Zone</h2>
          </div>
          <p className="text-[10px] text-text-tertiary leading-relaxed">
            Clear search data, history, workspaces & saved tabs.
            <span className="text-accent-primary"> Your sessions will be preserved.</span>
          </p>
          <button
            id="reset-data-btn"
            onClick={handleResetData}
            disabled={resetting}
            className="w-full py-2 bg-accent-danger/10 text-accent-danger text-xs font-semibold rounded-lg border border-accent-danger/20 hover:bg-accent-danger/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
          >
            {resetting ? 'Resetting...' : resetDone ? <><IconCheck size={12} /> Done</> : 'Reset All Data'}
          </button>
        </section>

        {/* Footer hint */}
        <p className="text-[10px] text-text-tertiary text-center leading-snug">
          Changes are applied instantly — no need to restart.
        </p>
      </div>
    </div>
  );
}
