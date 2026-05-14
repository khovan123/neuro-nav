/* ============================================================
   POPUP APP — Main extension UI with sidebar navigation
   ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { navigate, restoreNav, type NavPage } from '@/store';
import { ActiveTabs } from './pages/ActiveTabs';
import { Workspaces } from './pages/Workspaces';
import { Branches } from './pages/Branches';
import { BrowsingGraph } from './pages/BrowsingGraph';
import { History } from './pages/History';
import { Peers } from './pages/Peers';
import { Snippets } from './pages/Snippets';
import { Settings } from './pages/Settings';
import { CommandPalette } from './components/CommandPalette';
import { AiStatusBar, AiStatusDot } from './components/AiStatusBar';
import { IconTabs, IconGrid, IconBranch, IconHistory, IconPeers, IconScissors, IconSettings, IconSearch, IconShieldLock, IconAlertTriangle } from '@/shared/ui/Icons';
import { Tooltip } from '@/shared/ui/Tooltip';

const NAV_ITEMS: { page: NavPage; icon: typeof IconTabs; label: string; ready: boolean }[] = [
  { page: 'tabs', icon: IconTabs, label: 'Open Tabs', ready: true },
  { page: 'workspaces', icon: IconGrid, label: 'Workspaces', ready: true },
  { page: 'branches', icon: IconBranch, label: 'Sessions', ready: true },

  { page: 'history', icon: IconHistory, label: 'History', ready: true },
  { page: 'snippets', icon: IconScissors, label: 'Snippets', ready: true },
  { page: 'peers', icon: IconPeers, label: 'Team', ready: true },
];

function PageContent({ page }: { page: NavPage }) {
  switch (page) {
    case 'tabs':
      return <ActiveTabs />;
    case 'workspaces':
      return <Workspaces />;
    case 'branches':
      return <Branches />;
    case 'graph':
      return <BrowsingGraph />;
    case 'history':
      return <History />;
    case 'snippets':
      return <Snippets />;
    case 'peers':
      return <Peers />;
    case 'settings':
      return <Settings />;
    default:
      return null;
  }
}

function PlaceholderPage({ title, emoji, desc }: { title: string; emoji: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-text-tertiary animate-fade-in">
      <span className="text-4xl mb-4">{emoji}</span>
      <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      <p className="text-xs mt-1">{desc}</p>
    </div>
  );
}

// ---- Secret Key Setup Gate ----

function SecretSetup({ onComplete }: { onComplete: () => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = useCallback(() => {
    const trimmed = key.trim();
    if (trimmed.length < 8) {
      setError('Connection key must be at least 8 characters');
      return;
    }
    chrome.storage.local.set({ navSecret: trimmed }, () => {
      onComplete();
    });
  }, [key, onComplete]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  }, [handleSubmit]);

  return (
    <div className="h-[540px] w-[380px] bg-surface-base overflow-hidden flex flex-col">
      {/* Top spacer — vertically centers the card block */}
      <div className="flex-1 min-h-0" />

      {/* Centered content block */}
      <div className="px-8 shrink-0 animate-fade-in">
        {/* Logo */}
        <div className="flex flex-col items-center mb-5">
          <div className="w-12 h-12 rounded-xl bg-accent-primary/20 flex items-center justify-center mb-2 animate-pulse-glow">
            <span className="text-xl font-bold text-gradient-primary">N</span>
          </div>
          <h1 className="text-base font-bold text-text-primary">Welcome to Neuro-Nav</h1>
          <p className="text-[11px] text-text-tertiary mt-0.5">Let's get you connected</p>
        </div>

        {/* Setup card */}
        <div className="glass-panel p-4 space-y-3">
          <div>
            <div className="flex items-center gap-1.5 mb-0.5">
              <IconShieldLock size={14} className="text-accent-primary" />
              <label className="text-xs font-semibold text-text-primary">Connection Key</label>
            </div>
            <p className="text-[10px] text-text-tertiary leading-relaxed">
              Paste the secret key from your terminal. You can get one by running <code className="text-accent-primary font-mono text-[10px] bg-surface-overlay px-1 rounded">nav init</code>.
            </p>
          </div>

          <input
            id="secret-setup-input"
            type="password"
            value={key}
            onChange={(e) => { setKey(e.target.value); setError(''); }}
            onKeyDown={handleKeyDown}
            placeholder="Paste your key here"
            autoFocus
            className="w-full bg-surface-overlay border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary font-mono outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/30 transition-all"
          />

          {error && (
            <p className="text-[11px] text-red-400 flex items-center gap-1">
              <IconAlertTriangle size={12} /> {error}
            </p>
          )}

          <button
            id="secret-setup-submit"
            onClick={handleSubmit}
            disabled={!key.trim()}
            className="w-full py-2 bg-accent-primary text-white text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Connect
          </button>

          <p className="text-[10px] text-text-tertiary text-center leading-snug">
            You can update this anytime in <strong>Settings</strong>.
          </p>
        </div>
      </div>

      {/* Bottom spacer */}
      <div className="flex-1 min-h-0" />
    </div>
  );
}

// ---- Main App ----

export function App() {
  const dispatch = useAppDispatch();
  const currentPage = useAppSelector((s) => s.nav.currentPage);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [secretReady, setSecretReady] = useState<boolean | null>(null); // null = loading

  // Check if secret key is configured
  useEffect(() => {
    chrome.storage.local.get(['navSecret'], (result) => {
      setSecretReady(!!result.navSecret);
    });
  }, []);

  // Restore last active nav page
  useEffect(() => {
    chrome.storage.local.get(['neuroNavActivePage'], (result) => {
      if (result.neuroNavActivePage) {
        dispatch(restoreNav(result.neuroNavActivePage as NavPage));
      }
    });
  }, [dispatch]);

  // Listen for daemon connection state changes
  useEffect(() => {
    chrome.storage.local.get('daemonConnected', (r) => {
      setDaemonConnected(!!r.daemonConnected);
    });
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.daemonConnected) {
        setDaemonConnected(!!changes.daemonConnected.newValue);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, []);

  // Global Cmd/Ctrl+K shortcut
  const handleGlobalKey = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setPaletteOpen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', handleGlobalKey);
    return () => document.removeEventListener('keydown', handleGlobalKey);
  }, [handleGlobalKey]);

  // Loading state
  if (secretReady === null) {
    return (
      <div className="flex items-center justify-center h-[540px] w-[380px] bg-surface-base overflow-hidden">
        <div className="w-8 h-8 rounded-xl bg-accent-primary/20 flex items-center justify-center animate-pulse-glow">
          <span className="text-base font-bold text-gradient-primary">N</span>
        </div>
      </div>
    );
  }

  // Secret key not configured — show setup gate
  if (!secretReady) {
    return <SecretSetup onComplete={() => setSecretReady(true)} />;
  }

  return (
    <div className="flex h-[540px] w-[380px] bg-surface-base">
      {/* Sidebar */}
      <nav className="w-12 flex flex-col items-center py-3 gap-1 border-r border-border-subtle bg-surface-raised/50">
        {/* Logo */}
        <div className="w-8 h-8 rounded-lg bg-accent-primary/20 flex items-center justify-center mb-3 animate-pulse-glow">
          <img src="/icons/icon-16.png" alt="Neuro-Nav" width={16} height={16} className="rounded-sm" />
        </div>

        {/* Nav items */}
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.page;
          return (
            <Tooltip key={item.page} content={item.label} position="right">
              <button
                onClick={() => item.ready && dispatch(navigate(item.page))}
                className={[
                  'w-9 h-9 rounded-lg flex items-center justify-center',
                  'transition-all duration-(--duration-normal) ease-out-expo',
                  'cursor-pointer',
                  isActive
                    ? 'bg-accent-primary/15 text-accent-primary shadow-glow-primary/30'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-overlay',
                  !item.ready ? 'opacity-30 cursor-not-allowed' : '',
                ].join(' ')}
                id={`nav-${item.page}`}
                disabled={!item.ready}
              >
                <Icon size={18} />
              </button>
            </Tooltip>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings — pinned to bottom */}
        <Tooltip content="Settings" position="right">
          <button
            onClick={() => dispatch(navigate('settings'))}
            className={[
              'w-9 h-9 rounded-lg flex items-center justify-center',
              'transition-all duration-(--duration-normal) ease-out-expo',
              'cursor-pointer mb-1',
              currentPage === 'settings'
                ? 'bg-accent-primary/15 text-accent-primary shadow-glow-primary/30'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-overlay',
            ].join(' ')}
            id="nav-settings"
          >
            <IconSettings size={18} />
          </button>
        </Tooltip>
      </nav>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
          <h1 className="text-sm font-semibold text-text-primary">
            {NAV_ITEMS.find((n) => n.page === currentPage)?.label ?? 'Settings'}
          </h1>
          <div className="flex items-center gap-1.5">
            <Tooltip content="Search (Ctrl+K)" position="bottom">
              <button
                onClick={() => setPaletteOpen(true)}
                className="p-1.5 rounded-md text-text-tertiary hover:text-accent-primary hover:bg-accent-primary/10 transition-colors cursor-pointer"
                id="search-trigger"
              >
                <IconSearch size={14} />
              </button>
            </Tooltip>
          </div>
        </header>

        {/* AI Model loading progress */}
        <AiStatusBar />

        {/* Page content */}
        <div className="flex-1 overflow-hidden">
          <PageContent page={currentPage} />
        </div>

        {/* Footer — status dots + version */}
        <footer className="flex items-center justify-end gap-2 px-3 py-1.5 border-t border-border-default bg-surface-primary/50">
          <Tooltip content={daemonConnected ? 'Server: Connected' : 'Server: Disconnected'} position="left">
            <span className={`w-2 h-2 rounded-full shrink-0 ${daemonConnected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-zinc-600'}`} />
          </Tooltip>
          <Tooltip content="AI Status" position="left">
            <AiStatusDot />
          </Tooltip>
          <span className="text-[10px] font-mono text-text-tertiary bg-surface-overlay px-1.5 py-0.5 rounded">
            v1.5.0
          </span>
        </footer>
      </main>

      {/* Command Palette overlay */}
      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

