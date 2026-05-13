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
    const tabIds = tabs.map(t => t.id).filter((id): id is number => id != null);
    if (tabIds.length === 0) return;

    // Group all tabs
    const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });

    // Style the group
    await chrome.tabGroups.update(groupId, {
      title: branchName,
      color: getBranchColor(branchName),
      collapsed: false,
    });
  } catch (err) {
    console.warn('[Neuro-Nav] Tab Group sync failed:', err);
  }
}

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
    const currentTabs = (await chrome.tabs.query({ windowId: wid }))
      .map(fromChromeTab).map(toSnapshot);
    const result = await branchOps.checkoutBranch(name, currentTabs, wid);

    // Swap tabs in the target window
    const existingTabs = await chrome.tabs.query({ windowId: wid });

    for (const tab of result.tabsToOpen) {
      await chrome.tabs.create({ windowId: wid, url: tab.url, pinned: tab.pinned });
    }
    if (result.tabsToOpen.length > 0) {
      for (const tab of existingTabs) {
        if (tab.id) chrome.tabs.remove(tab.id);
      }
    }

    // Sync tab group after checkout
    syncTabGroup(wid, name).catch(() => {});

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
    // Resolve branch from the sender tab's window
    const windowId = sender.tab?.windowId;
    const branchPromise = windowId
      ? getActiveBranchForWindow(windowId)
      : Promise.resolve(null);

    branchPromise
      .then((branch) => {
        const branchName = branch?.name ?? 'default';
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

    // Record as a graph node
    const activeBranch = tab.windowId ? await branchOps.getActiveBranchForWindow(tab.windowId) : null;
    const branchName = activeBranch?.name ?? 'default';
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

const syncTimers = new Map<number, ReturnType<typeof setTimeout>>();

function debouncedSyncBranchTabs(windowId: number) {
  const existing = syncTimers.get(windowId);
  if (existing) clearTimeout(existing);

  syncTimers.set(windowId, setTimeout(async () => {
    syncTimers.delete(windowId);
    try {
      const tabs = await chrome.tabs.query({ windowId });
      const snapshots = tabs.map(fromChromeTab).map(toSnapshot);
      const updated = await branchOps.syncBranchTabs(windowId, snapshots);
      if (updated) {
        console.log(`[Neuro-Nav] Synced ${snapshots.length} tabs → branch "${updated.name}"`);
      }
    } catch {
      // Window may have closed between debounce — safe to ignore
    }
  }, 500));
}

// Tab closed
chrome.tabs.onRemoved.addListener((_tabId, removeInfo) => {
  if (removeInfo.isWindowClosing) return; // window GC handles this
  debouncedSyncBranchTabs(removeInfo.windowId);
});

// Tab created
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.windowId) debouncedSyncBranchTabs(tab.windowId);
});

// Tab navigated (URL change complete)
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.windowId) {
    debouncedSyncBranchTabs(tab.windowId);
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
    // Option A: use last focused window for CLI checkout
    const focusedWindow = await chrome.windows.getLastFocused({ populate: false });
    const wid = focusedWindow.id!;
    const currentTabs = (await chrome.tabs.query({ windowId: wid }))
      .map(fromChromeTab).map(toSnapshot);
    const result = await branchOps.checkoutBranch(name, currentTabs, wid);

    const existingTabs = await chrome.tabs.query({ windowId: wid });

    for (const tab of result.tabsToOpen) {
      await chrome.tabs.create({ windowId: wid, url: tab.url, pinned: tab.pinned });
    }
    if (result.tabsToOpen.length > 0) {
      for (const tab of existingTabs) {
        if (tab.id) chrome.tabs.remove(tab.id);
      }
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
    console.log('[Neuro-Nav] Extension installed — v1.0.0');
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
    const windowId = tab.windowId ?? (await chrome.windows.getLastFocused()).id!;
    const branch = await getActiveBranchForWindow(windowId);
    const branchName = branch?.name ?? 'default';

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
