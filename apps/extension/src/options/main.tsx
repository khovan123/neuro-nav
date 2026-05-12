import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { IconShieldLock, IconCheck } from '@/shared/ui/Icons';
import '@/index.css';

function OptionsApp() {
  const [token, setToken] = useState('');
  const [saved, setSaved] = useState(false);

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

        <div className="glass-panel p-6">
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
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OptionsApp />
  </StrictMode>
);

