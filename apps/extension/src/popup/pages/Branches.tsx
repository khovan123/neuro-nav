/* ============================================================
   BRANCHES PAGE — Git-inspired session branching UI
   ============================================================ */

import { useEffect, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import {
  setBranches, addBranch, removeBranch, setActiveBranch,
  setStashEntries, removeLatestStash,
  setCurrentWindowId, setActiveBranchForWindow,
} from '@/store';
import { fromChromeTab, toSnapshot } from '@/core/entities/Tab';
import * as branchOps from '@/core/use-cases/manageBranches';
import * as stashOps from '@/core/use-cases/stashMemory';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { Badge } from '@/shared/ui/Badge';
import { Tooltip } from '@/shared/ui/Tooltip';
import { IconPlus, IconTrash, IconBranch, IconPlay } from '@/shared/ui/Icons';

const DEFAULT_PREFIXES = ['feat/', 'bug/', 'hotfix/', 'chore/', 'release/'];
const CUSTOM_PREFIX_KEY = 'neuro-nav-custom-prefixes';

function loadCustomPrefixes(): string[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_PREFIX_KEY) ?? '[]'); }
  catch { return []; }
}

function saveCustomPrefix(p: string) {
  const existing = loadCustomPrefixes();
  if (!existing.includes(p)) {
    existing.push(p);
    localStorage.setItem(CUSTOM_PREFIX_KEY, JSON.stringify(existing));
  }
}

export function Branches() {
  const dispatch = useAppDispatch();
  const { items: branches, activeBranchName } = useAppSelector((s) => s.branches);
  const { items: stashEntries } = useAppSelector((s) => s.stash);
  const [prefix, setPrefix] = useState('feat/');
  const [customPrefix, setCustomPrefix] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [customPrefixes, setCustomPrefixes] = useState<string[]>(loadCustomPrefixes);
  const [newBranchName, setNewBranchName] = useState('');
  const [creating, setCreating] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);

  const allPrefixes = [...DEFAULT_PREFIXES, ...customPrefixes];
  const activePrefix = isCustom ? (customPrefix.endsWith('/') ? customPrefix : customPrefix + '/') : prefix;

  // Resolve current window ID on mount
  useEffect(() => {
    chrome.windows.getCurrent().then((win) => {
      if (win.id != null) {
        setWindowId(win.id);
        dispatch(setCurrentWindowId(win.id));
      }
    });
  }, [dispatch]);

  // Load branches and stash
  useEffect(() => {
    branchOps.listBranches().then((b) => dispatch(setBranches(b)));
    stashOps.listStash().then((s) => dispatch(setStashEntries(s)));
  }, [dispatch]);

  // Get current tabs as snapshots (scoped to this window)
  const getCurrentTabs = useCallback(async () => {
    const queryOpts = windowId ? { windowId } : { currentWindow: true as const };
    const tabs = await chrome.tabs.query(queryOpts);
    return tabs.map(fromChromeTab).map(toSnapshot);
  }, [windowId]);

  // Create branch
  const handleCreate = useCallback(async () => {
    if (!newBranchName.trim()) return;
    setCreating(true);
    try {
      const fullName = `${activePrefix}${newBranchName.trim()}`;
      const currentTabs = await getCurrentTabs();
      const branch = await branchOps.createNewBranch(fullName, currentTabs, true, windowId ?? undefined);
      dispatch(addBranch(branch));
      if (windowId) {
        dispatch(setActiveBranchForWindow({ windowId, branchName: branch.name }));
      } else {
        dispatch(setActiveBranch(branch.name));
      }
      setNewBranchName('');
      // Persist custom prefix
      if (isCustom && customPrefix.trim()) {
        const normalized = customPrefix.trim().endsWith('/') ? customPrefix.trim() : customPrefix.trim() + '/';
        saveCustomPrefix(normalized);
        setCustomPrefixes(loadCustomPrefixes());
        setIsCustom(false);
        setPrefix(normalized);
        setCustomPrefix('');
      }
    } catch (err) {
      console.error('Create branch failed:', err);
    } finally {
      setCreating(false);
    }
  }, [newBranchName, activePrefix, isCustom, customPrefix, dispatch, getCurrentTabs]);

  // Checkout branch
  const handleCheckout = useCallback(async (name: string) => {
    setCheckingOut(name);
    try {
      const currentTabs = await getCurrentTabs();
      const wid = windowId ?? (await chrome.windows.getCurrent()).id!;
      const { tabsToOpen } = await branchOps.checkoutBranch(name, currentTabs, wid);

      // Close current tabs and open branch tabs
      const existingTabs = await chrome.tabs.query({ windowId: wid });

      // Open new tabs first
      for (const tab of tabsToOpen) {
        await chrome.tabs.create({ windowId: wid, url: tab.url, pinned: tab.pinned });
      }

      // Then close old tabs (skip if branch has no tabs)
      if (tabsToOpen.length > 0) {
        for (const tab of existingTabs) {
          if (tab.id) chrome.tabs.remove(tab.id);
        }
      }

      dispatch(setActiveBranchForWindow({ windowId: wid, branchName: name }));
      // Reload branches from DB
      const updated = await branchOps.listBranches();
      dispatch(setBranches(updated));
    } catch (err) {
      console.error('Checkout failed:', err);
    } finally {
      setCheckingOut(null);
    }
  }, [dispatch, getCurrentTabs]);

  // Delete branch
  const handleDelete = useCallback(async (id: string) => {
    try {
      await branchOps.deleteBranchById(id);
      dispatch(removeBranch(id));
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [dispatch]);

  // Stash current tabs
  const handleStash = useCallback(async () => {
    try {
      const currentTabs = await getCurrentTabs();
      await stashOps.stashTabs(currentTabs);

      // Close all tabs (open a blank one first so window doesn't close)
      const currentWindow = await chrome.windows.getCurrent();
      await chrome.tabs.create({ windowId: currentWindow.id, url: 'chrome://newtab' });
      const existingTabs = await chrome.tabs.query({ windowId: currentWindow.id });
      for (const tab of existingTabs) {
        if (tab.id && tab.url !== 'chrome://newtab') chrome.tabs.remove(tab.id);
      }

      const updated = await stashOps.listStash();
      dispatch(setStashEntries(updated));
    } catch (err) {
      console.error('Stash failed:', err);
    }
  }, [dispatch, getCurrentTabs]);

  // Pop stash
  const handlePop = useCallback(async () => {
    try {
      const entry = await stashOps.popStash();
      if (!entry) return;

      const currentWindow = await chrome.windows.getCurrent();
      for (const tab of entry.tabs) {
        await chrome.tabs.create({ windowId: currentWindow.id, url: tab.url, pinned: tab.pinned });
      }

      dispatch(removeLatestStash());
    } catch (err) {
      console.error('Pop failed:', err);
    }
  }, [dispatch]);

  return (
    <div className="flex flex-col h-full">
      {/* Active branch indicator */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-2">
          <IconBranch size={14} className="text-accent-primary" />
          <span className="text-xs text-text-tertiary">Current branch</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary font-mono">
            {activeBranchName ?? 'No branch'}
          </span>
          {activeBranchName && <Badge variant="success">active</Badge>}
        </div>
      </div>

      {/* Create branch */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center gap-1.5">
          {isCustom ? (
            <input
              value={customPrefix}
              onChange={(e) => setCustomPrefix(e.target.value)}
              placeholder="prefix/"
              autoFocus
              className="bg-surface-overlay text-accent-secondary text-xs font-mono font-semibold
                         w-20 px-2 py-[7px] rounded-l-md border border-border-subtle
                         outline-none focus:border-accent-primary/40 transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setIsCustom(false); setCustomPrefix(''); }
                if (e.key === 'Enter') document.getElementById('branch-name-input')?.focus();
              }}
              id="custom-prefix-input"
            />
          ) : (
            <select
              value={prefix}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setIsCustom(true);
                } else {
                  setPrefix(e.target.value);
                }
              }}
              className="bg-surface-overlay text-accent-secondary text-xs font-mono font-semibold
                         px-2 py-[7px] rounded-l-md border border-border-subtle
                         outline-none focus:border-accent-primary/40 transition-colors
                         appearance-none cursor-pointer"
              style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'6\' viewBox=\'0 0 10 6\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%2394a3b8\' fill=\'none\' stroke-width=\'1.5\' stroke-linecap=\'round\'/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center', paddingRight: '20px' }}
              id="branch-prefix-select"
            >
              {allPrefixes.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
          )}
          <Input
            placeholder="branch-name"
            value={newBranchName}
            onChange={(e) => setNewBranchName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 font-mono text-xs rounded-l-none! border-l-0!"
            id="branch-name-input"
          />
          <Button
            variant="primary" size="sm"
            icon={<IconPlus size={14} />}
            loading={creating}
            disabled={!newBranchName.trim()}
            onClick={handleCreate}
            id="create-branch-btn"
          >
            Create
          </Button>
        </div>
      </div>

      {/* Branch list + Stash */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Branches */}
        <div>
          <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-2">
            Branches ({branches.length})
          </h3>
          {branches.length === 0 ? (
            <div className="text-center py-8 text-text-tertiary">
              <IconBranch size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-xs">No branches yet</p>
              <p className="text-[11px] mt-1">Create one to start managing sessions</p>
            </div>
          ) : (
            <div className="space-y-1">
              {branches.map((branch, i) => {
                const isActiveHere = windowId != null && branch.activeInWindows?.includes(windowId);
                const otherWindowCount = (branch.activeInWindows?.length ?? 0) - (isActiveHere ? 1 : 0);
                const isActiveAnywhere = (branch.activeInWindows?.length ?? 0) > 0;

                return (
                <div
                  key={branch.id}
                  className={[
                    'flex items-center gap-2 px-2.5 py-2 rounded-lg',
                    'transition-all duration-(--duration-fast)',
                    'animate-fade-in',
                    isActiveHere
                      ? 'bg-accent-primary/10 border border-accent-primary/20'
                      : isActiveAnywhere
                        ? 'bg-accent-secondary/5 border border-accent-secondary/10'
                        : 'hover:bg-surface-overlay',
                  ].join(' ')}
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className={[
                    'status-dot shrink-0',
                    isActiveHere ? 'status-dot-active' : isActiveAnywhere ? 'status-dot-warning' : 'status-dot-idle',
                  ].join(' ')} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-mono text-text-primary truncate block">
                      {branch.name}
                    </span>
                    <span className="text-[10px] text-text-tertiary">
                      {branch.tabs.length} tabs · {new Date(branch.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {isActiveHere && ' · active here'}
                      {otherWindowCount > 0 && ` · active in ${otherWindowCount} other window${otherWindowCount > 1 ? 's' : ''}`}
                    </span>
                  </div>
                  {!isActiveHere && (
                    <Button
                      variant="ghost" size="sm"
                      icon={<IconPlay size={11} />}
                      loading={checkingOut === branch.name}
                      onClick={() => handleCheckout(branch.name)}
                    >
                      Checkout
                    </Button>
                  )}
                  {!isActiveAnywhere && (
                    <Tooltip content="Delete branch">
                      <button
                        onClick={() => handleDelete(branch.id)}
                        className="p-1 rounded text-text-tertiary hover:text-accent-danger hover:bg-accent-danger/10 transition-colors cursor-pointer"
                      >
                        <IconTrash size={12} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Stash section */}
        <div>
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
              Stash ({stashEntries.length})
            </h3>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" onClick={handleStash} id="stash-push-btn">
                Stash
              </Button>
              <Button
                variant="primary" size="sm"
                onClick={handlePop}
                disabled={stashEntries.length === 0}
                id="stash-pop-btn"
              >
                Pop
              </Button>
            </div>
          </div>
          {stashEntries.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center py-4">Stash is empty</p>
          ) : (
            <div className="space-y-1">
              {[...stashEntries].reverse().map((entry, i) => (
                <div
                  key={entry.id}
                  className="card-interactive px-3 py-2 animate-fade-in"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-text-secondary">
                      {entry.tabs.length} tabs stashed
                    </span>
                    <span className="text-[10px] text-text-tertiary">
                      {new Date(entry.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {entry.message && (
                    <p className="text-[11px] text-text-tertiary mt-0.5 truncate">{entry.message}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
