import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { IconShieldLock, IconCheck } from '@/shared/ui/Icons';
import '@/index.css';

function OptionsApp() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    chrome.storage.local.get(['navSecret'], (result) => {
      if (result.navSecret) setToken(result.navSecret);
    });
  }, []);

  const handleSave = useCallback(() => {
    chrome.storage.local.set({ navSecret: token }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }, [token]);

  const handleResetData = useCallback(async () => {
    const confirmed = window.confirm(
      '⚠️ WARNING: This will permanently delete:\n\n' +
      '• All search index data (semantic chunks & vectors)\n' +
      '• Browsing history\n' +
      '• Saved workspaces\n' +
      '• Tab stash entries\n\n' +
      'Your branches will be preserved.\n\n' +
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

      // 3. Clear chrome.storage.local (except navSecret & branch data)
      const keysToPreserve = ['navSecret'];
      const all = await chrome.storage.local.get(null);
      const preserved: Record<string, unknown> = {};
      for (const key of keysToPreserve) {
        if (all[key] !== undefined) preserved[key] = all[key];
      }
      // Also preserve any branch-related keys
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
      alert('Reset failed. Check console for details.');
    } finally {
      setResetting(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-surface-base p-8">
      <div className="max-w-2xl mx-auto animate-fade-in">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-accent-primary/20 flex items-center justify-center animate-pulse-glow">
            <span className="text-lg font-bold text-gradient-primary">N</span>
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Neuro-Nav Settings</h1>
            <p className="text-xs text-text-tertiary">The Developer's Micro-OS</p>
          </div>
        </div>

        <div className="glass-panel p-6 mb-4">
          <h2 className="text-sm font-semibold text-text-primary mb-4">General</h2>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-primary">Auto-Pruning</p>
                <p className="text-xs text-text-tertiary">Clean history older than 30 days</p>
              </div>
              <label className="relative inline-flex cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-9 h-5 bg-surface-hover rounded-full peer peer-checked:bg-accent-primary transition-colors peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all"></div>
              </label>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-text-primary">Retention Period</p>
                <p className="text-xs text-text-tertiary">Days to keep history data</p>
              </div>
              <input type="number" defaultValue={30} min={1} max={365} className="w-16 bg-surface-overlay border border-border-subtle rounded-md px-2 py-1 text-sm text-text-primary text-center outline-none focus:border-accent-primary" />
            </div>
          </div>
        </div>

        <div className="glass-panel p-6 mb-4">
          <h2 className="text-sm font-semibold text-text-primary mb-4">Security</h2>

          <div className="space-y-3">
            <div>
              <p className="text-sm text-text-primary">Daemon Secret Token</p>
              <p className="text-xs text-text-tertiary mb-2">Must match NAV_SECRET in your .env file</p>
            </div>
            <div className="flex gap-2">
              <input
                id="nav-secret-input"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your NAV_SECRET here"
                className="flex-1 bg-surface-overlay border border-border-subtle rounded-md px-3 py-1.5 text-sm text-text-primary font-mono outline-none focus:border-accent-primary"
              />
              <button
                onClick={handleSave}
                className="px-4 py-1.5 bg-accent-primary text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity"
              >
                {saved ? <><IconCheck size={14} className="inline -mt-0.5" /> Saved</> : 'Save'}
              </button>
            </div>
            <p className="text-xs text-text-tertiary">
              After saving, reload the extension to apply the new token.
            </p>
          </div>
        </div>

        <div className="glass-panel p-6 border border-accent-danger/20">
          <h2 className="text-sm font-semibold text-accent-danger mb-4">Danger Zone</h2>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Reset All Data</p>
              <p className="text-xs text-text-tertiary">
                Clear search index, history, workspaces & stash.
                <span className="text-accent-primary"> Branches will be preserved.</span>
              </p>
            </div>
            <button
              id="reset-data-btn"
              onClick={handleResetData}
              disabled={resetting}
              className="px-4 py-1.5 bg-accent-danger/20 text-accent-danger text-sm font-medium rounded-md border border-accent-danger/30 hover:bg-accent-danger/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {resetting ? 'Resetting...' : resetDone ? '✓ Done' : 'Reset Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>
);

