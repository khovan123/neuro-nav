/* ============================================================
   SESSIONS PAGE — Session management UI
   ============================================================ */

import React, { useEffect, useState, useCallback } from 'react';
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
import { IconPlus, IconTrash, IconBranch, IconPlay, IconExternalLink } from '@/shared/ui/Icons';

/** Ask the background to group all tabs in a window under a named Chrome Tab Group */
async function requestSyncTabGroup(windowId: number, branchName: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'SYNC_TAB_GROUP',
      payload: { windowId, branchName },
    });
  } catch { /* ignore if background is not ready */ }
}

/** Ask the background to ungroup all tabs in a window (remove Chrome Tab Group) */
async function requestUngroupTabs(windowId: number): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'UNGROUP_TABS',
      payload: { windowId },
    });
  } catch { /* ignore */ }
}

/** Toggle collapse/expand a branch's Chrome Tab Group */
async function requestCollapseTabGroup(windowId: number, branchName: string): Promise<boolean | null> {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'COLLAPSE_TAB_GROUP',
      payload: { windowId, branchName },
    });
    return resp?.collapsed ?? null;
  } catch { return null; }
}

/** Close (remove all tabs in) a branch's Chrome Tab Group */
async function requestCloseTabGroup(windowId: number, branchName: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: 'CLOSE_TAB_GROUP',
      payload: { windowId, branchName },
    });
  } catch { /* ignore */ }
}

const DEFAULT_PREFIXES = ['space', 'feat', 'work', 'research', 'project', 'personal', 'temp'];

/** Sanitize session name: lowercase, no slashes, spaces → dashes, trim leading/trailing dashes */
function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\//g, '')     // strip slashes
    .replace(/\s+/g, '-')   // spaces → dashes
    .replace(/[^a-z0-9\-_.]/g, '') // keep only safe chars
    .replace(/-{2,}/g, '-') // collapse double dashes
    .replace(/^-+|-+$/g, ''); // trim leading/trailing dashes
}
const CUSTOM_PREFIX_KEY = 'neuro-nav-custom-prefixes';

function loadCustomPrefixes(): string[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_PREFIX_KEY) ?? '[]'); }
  catch { return []; }
}

function saveCustomPrefix(p: string) {
  const clean = p.replace(/\//g, '').trim().toLowerCase();
  if (!clean) return;
  const existing = loadCustomPrefixes();
  if (!existing.includes(clean)) {
    existing.push(clean);
    localStorage.setItem(CUSTOM_PREFIX_KEY, JSON.stringify(existing));
  }
}

export function Branches() {
  const dispatch = useAppDispatch();
  const { items: branches, activeBranchName } = useAppSelector((s) => s.branches);
  const { items: stashEntries } = useAppSelector((s) => s.stash);
  const [prefix, setPrefix] = useState('space');
  const [duplicateError, setDuplicateError] = useState('');
  const [customPrefix, setCustomPrefix] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [customPrefixes, setCustomPrefixes] = useState<string[]>(loadCustomPrefixes);
  const [newBranchName, setNewBranchName] = useState('');
  const [creating, setCreating] = useState(false);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [merging, setMerging] = useState<string | null>(null);  // branch name being merged
  const [mergeTarget, setMergeTarget] = useState<string>('');
  const [windowId, setWindowId] = useState<number | null>(null);

  const allPrefixes = [...DEFAULT_PREFIXES, ...customPrefixes];
  // Auto-append '/' only when a category is selected — user never types it
  const activePrefix = isCustom
    ? (customPrefix.replace(/\//g, '').trim().toLowerCase() + '/')
    : (prefix + '/');

  // Resolve current window ID + detect active branch from current tab's group
  useEffect(() => {
    chrome.windows.getCurrent().then(async (win) => {
      if (win.id == null) return;
      setWindowId(win.id);
      dispatch(setCurrentWindowId(win.id));

      // Detect which branch the user is actually in based on the active tab's group
      try {
        const [activeTab] = await chrome.tabs.query({ windowId: win.id, active: true });
        if (activeTab?.groupId && activeTab.groupId !== -1) {
          const group = await chrome.tabGroups.get(activeTab.groupId);
          if (group.title) {
            dispatch(setActiveBranchForWindow({ windowId: win.id, branchName: group.title }));
          }
        }
      } catch { /* no active tab or group — use stored mapping */ }
    });
  }, [dispatch]);

  // Load branches and stash
  useEffect(() => {
    branchOps.listBranches().then((b) => dispatch(setBranches(b)));
    stashOps.listStash().then((s) => dispatch(setStashEntries(s)));
  }, [dispatch]);

  // Re-sync branch data when tabs change (close/create/move)
  // Waits 600ms to let the background's 500ms debounce sync finish first.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const reload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        branchOps.listBranches().then((b) => dispatch(setBranches(b)));
      }, 600);
    };

    chrome.tabs.onRemoved.addListener(reload);
    chrome.tabs.onCreated.addListener(reload);

    return () => {
      if (timer) clearTimeout(timer);
      chrome.tabs.onRemoved.removeListener(reload);
      chrome.tabs.onCreated.removeListener(reload);
    };
  }, [dispatch]);

  // Get current tabs as snapshots (scoped to this window)
  const getCurrentTabs = useCallback(async () => {
    const queryOpts = windowId ? { windowId } : { currentWindow: true as const };
    const tabs = await chrome.tabs.query(queryOpts);
    return tabs.map(fromChromeTab).map(toSnapshot);
  }, [windowId]);

  // Create branch
  const handleCreate = useCallback(async () => {
    const cleaned = sanitizeName(newBranchName);
    if (!cleaned) return;

    // Check for duplicate name before creating
    const fullName = `${activePrefix}${cleaned}`;
    if (branches.some((b) => b.name === fullName)) {
      setDuplicateError(`"${fullName}" already exists`);
      return;
    }

    setDuplicateError('');
    setCreating(true);
    try {
      const currentWid = windowId ?? (await chrome.windows.getCurrent()).id!;
      const hasActiveBranch = branches.some(
        (b) => b.activeInWindows?.includes(currentWid)
      );

      let targetWid: number;
      let tabs: ReturnType<typeof toSnapshot>[];

      if (hasActiveBranch) {
        // A branch is already active here → open a fresh window so histories stay separate
        const newWindow = await chrome.windows.create({ url: 'chrome://newtab' });
        targetWid = newWindow.id!;
        const freshTabs = await chrome.tabs.query({ windowId: targetWid });
        tabs = freshTabs.map(fromChromeTab).map(toSnapshot);
      } else {
        // No active branch in this window → create branch with current tabs
        targetWid = currentWid;
        tabs = await getCurrentTabs();
      }

      const branch = await branchOps.createNewBranch(fullName, tabs, true, targetWid);
      dispatch(addBranch(branch));
      dispatch(setActiveBranchForWindow({ windowId: targetWid, branchName: branch.name }));
      // Sync Chrome Tab Group
      requestSyncTabGroup(targetWid, fullName);
      setNewBranchName('');
      // Persist custom prefix (stored without '/')
      if (isCustom && customPrefix.trim()) {
        saveCustomPrefix(customPrefix);
        setCustomPrefixes(loadCustomPrefixes());
        setIsCustom(false);
        setPrefix(customPrefix.replace(/\//g, '').trim().toLowerCase());
        setCustomPrefix('');
      }
    } catch (err) {
      console.error('Create branch failed:', err);
    } finally {
      setCreating(false);
    }
  }, [newBranchName, activePrefix, branches, windowId, isCustom, customPrefix, dispatch, getCurrentTabs]);

  // Checkout branch (Switch) — delegate to background for atomic tab+group handling
  const handleCheckout = useCallback(async (name: string) => {
    setCheckingOut(name);
    try {
      const wid = windowId ?? (await chrome.windows.getCurrent()).id!;

      // Delegate entirely to background — it handles tab swap + group creation atomically
      await chrome.runtime.sendMessage({
        type: 'BRANCH_CHECKOUT',
        payload: { name, windowId: wid },
      });

      dispatch(setActiveBranchForWindow({ windowId: wid, branchName: name }));

      // Reload branches from DB
      const updated = await branchOps.listBranches();
      dispatch(setBranches(updated));
    } catch (err) {
      console.error('Checkout failed:', err);
    } finally {
      setCheckingOut(null);
    }
  }, [dispatch, windowId]);

  // Checkout branch in a NEW window
  const handleCheckoutNewWindow = useCallback(async (name: string) => {
    setCheckingOut(name);
    try {
      await chrome.runtime.sendMessage({
        type: 'BRANCH_CHECKOUT_NEW_WINDOW',
        payload: { name },
      });
      const updated = await branchOps.listBranches();
      dispatch(setBranches(updated));
    } catch (err) {
      console.error('Open in new window failed:', err);
    } finally {
      setCheckingOut(null);
    }
  }, [dispatch]);

  // Delete branch
  const handleDelete = useCallback(async (id: string) => {
    try {
      // Find the branch to check if it's active in any window
      const branch = branches.find(b => b.id === id);
      const activeWindows = branch?.activeInWindows ?? [];

      await branchOps.deleteBranchById(id);
      dispatch(removeBranch(id));

      // Ungroup tabs in all windows where this branch was active
      for (const wid of activeWindows) {
        requestUngroupTabs(wid);
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [dispatch, branches]);

  // Merge branch
  const handleMerge = useCallback(async (sourceName: string, targetName: string) => {
    if (!targetName || sourceName === targetName) return;
    try {
      await chrome.runtime.sendMessage({
        type: 'BRANCH_MERGE',
        payload: { source: sourceName, target: targetName, deleteSource: false },
      });
      // Reload branches
      const updated = await branchOps.listBranches();
      dispatch(setBranches(updated));
      setMerging(null);
      setMergeTarget('');
    } catch (err) {
      console.error('Merge failed:', err);
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
      {/* Active session indicator */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center gap-2 mb-2">
          <IconBranch size={14} className="text-accent-primary" />
          <span className="text-xs text-text-tertiary">Current session</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary font-mono">
            {activeBranchName ?? 'No active session'}
          </span>
          {activeBranchName && <Badge variant="success">active</Badge>}
        </div>
      </div>

      {/* Create session */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center gap-1.5">
          {isCustom ? (
            <input
              value={customPrefix}
              onChange={(e) => setCustomPrefix(e.target.value.replace(/\//g, '').toLowerCase())}
              placeholder="category"
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
                <option key={p} value={p}>{p}/</option>
              ))}
              <option value="__custom__">Custom…</option>
            </select>
          )}
          <Input
            placeholder="session name"
            value={newBranchName}
            onChange={(e) => { setNewBranchName(sanitizeName(e.target.value)); setDuplicateError(''); }}
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
        {duplicateError && (
          <p className="text-[11px] text-red-400 mt-1.5 px-1 animate-fade-in">
            ⚠ {duplicateError}
          </p>
        )}
      </div>

      {/* Session list + Saved tabs */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Sessions */}
        <div>
          <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider px-1 mb-2">
            Sessions ({branches.length})
          </h3>
          {branches.length === 0 ? (
            <div className="text-center py-8 text-text-tertiary">
              <IconBranch size={28} className="mx-auto mb-2 opacity-30" />
              <p className="text-xs">No sessions yet</p>
              <p className="text-[11px] mt-1">Create one to organise your tabs</p>
            </div>
          ) : (
            <div className="space-y-1">
              {branches.map((branch, i) => {
                const isActiveHere = windowId != null && branch.activeInWindows?.includes(windowId);
                const otherWindowCount = (branch.activeInWindows?.length ?? 0) - (isActiveHere ? 1 : 0);
                const isActiveAnywhere = (branch.activeInWindows?.length ?? 0) > 0;

                return (
                <React.Fragment key={branch.id}>
                <div
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
                      {isActiveHere && ' · in use here'}
                      {otherWindowCount > 0 && ` · open in ${otherWindowCount} other window${otherWindowCount > 1 ? 's' : ''}`}
                    </span>
                  </div>
                  {isActiveHere ? (
                    <Tooltip content="Close group (Alt+Shift+W)">
                      <button
                        onClick={() => windowId && requestCloseTabGroup(windowId, branch.name)}
                        className="p-1 rounded text-text-tertiary hover:text-accent-danger hover:bg-accent-danger/10 transition-colors cursor-pointer"
                      >
                        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 6L6 18" />
                          <path d="M6 6l12 12" />
                        </svg>
                      </button>
                    </Tooltip>
                  ) : (
                    <Button
                      variant="ghost" size="sm"
                      icon={<IconPlay size={11} />}
                      loading={checkingOut === branch.name}
                      onClick={() => handleCheckout(branch.name)}
                    >
                      Switch
                    </Button>
                  )}
                  <Tooltip content="Open in new window">
                    <button
                      onClick={() => handleCheckoutNewWindow(branch.name)}
                      className="p-1 rounded text-text-tertiary hover:text-accent-primary hover:bg-accent-primary/10 transition-colors cursor-pointer"
                    >
                      <IconExternalLink size={12} />
                    </button>
                  </Tooltip>
                  {branches.length > 1 && merging !== branch.name && (
                    <Tooltip content="Merge into another session">
                      <button
                        onClick={() => { setMerging(branch.name); setMergeTarget(''); }}
                        className="p-1 rounded text-text-tertiary hover:text-accent-secondary hover:bg-accent-secondary/10 transition-colors cursor-pointer"
                      >
                        <IconBranch size={12} />
                      </button>
                    </Tooltip>
                  )}
                  {!isActiveAnywhere && (
                    <Tooltip content="Delete session">
                      <button
                        onClick={() => handleDelete(branch.id)}
                        className="p-1 rounded text-text-tertiary hover:text-accent-danger hover:bg-accent-danger/10 transition-colors cursor-pointer"
                      >
                        <IconTrash size={12} />
                      </button>
                    </Tooltip>
                  )}
                </div>
                {merging === branch.name && (
                  <div className="flex items-center gap-1.5 mt-1.5 pl-5 animate-fade-in">
                    <span className="text-[10px] text-text-tertiary shrink-0">Merge into</span>
                    <select
                      value={mergeTarget}
                      onChange={(e) => setMergeTarget(e.target.value)}
                      className="flex-1 bg-surface-overlay text-xs font-mono text-text-primary
                                 px-2 py-1 rounded border border-border-subtle
                                 outline-none focus:border-accent-primary/40 transition-colors
                                 appearance-none cursor-pointer"
                    >
                      <option value="">Select target…</option>
                      {branches.filter((b) => b.name !== branch.name).map((b) => (
                        <option key={b.id} value={b.name}>{b.name}</option>
                      ))}
                    </select>
                    <Button
                      variant="primary" size="sm"
                      disabled={!mergeTarget}
                      onClick={() => handleMerge(branch.name, mergeTarget)}
                    >
                      Merge
                    </Button>
                    <button
                      onClick={() => setMerging(null)}
                      className="p-1 rounded text-text-tertiary hover:text-text-primary transition-colors cursor-pointer text-xs"
                    >
                      ✕
                    </button>
                  </div>
                )}
                </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Saved tabs section */}
        <div>
          <div className="flex items-center justify-between px-1 mb-2">
            <h3 className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
              Saved Tabs ({stashEntries.length})
            </h3>
            <div className="flex gap-1">
              <Button variant="secondary" size="sm" onClick={handleStash} id="stash-push-btn">
                Save Aside
              </Button>
              <Button
                variant="primary" size="sm"
                onClick={handlePop}
                disabled={stashEntries.length === 0}
                id="stash-pop-btn"
              >
                Restore
              </Button>
            </div>
          </div>
          {stashEntries.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center py-4">No saved tabs yet</p>
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
                      {entry.tabs.length} tabs saved
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
