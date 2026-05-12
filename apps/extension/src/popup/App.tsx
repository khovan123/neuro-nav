/* ============================================================
   POPUP APP — Main extension UI with sidebar navigation
   ============================================================ */

import { useState, useEffect, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/store/hooks';
import { navigate, type NavPage } from '@/store';
import { ActiveTabs } from './pages/ActiveTabs';
import { Workspaces } from './pages/Workspaces';
import { Branches } from './pages/Branches';
import { BrowsingGraph } from './pages/BrowsingGraph';
import { Peers } from './pages/Peers';
import { CommandPalette } from './components/CommandPalette';
import { IconTabs, IconGrid, IconBranch, IconGraph, IconPeers, IconSearch } from '@/shared/ui/Icons';
import { Tooltip } from '@/shared/ui/Tooltip';

const NAV_ITEMS: { page: NavPage; icon: typeof IconTabs; label: string; ready: boolean }[] = [
  { page: 'tabs', icon: IconTabs, label: 'Active Tabs', ready: true },
  { page: 'workspaces', icon: IconGrid, label: 'Workspaces', ready: true },
  { page: 'branches', icon: IconBranch, label: 'Branches', ready: true },
  { page: 'graph', icon: IconGraph, label: 'Graph', ready: true },
  { page: 'peers', icon: IconPeers, label: 'Peers', ready: true },
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
    case 'peers':
      return <Peers />;
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

export function App() {
  const dispatch = useAppDispatch();
  const currentPage = useAppSelector((s) => s.nav.currentPage);
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  return (
    <div className="flex h-[540px] w-[380px] bg-surface-base">
      {/* Sidebar */}
      <nav className="w-12 flex flex-col items-center py-3 gap-1 border-r border-border-subtle bg-surface-raised/50">
        {/* Logo */}
        <div className="w-8 h-8 rounded-lg bg-accent-primary/20 flex items-center justify-center mb-3 animate-pulse-glow">
          <span className="text-base font-bold text-gradient-primary">N</span>
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
      </nav>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
          <h1 className="text-sm font-semibold text-text-primary">
            {NAV_ITEMS.find((n) => n.page === currentPage)?.label}
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
            <span className="text-[10px] font-mono text-text-tertiary bg-surface-overlay px-1.5 py-0.5 rounded">
              v1.0.0
            </span>
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-hidden">
          <PageContent page={currentPage} />
        </div>
      </main>

      {/* Command Palette overlay */}
      <CommandPalette isOpen={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
