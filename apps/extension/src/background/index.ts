/* ============================================================
   BACKGROUND SERVICE WORKER — Message broker & alarm scheduler
   ============================================================ */

import { createMessageRouter, MSG } from '@/shared/messaging';
import { pruneOldRecords, getAllWorkspaces, getActiveBranchForWindow, saveWorkspace, saveSnippet, getSnippetsByBranch, getAllSnippets, deleteSnippet } from '@/infrastructure/db/database';
import type { SnippetEntity } from '@/core/entities/SnippetEntity';
import { makeSnippetId } from '@/core/entities/SnippetEntity';
import * as branchOps from '@/core/use-cases/manageBranches';
import * as stashOps from '@/core/use-cases/stashMemory';
import { processExtractedChunks } from '@/core/use-cases/pageIndexer';
import { searchPages, getIndexCount, pruneOldPages, indexChunk, reassignChunksBranch } from '@/infrastructure/search/searchIndex';
import { makeChunkId } from '@/core/entities/ChunkDocument';
import { shouldBlock } from '@/core/use-cases/intentBlocker';
import { recordPageVisit, recordNavigation, getGraphData } from '@/core/use-cases/graphBuilder';
import { classifyPage } from '@/core/entities/PageDocument';
import { fromChromeTab, toSnapshot } from '@/core/entities/Tab';
import type { ProjectContext } from '@/core/entities/ProjectContext';
import { initEmbedding, onStatusChange, onProgress, getStatus, type AiModelStatus } from '@/infrastructure/ai/embeddingService';

// ---- Utility Helpers ----

/** Simple FNV-1a-like hash for URL keys in chrome.storage */
function hashUrl(url: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** Prefix → Chrome Tab Group color mapping */
const PREFIX_COLOR_MAP: Record<string, chrome.tabGroups.ColorEnum> = {
  'space/': 'yellow',
  'feat/': 'blue',
  'work/': 'cyan',
  'research/': 'green',
  'project/': 'purple',
  'personal/': 'orange',
  'temp/': 'grey',
};

/** Map a branch name to a Tab Group color based on its prefix */
function getBranchColor(name: string): chrome.tabGroups.ColorEnum {
  for (const [prefix, color] of Object.entries(PREFIX_COLOR_MAP)) {
    if (name.startsWith(prefix)) return color;
  }
  return 'grey';
}

/**
 * Sync Chrome Tab Groups for a window after branch operations.
 * Groups all tabs in the window under a labeled, color-coded group.
 */
async function syncTabGroup(windowId: number, branchName: string): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ windowId });

    // Check if a group with this branch name already exists
    const existingGroupId = await findGroupIdForBranch(windowId, branchName);

    // Only group tabs that are ungrouped OR already in this branch's group.
    // NEVER steal tabs from other groups.
    const tabIds = tabs
      .filter(t => {
        if (t.id == null) return false;
        if (t.groupId == null || t.groupId === -1) return true; // ungrouped → include
        if (existingGroupId !== -1 && t.groupId === existingGroupId) return true; // already ours
        return false; // belongs to another group → skip
      })
      .map(t => t.id!);

    if (tabIds.length === 0) return;

    if (existingGroupId !== -1) {
      // Group already exists — add ungrouped tabs to it
      await chrome.tabs.group({ tabIds, groupId: existingGroupId });
    } else {
      // Create a new group with ungrouped tabs
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, {
        title: branchName,
        color: getBranchColor(branchName),
        collapsed: false,
      });
    }
  } catch (err) {
    console.warn('[Neuro-Nav] Tab Group sync failed:', err);
  }
}

// ---- Auto-Reconcile Existing Chrome Tab Groups → Branches ----
// Runs on Service Worker startup. Scans all windows for tab groups and
// syncs or creates branches so existing groups are automatically tracked.

async function reconcileExistingTabGroups(): Promise<void> {
  try {
    const allWindows = await chrome.windows.getAll();
    const existingBranches = await branchOps.listBranches();
    const branchNameSet = new Set(existingBranches.map(b => b.name));

    for (const win of allWindows) {
      if (!win.id || win.type !== 'normal') continue;

      let groups: chrome.tabGroups.TabGroup[];
      try {
        groups = await chrome.tabGroups.query({ windowId: win.id });
      } catch { continue; }

      if (groups.length === 0) continue;

      const allTabs = await chrome.tabs.query({ windowId: win.id });

      for (const group of groups) {
        if (!group.title) continue; // skip unnamed groups

        // Get only tabs belonging to this specific group
        const groupTabs = allTabs
          .filter(t => t.groupId === group.id)
          .map(fromChromeTab)
          .map(toSnapshot);

        if (groupTabs.length === 0) continue;

        if (branchNameSet.has(group.title)) {
          // Branch exists → merge new tabs (deduplicate by URL)
          const branch = existingBranches.find(b => b.name === group.title)!;
          const existingUrls = new Set(branch.tabs.map(t => t.url));
          const newTabs = groupTabs.filter(t => !existingUrls.has(t.url));

          if (newTabs.length > 0) {
            branch.tabs = [...branch.tabs, ...newTabs];
            branch.updatedAt = Date.now();
          }

          // Ensure window is marked active
          if (!branch.activeInWindows) branch.activeInWindows = [];
          if (!branch.activeInWindows.includes(win.id)) {
            branch.activeInWindows.push(win.id);
          }
          branch.isActive = true;
          await branchOps.updateBranch(branch);

          console.log(`[Neuro-Nav] Reconciled group "${group.title}" → existing branch (${newTabs.length} new tabs)`);
        } else {
          // No matching branch → create one from the group's tabs
          try {
            const newBranch = await branchOps.createNewBranch(group.title, groupTabs, true, win.id);
            branchNameSet.add(newBranch.name);
            existingBranches.push(newBranch);
            console.log(`[Neuro-Nav] Created branch "${group.title}" from existing tab group (${groupTabs.length} tabs)`);
          } catch (err) {
            console.warn(`[Neuro-Nav] Could not create branch from group "${group.title}":`, err);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Neuro-Nav] Tab group reconciliation failed:', err);
  }
}

// Run reconciliation on Service Worker startup
reconcileExistingTabGroups();

/**
 * Send a command to the CLI daemon via WebSocket and await a response.
 * Returns null if daemon is not connected or timeout.
 * Note: cliSocket is declared later in this file — forward ref works at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendCliCommand(type: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => {
    if (!cliSocket || cliSocket.readyState !== WebSocket.OPEN) {
      resolve(null);
      return;
    }
    const requestId = crypto.randomUUID();
    const timeout = setTimeout(() => resolve(null), 5000);

    const handler = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.requestId === requestId) {
          clearTimeout(timeout);
          cliSocket!.removeEventListener('message', handler);
          resolve(msg.payload ?? msg);
        }
      } catch { /* ignore parse errors */ }
    };
    cliSocket.addEventListener('message', handler);
    cliSocket.send(JSON.stringify({ source: 'extension', type, payload, requestId }));
  });
}

// ---- Message Router ----

const router = createMessageRouter({
  [MSG.PING]: async () => {
    return { success: true, data: 'pong' };
  },

  [MSG.TABS_GET_ALL]: async () => {
    const tabs = await chrome.tabs.query({});
    return { success: true, data: tabs };
  },

  [MSG.TAB_CLOSE]: async (payload) => {
    const { tabId } = payload as { tabId: number };
    await chrome.tabs.remove(tabId);
    return { success: true };
  },

  [MSG.TAB_ACTIVATE]: async (payload) => {
    const { tabId, windowId } = payload as { tabId: number; windowId: number };
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    return { success: true };
  },

  [MSG.WORKSPACE_LIST]: async () => {
    const workspaces = await getAllWorkspaces();
    return { success: true, data: workspaces };
  },

  [MSG.PRUNE_TRIGGER]: async () => {
    const deleted = await pruneOldRecords(30);
    return { success: true, data: { deleted } };
  },

  // ---- Branch handlers (Phase 2) ----

  [MSG.BRANCH_LIST]: async () => {
    const branches = await branchOps.listBranches();
    return { success: true, data: branches };
  },

  [MSG.BRANCH_CREATE]: async (payload) => {
    const { name, windowId } = payload as { name: string; windowId?: number };
    const wid = windowId ?? (await chrome.windows.getCurrent()).id!;
    const currentTabs = (await chrome.tabs.query({ windowId: wid }))
      .map(fromChromeTab).map(toSnapshot);
    const branch = await branchOps.createNewBranch(name, currentTabs, true, wid);
    // Sync tab group after creating branch
    syncTabGroup(wid, name).catch(() => {});
    return { success: true, data: branch };
  },

  [MSG.BRANCH_CHECKOUT]: async (payload) => {
    const { name, windowId } = payload as { name: string; windowId?: number };
    const wid = windowId ?? (await chrome.windows.getCurrent()).id!;

    // ── 1. Save old branch's tabs (scoped to its group) ──
    const oldBranch = await branchOps.getActiveBranchForWindow(wid);
    const oldGroupId = oldBranch ? await findGroupIdForBranch(wid, oldBranch.name) : -1;

    const allWindowTabs = await chrome.tabs.query({ windowId: wid });
    const currentTabs = oldGroupId !== -1
      ? allWindowTabs.filter(t => t.groupId === oldGroupId).map(fromChromeTab).map(toSnapshot)
      : allWindowTabs.filter(t => t.groupId == null || t.groupId === -1).map(fromChromeTab).map(toSnapshot);

    const result = await branchOps.checkoutBranch(name, currentTabs, wid);

    // ── 2. Expand or create new branch's group FIRST (keep window alive) ──
    const newGroupId = await findGroupIdForBranch(wid, name);

    if (newGroupId !== -1) {
      // Group already exists (collapsed) — expand it and focus
      await chrome.tabGroups.update(newGroupId, { collapsed: false });
      const groupTabs = await chrome.tabs.query({ windowId: wid, groupId: newGroupId });
      if (groupTabs.length > 0 && groupTabs[0].id) {
        await chrome.tabs.update(groupTabs[0].id, { active: true });
      }
    } else {
      // Group doesn't exist — create tabs from saved data
      if (result.tabsToOpen.length > 0) {
        for (const tab of result.tabsToOpen) {
          await chrome.tabs.create({ windowId: wid, url: tab.url, pinned: tab.pinned });
        }
      } else {
        await chrome.tabs.create({ windowId: wid });
      }
      await syncTabGroup(wid, name);
    }

    // ── 3. Collapse old branch's group + hibernate tabs (free RAM) ──
    // Chrome Extension API has no "Close Group" equivalent (which hides + saves).
    // Collapse is the safe alternative: group stays on tab bar but minimized.
    if (oldGroupId !== -1) {
      try {
        await chrome.tabGroups.update(oldGroupId, { collapsed: true });
        // Discard (hibernate) all tabs in collapsed group to free RAM
        const oldTabs = allWindowTabs.filter(t => t.groupId === oldGroupId);
        for (const tab of oldTabs) {
          if (tab.id && !tab.discarded) {
            try { await chrome.tabs.discard(tab.id); } catch { /* active/pinned tabs can't be discarded */ }
          }
        }
      } catch { /* group may have been closed manually by user */ }
    }

    return { success: true, data: result.branch };
  },

  [MSG.BRANCH_CHECKOUT_NEW_WINDOW]: async (payload) => {
    const { name } = payload as { name: string };
    // Get the branch to read its saved tabs
    const branches = await branchOps.listBranches();
    const branch = branches.find((b) => b.name === name);
    if (!branch) return { success: false, error: `Branch "${name}" not found` };

    // Open a fresh window with the branch's tabs (or just new-tab if empty)
    const urls = branch.tabs.map((t) => t.url).filter(Boolean);
    const newWindow = await chrome.windows.create({
      url: urls.length > 0 ? urls : ['chrome://newtab'],
      focused: true,
    });
    const wid = newWindow.id!;

    // Activate the branch in the new window
    await branchOps.checkoutBranch(name, [], wid);
    syncTabGroup(wid, name).catch(() => {});

    return { success: true, data: branch };
  },

  [MSG.BRANCH_DELETE]: async (payload) => {
    const { id } = payload as { id: string };
    await branchOps.deleteBranchById(id);
    return { success: true };
  },

  [MSG.BRANCH_MERGE]: async (payload) => {
    const { source, target, deleteSource } = payload as {
      source: string; target: string; deleteSource?: boolean;
    };

    // 1. Merge branch tabs
    const merged = await branchOps.mergeBranch(source, target, deleteSource);

    // 2. Reassign search index chunks from source → target
    const chunksReassigned = await reassignChunksBranch(source, target);

    // 3. Reassign snippets from source → target
    const sourceSnippets = await getSnippetsByBranch(source);
    for (const snip of sourceSnippets) {
      snip.branch = target;
      await saveSnippet(snip);
    }

    console.log(
      `[Neuro-Nav] Merged "${source}" → "${target}": ` +
      `${merged.tabs.length} tabs, ${chunksReassigned} chunks, ${sourceSnippets.length} snippets`
    );

    return { success: true, data: merged };
  },

  [MSG.GET_WINDOW_BRANCH]: async (payload) => {
    const { windowId } = payload as { windowId: number };
    const branch = await branchOps.getActiveBranchForWindow(windowId);
    return { success: true, data: branch ? { name: branch.name, id: branch.id } : null };
  },

  // ---- Stash handlers (Phase 2) ----

  [MSG.STASH_PUSH]: async () => {
    const currentTabs = (await chrome.tabs.query({ currentWindow: true }))
      .map(fromChromeTab).map(toSnapshot);
    await stashOps.stashTabs(currentTabs);
    return { success: true };
  },

  [MSG.STASH_POP]: async () => {
    const entry = await stashOps.popStash();
    if (!entry) return { success: false, error: 'Stash is empty' };

    const currentWindow = await chrome.windows.getCurrent();
    for (const tab of entry.tabs) {
      await chrome.tabs.create({ windowId: currentWindow.id, url: tab.url, pinned: tab.pinned });
    }
    return { success: true, data: entry };
  },

  [MSG.STASH_LIST]: async () => {
    const entries = await stashOps.listStash();
    return { success: true, data: entries };
  },

  // ---- Search & indexing handlers (Phase 3) ----

  [MSG.SEARCH_PAGES]: async (payload, sender) => {
    const { query, limit } = payload as { query: string; limit?: number };
    // Resolve the active branch for the requesting window
    const windowId = sender.tab?.windowId ?? (await chrome.windows.getLastFocused()).id!;
    const branch = await getActiveBranchForWindow(windowId);
    const branchName = branch?.name ?? 'default';
    const results = await searchPages(query, limit, branchName);
    return { success: true, data: results };
  },

  [MSG.INDEX_STATUS]: async () => {
    const count = await getIndexCount();
    return { success: true, data: { count } };
  },

  // ---- Graph handler (Phase 4) ----

  [MSG.GRAPH_DATA]: async (_payload, sender) => {
    const windowId = sender.tab?.windowId ?? (await chrome.windows.getLastFocused()).id!;
    const branch = await branchOps.getActiveBranchForWindow(windowId);
    const branchName = branch?.name ?? 'default';
    const data = await getGraphData(branchName);
    return { success: true, data };
  },

  // ---- Reading Progress handlers (v1.5) ----

  [MSG.READING_PROGRESS]: async (payload) => {
    const { url, percent } = payload as { url: string; percent: number };
    const key = `rp_${hashUrl(url)}`;
    await chrome.storage.local.set({ [key]: { url, percent, updatedAt: Date.now() } });
    return { success: true };
  },

  [MSG.GET_READING_PROGRESS]: async (payload) => {
    const { urls } = payload as { urls: string[] };
    const keys = urls.map((u) => `rp_${hashUrl(u)}`);
    const result = await chrome.storage.local.get(keys);
    const progress: Record<string, number> = {};
    for (const u of urls) {
      const key = `rp_${hashUrl(u)}`;
      if (result[key]) progress[u] = result[key].percent;
    }
    return { success: true, data: progress };
  },

  // ---- Snippet handlers (v1.5) ----

  [MSG.SNIPPET_SAVE]: async (payload) => {
    const { text, url, title, branch, note } = payload as {
      text: string; url: string; title: string; branch: string; note?: string;
    };
    const snippet: SnippetEntity = {
      id: makeSnippetId(),
      text,
      url,
      title,
      branch,
      note: note ?? '',
      createdAt: Date.now(),
    };
    await saveSnippet(snippet);
    return { success: true, data: snippet };
  },

  [MSG.SNIPPET_LIST]: async (payload) => {
    const { branch } = (payload ?? {}) as { branch?: string };
    const snippets = branch ? await getSnippetsByBranch(branch) : await getAllSnippets();
    return { success: true, data: snippets };
  },

  [MSG.SNIPPET_DELETE]: async (payload) => {
    const { id } = payload as { id: string };
    await deleteSnippet(id);
    return { success: true };
  },

  // ---- Session Summary handlers (v2.0) ----

  [MSG.SESSION_SUMMARY_GENERATE]: async (payload) => {
    const { branchName } = payload as { branchName: string };
    // Get recent indexed pages for this branch
    const results = await searchPages('', 10, branchName);
    const pageTexts = results.map((r) =>
      `- ${r.title}: ${r.chunkText.slice(0, 120)}`
    ).join('\n');

    let summary: string;
    if (cliSocket && cliSocket.readyState === WebSocket.OPEN) {
      // Try LLM via daemon
      try {
        const resp = await sendCliCommand('SUMMARIZE', { text: pageTexts, branchName });
        summary = resp?.summary ?? pageTexts;
      } catch {
        summary = pageTexts || 'No pages indexed in this session yet.';
      }
    } else {
      // Extractive fallback
      summary = pageTexts || 'No pages indexed in this session yet.';
    }

    // Save to branch metadata
    const branch = (await branchOps.listBranches()).find(b => b.name === branchName);
    if (branch) {
      branch.lastSummary = { text: summary, generatedAt: Date.now() };
      await branchOps.updateBranch(branch);
    }

    return { success: true, data: { summary } };
  },

  [MSG.SESSION_SUMMARY_GET]: async (payload) => {
    const { branchName } = payload as { branchName: string };
    const branch = (await branchOps.listBranches()).find(b => b.name === branchName);
    return { success: true, data: branch?.lastSummary ?? null };
  },
});

chrome.runtime.onMessage.addListener(router);

// ---- Content Script Listener (raw messages, not routed) ----

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_CONTENT_EXTRACTED') {
    // Resolve branch from the sender tab's group, then window
    const tab = sender.tab;
    const resolveBranch = async (): Promise<string> => {
      // RULE 3: Strict group isolation — only use tab's own group.
      // Never fall back to window-level active branch.
      if (tab?.groupId != null && tab.groupId !== -1) {
        try {
          const group = await chrome.tabGroups.get(tab.groupId);
          if (group.title) return group.title;
        } catch { /* group removed */ }
      }
      return 'default';
    };

    resolveBranch()
      .then((branchName) => {
        return processExtractedChunks(message.payload, branchName);
      })
      .then((count) => {
        console.log(`[Neuro-Nav] Indexed ${count} chunks from: ${message.payload.title}`);
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('[Neuro-Nav] Chunk indexing failed:', err);
        sendResponse({ success: false });
      });
    return true; // keep channel open
  }

  // ---- Tab Group sync (called from popup) ----

  if (message.type === 'SYNC_TAB_GROUP') {
    const { windowId: wid, branchName } = message.payload as { windowId: number; branchName: string };
    syncTabGroup(wid, branchName)
      .then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }

  // Toggle collapse/expand a branch's Chrome tab group
  if (message.type === 'COLLAPSE_TAB_GROUP') {
    const { windowId: wid, branchName } = message.payload as { windowId: number; branchName: string };
    (async () => {
      try {
        const groupId = await findGroupIdForBranch(wid, branchName);
        if (groupId === -1) { sendResponse({ success: false }); return; }
        const group = await chrome.tabGroups.get(groupId);
        await chrome.tabGroups.update(groupId, { collapsed: !group.collapsed });
        sendResponse({ success: true, collapsed: !group.collapsed });
      } catch {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  if (message.type === 'UNGROUP_TABS') {
    const { windowId: wid } = message.payload as { windowId: number };
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ windowId: wid });
        const groupedTabIds = tabs
          .filter(t => t.groupId != null && t.groupId !== -1 && t.id != null)
          .map(t => t.id!);
        if (groupedTabIds.length > 0) {
          await chrome.tabs.ungroup(groupedTabIds);
        }
        sendResponse({ success: true });
      } catch {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  // Close all tabs in a branch's Chrome tab group (= Chrome's "Đóng nhóm")
  if (message.type === 'CLOSE_TAB_GROUP') {
    const { windowId: wid, branchName } = message.payload as { windowId: number; branchName: string };
    (async () => {
      try {
        const groupId = await findGroupIdForBranch(wid, branchName);
        if (groupId === -1) { sendResponse({ success: false }); return; }

        const groupTabs = await chrome.tabs.query({ groupId });
        const tabIds = groupTabs.map(t => t.id).filter((id): id is number => id != null);

        if (tabIds.length > 0) {
          await chrome.tabs.remove(tabIds);
        }
        console.log(`[Neuro-Nav] Closed group "${branchName}" (${tabIds.length} tabs)`);
        sendResponse({ success: true });
      } catch {
        sendResponse({ success: false });
      }
    })();
    return true;
  }

  return false;
});

// ---- Intent Blocker (Phase 3) ----

chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only block main frame navigations
  if (details.frameId !== 0) return;

  try {
    // Get the window this tab belongs to for window-scoped branch lookup
    const tab = await chrome.tabs.get(details.tabId).catch(() => null);
    if (!tab?.windowId) return;
    const activeBranch = await getActiveBranchForWindow(tab.windowId);
    if (!activeBranch) return;

    // Get page title for better classification
    const title = tab?.title ?? '';
    const result = shouldBlock(details.url, title, activeBranch.name);
    if (result.blocked) {
      // Inject a warning popup overlay on the page (no redirect)
      const reason = result.reason;
      chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        func: (msg: string) => {
          // Don't inject twice
          if (document.getElementById('neuro-nav-block-overlay')) return;

          const overlay = document.createElement('div');
          overlay.id = 'neuro-nav-block-overlay';
          overlay.innerHTML = `
            <div style="
              position:fixed;top:20px;right:20px;z-index:2147483647;
              max-width:360px;padding:16px 20px;
              background:linear-gradient(135deg,rgba(15,17,25,0.95),rgba(25,27,40,0.95));
              border:1px solid rgba(139,92,246,0.3);border-radius:12px;
              box-shadow:0 8px 32px rgba(0,0,0,0.5),0 0 0 1px rgba(139,92,246,0.1);
              backdrop-filter:blur(16px);font-family:system-ui,-apple-system,sans-serif;
              color:#e2e8f0;animation:nnSlideIn .3s ease-out;
            ">
              <style>
                @keyframes nnSlideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
                @keyframes nnFadeOut{to{opacity:0;transform:translateY(-12px)}}
              </style>
              <div style="display:flex;align-items:flex-start;gap:10px">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#facc15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;margin-bottom:4px;color:#c4b5fd">Neuro-Nav</div>
                  <div style="font-size:12px;line-height:1.4;color:#cbd5e1">${msg}</div>
                </div>
                <button id="neuro-nav-dismiss" style="
                  background:none;border:none;color:#94a3b8;cursor:pointer;
                  font-size:16px;padding:0 0 0 4px;line-height:1;flex-shrink:0;
                ">✕</button>
              </div>
            </div>
          `;
          document.documentElement.appendChild(overlay);

          // Auto-dismiss after 6 seconds
          const autoDismiss = setTimeout(() => {
            overlay.querySelector('div')!.style.animation = 'nnFadeOut .25s ease-in forwards';
            setTimeout(() => overlay.remove(), 250);
          }, 6000);

          // Manual dismiss
          document.getElementById('neuro-nav-dismiss')!.onclick = () => {
            clearTimeout(autoDismiss);
            overlay.querySelector('div')!.style.animation = 'nnFadeOut .25s ease-in forwards';
            setTimeout(() => overlay.remove(), 250);
          };
        },
        args: [reason],
      }).catch(() => { /* tab may not be ready */ });
      console.log(`[Neuro-Nav] Warning shown: ${details.url} — ${reason}`);
    }
  } catch (err) {
    console.error('[Neuro-Nav] Intent blocker error:', err);
  }
});

// ---- Keyboard Command: Close Active Tab Group (Alt+Shift+W) ----

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'close-active-group') return;

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id || activeTab.groupId == null || activeTab.groupId === -1) return;

    const groupId = activeTab.groupId;

    // Find all tabs in this group
    const groupTabs = await chrome.tabs.query({ groupId });
    const tabIds = groupTabs.map(t => t.id).filter((id): id is number => id != null);

    if (tabIds.length === 0) return;

    // Close all tabs in the group
    await chrome.tabs.remove(tabIds);
    console.log(`[Neuro-Nav] Closed group (${tabIds.length} tabs) via Alt+Shift+W`);
  } catch (err) {
    console.error('[Neuro-Nav] Close active group failed:', err);
  }
});

// ---- Auto-Pruning Alarm ----

const PRUNE_ALARM = 'neuro-nav-prune';

chrome.alarms.create(PRUNE_ALARM, {
  periodInMinutes: 24 * 60, // Every 24 hours
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === PRUNE_ALARM) {
    try {
      const deletedHist = await pruneOldRecords(30);
      const deletedPages = await pruneOldPages(30);
      console.log(`[Neuro-Nav] Pruned ${deletedHist} history records and ${deletedPages} extracted pages`);
    } catch (err) {
      console.error('[Neuro-Nav] Pruning failed:', err);
    }
  }
});

// ---- Navigation Tracking (Phase 4 — Graph) ----

/** Track the last URL per tab to detect transitions. */
const lastTabUrl = new Map<number, string>();

chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only track main frame
  if (details.frameId !== 0) return;
  if (!details.url.startsWith('http')) return;

  const tabId = details.tabId;
  const previousUrl = lastTabUrl.get(tabId);
  lastTabUrl.set(tabId, details.url);

  try {
    // Get tab info for title and favicon
    const tab = await chrome.tabs.get(tabId);
    const title = tab.title ?? '';
    const favicon = tab.favIconUrl ?? '';
    const category = classifyPage(details.url, title);

    // Record as a graph node — resolve branch STRICTLY from tab's group.
    // RULE 3: History must never cross group boundaries.
    // If tab is not in a group, record under 'default' — do NOT fall back
    // to window-level active branch (that would pollute other sessions).
    let branchName = 'default';
    if (tab.groupId != null && tab.groupId !== -1) {
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (group.title) branchName = group.title;
      } catch { /* group may have been removed */ }
    }
    await recordPageVisit(details.url, title, favicon, category, branchName);

    // Record transition edge
    if (previousUrl && previousUrl !== details.url) {
      await recordNavigation(previousUrl, details.url);
    }
  } catch (err) {
    // Tab may have closed — ignore
  }
});

// Clean up tracking when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  lastTabUrl.delete(tabId);
});

// ---- Window Garbage Collection (Multi-Window State) ----

chrome.windows.onRemoved.addListener(async (windowId) => {
  try {
    await branchOps.detachWindowFromBranch(windowId);
  } catch (err) {
    console.error('[Neuro-Nav] Window GC failed:', err);
  }
});

// ---- Real-time Tab ↔ Branch Sync ----
// Re-snapshots the active branch's tabs whenever tabs change in a window.
// Uses per-window debounce (500ms) to batch rapid changes into one DB write.
// IMPORTANT: Only syncs tabs in the branch's OWN tab group to prevent
// overwriting when multiple branches coexist in the same window.

const syncTimers = new Map<number, ReturnType<typeof setTimeout>>();

// ---- Close Group Protection ----
// Tracks group IDs currently being closed by Chrome's "Close Group" action.
// When a group is closed, Chrome fires a burst of onRemoved events for all tabs.
// Without this flag, auto-save would overwrite the branch's saved tabs with [].
const groupsBeingClosed = new Set<number>();

/**
 * Find the Chrome Tab Group ID that matches a branch name in a window.
 * Returns -1 if no matching group is found.
 */
async function findGroupIdForBranch(windowId: number, branchName: string): Promise<number> {
  try {
    const groups = await chrome.tabGroups.query({ windowId });
    const match = groups.find(g => g.title === branchName);
    return match?.id ?? -1;
  } catch {
    return -1;
  }
}

function debouncedSyncBranchTabs(windowId: number) {
  const existing = syncTimers.get(windowId);
  if (existing) clearTimeout(existing);

  syncTimers.set(windowId, setTimeout(async () => {
    syncTimers.delete(windowId);
    try {
      const activeBranch = await branchOps.getActiveBranchForWindow(windowId);
      if (!activeBranch) return;

      const allTabs = await chrome.tabs.query({ windowId });

      // Find the tab group matching this branch
      const groupId = await findGroupIdForBranch(windowId, activeBranch.name);

      // STRICT ISOLATION: Only sync tabs that belong to this branch's group.
      // If no Chrome group exists for this branch, sync only ungrouped tabs
      // (groupId === -1) — NEVER steal tabs from other groups.
      const branchTabs = groupId !== -1
        ? allTabs.filter(t => t.groupId === groupId)
        : allTabs.filter(t => t.groupId == null || t.groupId === -1);

      const snapshots = branchTabs.map(fromChromeTab).map(toSnapshot);
      const updated = await branchOps.syncBranchTabs(windowId, snapshots);
      if (updated) {
        console.log(`[Neuro-Nav] Synced ${snapshots.length} tabs → branch "${updated.name}"`);
      }
    } catch {
      // Window may have closed between debounce — safe to ignore
    }
  }, 500));
}

// ---- Close Group Listener ----
// Detect when Chrome closes a tab group ("Đóng nhóm") and protect saved data.
chrome.tabGroups.onRemoved.addListener(async (tabGroup) => {
  groupsBeingClosed.add(tabGroup.id);
  const branchName = tabGroup.title;

  if (branchName) {
    console.log(`[Neuro-Nav] Group "${branchName}" closed (hidden). Preserving saved tabs...`);
    // Deactivate the branch but NEVER overwrite its tabs array
    try {
      const branch = (await branchOps.listBranches()).find(b => b.name === branchName);
      if (branch) {
        branch.activeInWindows = [];
        branch.isActive = false;
        branch.updatedAt = Date.now();
        await branchOps.updateBranch(branch);
      }
    } catch { /* branch may not exist */ }
  }

  // Clear the flag after 2s (enough time for the onRemoved burst to finish)
  setTimeout(() => groupsBeingClosed.delete(tabGroup.id), 2000);
});

// Tab closed — with Close Group protection
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return; // window GC handles this

  // Check if this tab belonged to a group being closed.
  // chrome.tabs.onRemoved fires AFTER the tab is gone, so we can't query it.
  // However, the groupsBeingClosed set covers all active close-group operations.
  // If ANY group is being closed in this moment, skip auto-save to be safe.
  if (groupsBeingClosed.size > 0) {
    console.log(`[Neuro-Nav] Skipping auto-save: group close in progress`);
    return;
  }

  debouncedSyncBranchTabs(removeInfo.windowId);
});

// Tab created — auto-add to active branch's Chrome tab group.
// RULES:
//   1. New ungrouped tab → add to active branch's Chrome group (if exists)
//   2. Tab being restored/opened as part of another group → NEVER touch
//   3. Tab opened from a grouped tab (openerTabId in another group) → NEVER touch
//
// Strategy: wait 200ms for Chrome to finish its own grouping, then re-check.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.windowId || !tab.id) return;

  // Already in a group at creation time — just sync, don't move
  if (tab.groupId != null && tab.groupId !== -1) {
    debouncedSyncBranchTabs(tab.windowId);
    return;
  }

  const tabId = tab.id;
  const windowId = tab.windowId;

  // If opened from a tab in a DIFFERENT group, don't auto-group.
  // Chrome will assign it to the opener's group shortly.
  // But if opener is in the SAME group as active branch → proceed (Ctrl+T case).
  if (tab.openerTabId != null) {
    try {
      const openerTab = await chrome.tabs.get(tab.openerTabId);
      if (openerTab.groupId != null && openerTab.groupId !== -1) {
        const activeBranch = await branchOps.getActiveBranchForWindow(windowId);
        const activeGroupId = activeBranch
          ? await findGroupIdForBranch(windowId, activeBranch.name)
          : -1;

        if (openerTab.groupId !== activeGroupId) {
          // Opener is in a DIFFERENT group — let Chrome handle it
          debouncedSyncBranchTabs(windowId);
          return;
        }
        // Opener is in the SAME group as active branch — fall through to auto-group
      }
    } catch { /* opener may have closed */ }
  }

  // Wait briefly for Chrome to finish any pending group assignment
  // (e.g., restoring recently closed group, drag-to-group, etc.)
  await new Promise(r => setTimeout(r, 200));

  try {
    // Re-fetch — Chrome may have assigned a group during the wait
    const freshTab = await chrome.tabs.get(tabId);

    // Chrome assigned it to a group → don't interfere
    if (freshTab.groupId != null && freshTab.groupId !== -1) {
      debouncedSyncBranchTabs(windowId);
      return;
    }

    // Tab is genuinely new and ungrouped → add to active branch's group
    const activeBranch = await branchOps.getActiveBranchForWindow(windowId);
    if (!activeBranch) {
      debouncedSyncBranchTabs(windowId);
      return;
    }

    const groupId = await findGroupIdForBranch(windowId, activeBranch.name);
    if (groupId !== -1) {
      await chrome.tabs.group({ tabIds: [tabId], groupId });
    }
  } catch {
    // Tab may have been closed during the delay — safe to ignore
  }

  debouncedSyncBranchTabs(windowId);
});

// Tab navigated (URL change complete)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.windowId) {
    debouncedSyncBranchTabs(tab.windowId);
  }
});

// ---- Auto-Switch Branch on Tab Group Focus ----
// When user clicks a tab belonging to a different tab group (branch),
// automatically switch the active branch for that window.

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (!tab.windowId) return;

    const groupId = tab.groupId;
    // Tab not in any group — nothing to switch
    if (groupId == null || groupId === -1) return;

    // Get the group's title (which is the branch name)
    const group = await chrome.tabGroups.get(groupId);
    if (!group.title) return;

    const groupBranchName = group.title;

    // Check if this is already the active branch for this window
    const currentActive = await branchOps.getActiveBranchForWindow(tab.windowId);
    if (currentActive?.name === groupBranchName) return;

    // Check if a branch with this name exists
    const branches = await branchOps.listBranches();
    const targetBranch = branches.find(b => b.name === groupBranchName);
    if (!targetBranch) return;

    // Save current branch's tabs (scoped to its own group) before switching
    if (currentActive) {
      const currentGroupId = await findGroupIdForBranch(tab.windowId, currentActive.name);
      if (currentGroupId !== -1) {
        const currentGroupTabs = await chrome.tabs.query({ windowId: tab.windowId });
        const filteredTabs = currentGroupTabs
          .filter(t => t.groupId === currentGroupId)
          .map(fromChromeTab).map(toSnapshot);
        currentActive.tabs = filteredTabs;
        currentActive.activeInWindows = (currentActive.activeInWindows ?? [])
          .filter(id => id !== tab.windowId);
        currentActive.isActive = currentActive.activeInWindows.length > 0;
        currentActive.updatedAt = Date.now();
        await branchOps.updateBranch(currentActive);
      }
    }

    // Activate the target branch for this window
    if (!targetBranch.activeInWindows) targetBranch.activeInWindows = [];
    if (!targetBranch.activeInWindows.includes(tab.windowId)) {
      targetBranch.activeInWindows.push(tab.windowId);
    }
    targetBranch.isActive = true;
    targetBranch.updatedAt = Date.now();
    await branchOps.updateBranch(targetBranch);

    console.log(`[Neuro-Nav] Auto-switched active branch → "${groupBranchName}" (window ${tab.windowId})`);
  } catch (err) {
    // Silently ignore — tab may have been removed mid-flight
  }
});

// ---- Project Context Handler (Phase 3 — Local Symbiosis) ----

const PROJECT_WORKSPACE_ID = 'auto-project-workspace';

async function handleProjectContextUpdate(ctx: ProjectContext): Promise<void> {
  if (!ctx || !ctx.techStack) return;

  console.log(`[Neuro-Nav] Project context received: ${ctx.projectName} (${ctx.techStack.length} techs)`);

  // 1. Save to chrome.storage.local for popup to read
  await chrome.storage.local.set({ projectContext: ctx });

  // 2. Inject doc URLs into Orama search index as synthetic chunks
  //    Tag with the last-focused window's branch for context scoping
  const lastWindow = await chrome.windows.getLastFocused();
  const activeBranch = await getActiveBranchForWindow(lastWindow.id!);
  const branchTag = activeBranch?.name ?? 'default';

  for (const tech of ctx.techStack) {
    if (!tech.docUrl) continue;
    await indexChunk({
      id: makeChunkId(tech.docUrl, 0),
      url: tech.docUrl,
      title: `${tech.name} Documentation`,
      favicon: '',
      branch: branchTag,
      chunkText: `${tech.name} ${tech.category} documentation reference local project${tech.version ? ` v${tech.version}` : ''}`,
      chunkIndex: 0,
      category: 'docs',
      extractedAt: Date.now(),
    });
  }

  // 3. Create/update auto-workspace with doc tabs
  const docTabs = ctx.techStack
    .filter(t => t.docUrl)
    .map((t, i) => ({
      url: t.docUrl,
      title: `${t.name} Docs`,
      pinned: false,
      favIconUrl: '',
      index: i,
    }));

  if (docTabs.length > 0) {
    await saveWorkspace({
      id: PROJECT_WORKSPACE_ID,
      name: `📂 ${ctx.projectName}`,
      tabs: docTabs,
      tags: ['auto', 'project', ...(ctx.gitBranch ? [ctx.gitBranch] : [])],
      createdAt: ctx.scannedAt,
      updatedAt: ctx.scannedAt,
      color: 'hsl(152 68% 52%)',  // green for project
      icon: '📂',
    });
  }

  console.log(`[Neuro-Nav] Indexed ${ctx.techStack.length} doc URLs, workspace updated`);
}

// ---- CLI Bridge (WebSocket Client → nav-server) ----

const CLI_DEFAULT_URL = 'ws://127.0.0.1';
const CLI_DEFAULT_PORT = '9500';
const CLI_DEFAULT_TOKEN = 'neuro_nav_secure_token_2026';
const CLI_RECONNECT_BASE_MS = 5_000;
const CLI_RECONNECT_MAX_MS = 120_000; // 2 minutes max backoff
const NATIVE_HOST_NAME = 'com.neuronav.daemon';
let nativeStartAttempted = false;
let consecutiveFailures = 0;
let lastConnectAttempt = 0;

/** Handlers for CLI commands — reuses the same logic as the popup message router. */
const cliCommandHandlers: Record<string, (payload: unknown) => Promise<unknown>> = {
  PING: async () => ({ success: true, data: 'pong' }),
  TABS_GET_ALL: async () => {
    const tabs = await chrome.tabs.query({});
    return { success: true, data: tabs };
  },
  BRANCH_LIST: async () => {
    const branches = await branchOps.listBranches();
    return { success: true, data: branches };
  },
  BRANCH_CHECKOUT: async (payload) => {
    const { name } = payload as { name: string };
    const focusedWindow = await chrome.windows.getLastFocused({ populate: false });
    const wid = focusedWindow.id!;

    // ── 1. Save old branch's tabs (scoped to its group) ──
    const oldBranch = await branchOps.getActiveBranchForWindow(wid);
    const oldGroupId = oldBranch ? await findGroupIdForBranch(wid, oldBranch.name) : -1;

    const allWindowTabs = await chrome.tabs.query({ windowId: wid });
    const currentTabs = oldGroupId !== -1
      ? allWindowTabs.filter(t => t.groupId === oldGroupId).map(fromChromeTab).map(toSnapshot)
      : allWindowTabs.filter(t => t.groupId == null || t.groupId === -1).map(fromChromeTab).map(toSnapshot);
    const result = await branchOps.checkoutBranch(name, currentTabs, wid);

    // ── 2. Expand or create new branch's group FIRST ──
    const newGroupId = await findGroupIdForBranch(wid, name);

    if (newGroupId !== -1) {
      await chrome.tabGroups.update(newGroupId, { collapsed: false });
      const groupTabs = await chrome.tabs.query({ windowId: wid, groupId: newGroupId });
      if (groupTabs.length > 0 && groupTabs[0].id) {
        await chrome.tabs.update(groupTabs[0].id, { active: true });
      }
    } else {
      if (result.tabsToOpen.length > 0) {
        for (const tab of result.tabsToOpen) {
          await chrome.tabs.create({ windowId: wid, url: tab.url, pinned: tab.pinned });
        }
      } else {
        await chrome.tabs.create({ windowId: wid });
      }
      await syncTabGroup(wid, name);
    }

    // ── 3. Collapse old branch's group + hibernate tabs ──
    if (oldGroupId !== -1) {
      try {
        await chrome.tabGroups.update(oldGroupId, { collapsed: true });
        const oldTabs = allWindowTabs.filter(t => t.groupId === oldGroupId);
        for (const tab of oldTabs) {
          if (tab.id && !tab.discarded) {
            try { await chrome.tabs.discard(tab.id); } catch { /* can't discard */ }
          }
        }
      } catch { /* group may have been closed manually */ }
    }

    return { success: true, data: result.branch };
  },
  BRANCH_CHECKOUT_NEW_WINDOW: async (payload) => {
    const { name } = payload as { name: string };
    const branches = await branchOps.listBranches();
    const branch = branches.find((b) => b.name === name);
    if (!branch) return { success: false, error: `Branch "${name}" not found` };

    const urls = branch.tabs.map((t) => t.url).filter(Boolean);
    const newWindow = await chrome.windows.create({
      url: urls.length > 0 ? urls : ['chrome://newtab'],
      focused: true,
    });
    const wid = newWindow.id!;
    await branchOps.checkoutBranch(name, [], wid);
    return { success: true, data: branch };
  },
  BRANCH_CREATE: async (payload) => {
    const { name } = payload as { name: string };
    const focusedWindow = await chrome.windows.getLastFocused({ populate: false });
    const wid = focusedWindow.id!;
    const currentTabs = (await chrome.tabs.query({ windowId: wid }))
      .map(fromChromeTab).map(toSnapshot);
    const branch = await branchOps.createNewBranch(name, currentTabs, true, wid);
    return { success: true, data: branch };
  },
  BRANCH_DELETE: async (payload) => {
    const { id } = payload as { id: string };
    await branchOps.deleteBranchById(id);
    return { success: true };
  },
  BRANCH_MERGE: async (payload) => {
    const { source, target, deleteSource } = payload as {
      source: string; target: string; deleteSource?: boolean;
    };
    const merged = await branchOps.mergeBranch(source, target, deleteSource);
    const chunksReassigned = await reassignChunksBranch(source, target);
    const sourceSnippets = await getSnippetsByBranch(source);
    for (const snip of sourceSnippets) {
      snip.branch = target;
      await saveSnippet(snip);
    }
    return { success: true, data: merged, stats: { chunks: chunksReassigned, snippets: sourceSnippets.length } };
  },
  WORKSPACE_LIST: async () => {
    const workspaces = await getAllWorkspaces();
    return { success: true, data: workspaces };
  },
  STASH_PUSH: async () => {
    const currentTabs = (await chrome.tabs.query({ currentWindow: true }))
      .map(fromChromeTab).map(toSnapshot);
    await stashOps.stashTabs(currentTabs);
    return { success: true };
  },
  STASH_POP: async () => {
    const entry = await stashOps.popStash();
    if (!entry) return { success: false, error: 'Stash is empty' };
    const currentWindow = await chrome.windows.getCurrent();
    for (const tab of entry.tabs) {
      await chrome.tabs.create({ windowId: currentWindow.id, url: tab.url, pinned: tab.pinned });
    }
    return { success: true, data: entry };
  },
  STASH_LIST: async () => {
    const entries = await stashOps.listStash();
    return { success: true, data: entries };
  },
  SEARCH_PAGES: async (payload) => {
    const { query, limit } = payload as { query: string; limit?: number };
    const results = await searchPages(query, limit);
    return { success: true, data: results };
  },
  GRAPH_DATA: async () => {
    const lastWindow = await chrome.windows.getLastFocused({ populate: false });
    const branch = await branchOps.getActiveBranchForWindow(lastWindow.id!);
    const branchName = branch?.name ?? 'default';
    const data = await getGraphData(branchName);
    return { success: true, data };
  },
  SCAN_PROJECT: async (payload) => {
    // This is forwarded to daemon — daemon handles it directly via SCAN_PROJECT
    // Return error if daemon is not connected
    return { success: false, error: 'SCAN_PROJECT must be sent through daemon' };
  },
};

let cliSocket: WebSocket | null = null;
let cliReconnectTimer: ReturnType<typeof setTimeout> | null = null;

async function getSecretToken(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['navSecret'], (result) => {
      resolve(result.navSecret || CLI_DEFAULT_TOKEN);
    });
  });
}

async function getDaemonUrl(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['navDaemonUrl', 'navDaemonPort'], (result) => {
      const host = result.navDaemonUrl || CLI_DEFAULT_URL;
      const port = result.navDaemonPort || CLI_DEFAULT_PORT;
      resolve(`${host}:${port}`);
    });
  });
}

/** Compute backoff delay with exponential growth, capped at CLI_RECONNECT_MAX_MS. */
function getReconnectDelay(): number {
  const delay = Math.min(
    CLI_RECONNECT_BASE_MS * Math.pow(2, consecutiveFailures),
    CLI_RECONNECT_MAX_MS,
  );
  return delay;
}

async function connectToCLIServer() {
  // Don't reconnect if already connected or connecting
  if (cliSocket && (cliSocket.readyState === WebSocket.OPEN || cliSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  lastConnectAttempt = Date.now();
  const daemonUrl = await getDaemonUrl();

  // Probe with fetch first — fetch failures don't produce browser console errors,
  // unlike `new WebSocket()` which always logs ERR_CONNECTION_REFUSED.
  const httpUrl = daemonUrl.replace('ws://', 'http://').replace('wss://', 'https://');
  try {
    await fetch(httpUrl, { method: 'HEAD', signal: AbortSignal.timeout(2000) });
  } catch {
    // Server unreachable — skip WebSocket attempt to avoid browser error noise
    consecutiveFailures++;
    scheduleReconnect();
    return;
  }

  const token = await getSecretToken();

  try {
    cliSocket = new WebSocket(daemonUrl, [token]);
  } catch {
    consecutiveFailures++;
    scheduleReconnect();
    return;
  }

  cliSocket.onopen = () => {
    console.log('[Neuro-Nav] Connected to nav-server');
    consecutiveFailures = 0; // Reset backoff on success
    if (cliReconnectTimer) {
      clearTimeout(cliReconnectTimer);
      cliReconnectTimer = null;
    }
    // Identify as extension
    cliSocket!.send(JSON.stringify({ source: 'extension', type: 'IDENTIFY' }));
    // Notify popup about daemon state
    chrome.storage.local.set({ daemonConnected: true });
  };

  cliSocket.onmessage = async (event) => {
    let msg: { source?: string; type: string; payload?: unknown; requestId?: string };
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    } catch {
      return;
    }

    // Ignore server ack
    if (msg.type === 'CONNECTED') return;

    // Handle daemon push messages (not request-response)
    if (msg.type === 'PROJECT_CONTEXT_UPDATE') {
      await handleProjectContextUpdate(msg.payload as ProjectContext);
      return;
    }

    // Dispatch to handler
    const handler = cliCommandHandlers[msg.type];
    if (!handler) {
      cliSocket?.send(JSON.stringify({
        source: 'extension',
        type: 'RESPONSE',
        requestId: msg.requestId,
        success: false,
        error: `Unknown command: ${msg.type}`,
      }));
      return;
    }

    try {
      const result = await handler(msg.payload);
      cliSocket?.send(JSON.stringify({
        source: 'extension',
        type: 'RESPONSE',
        requestId: msg.requestId,
        ...result as object,
      }));
    } catch (err) {
      cliSocket?.send(JSON.stringify({
        source: 'extension',
        type: 'RESPONSE',
        requestId: msg.requestId,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  };

  cliSocket.onclose = () => {
    cliSocket = null;
    // Notify popup about daemon state
    chrome.storage.local.set({ daemonConnected: false });
    consecutiveFailures++;
    scheduleReconnect();
  };

  cliSocket.onerror = () => {
    // onclose will fire after onerror — reconnect handled there
    cliSocket?.close();
  };
}

/** Try to start the daemon via Chrome Native Messaging (one attempt per session). */
async function tryNativeStart(): Promise<boolean> {
  if (nativeStartAttempted) return false;
  nativeStartAttempted = true;

  return new Promise((resolve) => {
    try {
      const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
      let responded = false;

      port.onMessage.addListener((msg: { ok?: boolean }) => {
        responded = true;
        port.disconnect();
        if (msg.ok) {
          console.log('[Neuro-Nav] Daemon started via Native Messaging');
          resolve(true);
        } else {
          console.warn('[Neuro-Nav] Native host responded but daemon start failed');
          resolve(false);
        }
      });

      port.onDisconnect.addListener(() => {
        if (!responded) {
          const err = chrome.runtime.lastError?.message ?? '';
          // Common: host not installed — silently skip
          if (err.includes('not found') || err.includes('Specified native messaging host')) {
            console.log('[Neuro-Nav] Native Messaging host not installed — skipping auto-start');
          } else {
            console.warn('[Neuro-Nav] Native Messaging error:', err);
          }
          resolve(false);
        }
      });

      // Send start command
      port.postMessage({ type: 'START_DAEMON' });
    } catch {
      resolve(false);
    }
  });
}

function scheduleReconnect() {
  if (cliReconnectTimer) return;
  const delay = getReconnectDelay();
  cliReconnectTimer = setTimeout(async () => {
    cliReconnectTimer = null;
    // If first failure, try native start before reconnecting
    if (!nativeStartAttempted) {
      const started = await tryNativeStart();
      if (started) {
        // Give the daemon a moment to bind ports
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    connectToCLIServer();
  }, delay);
}

// ---- Service Worker Keepalive (MV3) ----
// Chrome kills idle Service Workers after ~30s. Use chrome.alarms to keep it alive
// while the WebSocket bridge is active.

const KEEPALIVE_ALARM = 'nav-cli-keepalive';

chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 }); // ~24 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM) {
    // Touch the WebSocket to keep the connection alive
    if (cliSocket && cliSocket.readyState === WebSocket.OPEN) {
      cliSocket.send(JSON.stringify({ source: 'extension', type: 'HEARTBEAT' }));
    } else if (!cliReconnectTimer) {
      // Only attempt reconnect if enough time has passed since last attempt
      const elapsed = Date.now() - lastConnectAttempt;
      const nextDelay = getReconnectDelay();
      if (elapsed >= nextDelay) {
        connectToCLIServer();
      }
    }
  }
});

// Start CLI bridge
connectToCLIServer();

// ---- Extension Install/Update ----

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Neuro-Nav] Extension installed — v1.5.0');
  } else if (details.reason === 'update') {
    console.log(`[Neuro-Nav] Updated from ${details.previousVersion}`);
  }

  // Register context menu for snippets (v1.5)
  chrome.contextMenus.create({
    id: 'neuro-nav-save-snippet',
    title: 'Save to Neuro-Nav',
    contexts: ['selection'],
  });
});

// ---- Context Menu Click Handler (Snippets v1.5) ----

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'neuro-nav-save-snippet') return;
  if (!info.selectionText || !tab) return;

  try {
    // RULE 3: Resolve branch from tab's own group, not window-level
    let branchName = 'default';
    if (tab.groupId != null && tab.groupId !== -1) {
      try {
        const group = await chrome.tabGroups.get(tab.groupId);
        if (group.title) branchName = group.title;
      } catch { /* group removed */ }
    }

    const snippet: SnippetEntity = {
      id: makeSnippetId(),
      text: info.selectionText,
      url: tab.url ?? '',
      title: tab.title ?? '',
      branch: branchName,
      note: '',
      createdAt: Date.now(),
    };
    await saveSnippet(snippet);
    console.log(`[Neuro-Nav] Snippet saved from ${tab.url} (branch: ${branchName})`);
  } catch (err) {
    console.error('[Neuro-Nav] Snippet save failed:', err);
  }
});

console.log('[Neuro-Nav] Service Worker initialized');

// ---- AI Embedding Pipeline (Phase 4) ----

// Broadcast AI model status & progress to popup
onStatusChange((status: AiModelStatus) => {
  chrome.storage.local.set({ aiModelStatus: status });
  chrome.runtime.sendMessage({ type: 'AI_STATUS_CHANGED', status }).catch(() => {});
});

onProgress((progress) => {
  chrome.runtime.sendMessage({
    type: 'AI_PROGRESS',
    file: progress.file,
    progress: Math.round(progress.progress),
  }).catch(() => {});
});

// Handle AI status queries from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_AI_STATUS') {
    sendResponse({ status: getStatus() });
    return false;
  }
  return false;
});

// Initialize the AI model eagerly on startup
initEmbedding();
