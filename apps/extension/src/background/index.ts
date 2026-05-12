/* ============================================================
   BACKGROUND SERVICE WORKER — Message broker & alarm scheduler
   ============================================================ */

import { createMessageRouter, MSG } from '@/shared/messaging';
import { pruneOldRecords, getAllWorkspaces, getActiveBranch } from '@/infrastructure/db/database';
import * as branchOps from '@/core/use-cases/manageBranches';
import * as stashOps from '@/core/use-cases/stashMemory';
import { processExtractedPage } from '@/core/use-cases/pageIndexer';
import { searchPages, getIndexCount, pruneOldPages } from '@/infrastructure/search/searchIndex';
import { shouldBlock } from '@/core/use-cases/intentBlocker';
import { recordPageVisit, recordNavigation, getGraphData } from '@/core/use-cases/graphBuilder';
import { classifyPage } from '@/core/entities/PageDocument';
import { fromChromeTab, toSnapshot } from '@/core/entities/Tab';

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
    const { name } = payload as { name: string };
    const currentTabs = (await chrome.tabs.query({ currentWindow: true }))
      .map(fromChromeTab).map(toSnapshot);
    const branch = await branchOps.createNewBranch(name, currentTabs, true);
    return { success: true, data: branch };
  },

  [MSG.BRANCH_CHECKOUT]: async (payload) => {
    const { name } = payload as { name: string };
    const currentTabs = (await chrome.tabs.query({ currentWindow: true }))
      .map(fromChromeTab).map(toSnapshot);
    const result = await branchOps.checkoutBranch(name, currentTabs);

    // Swap tabs in the current window
    const currentWindow = await chrome.windows.getCurrent();
    const existingTabs = await chrome.tabs.query({ windowId: currentWindow.id });

    for (const tab of result.tabsToOpen) {
      await chrome.tabs.create({ windowId: currentWindow.id, url: tab.url, pinned: tab.pinned });
    }
    if (result.tabsToOpen.length > 0) {
      for (const tab of existingTabs) {
        if (tab.id) chrome.tabs.remove(tab.id);
      }
    }

    return { success: true, data: result.branch };
  },

  [MSG.BRANCH_DELETE]: async (payload) => {
    const { id } = payload as { id: string };
    await branchOps.deleteBranchById(id);
    return { success: true };
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

  [MSG.SEARCH_PAGES]: async (payload) => {
    const { query, limit } = payload as { query: string; limit?: number };
    const results = await searchPages(query, limit);
    return { success: true, data: results };
  },

  [MSG.INDEX_STATUS]: async () => {
    const count = await getIndexCount();
    return { success: true, data: { count } };
  },

  // ---- Graph handler (Phase 4) ----

  [MSG.GRAPH_DATA]: async () => {
    const data = await getGraphData();
    return { success: true, data };
  },
});

chrome.runtime.onMessage.addListener(router);

// ---- Content Script Listener (raw messages, not routed) ----

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'PAGE_CONTENT_EXTRACTED') {
    processExtractedPage(message.payload)
      .then((doc) => {
        console.log(`[Neuro-Nav] Indexed: ${doc.title} [${doc.category}]`);
        sendResponse({ success: true });
      })
      .catch((err) => {
        console.error('[Neuro-Nav] Indexing failed:', err);
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
    const activeBranch = await getActiveBranch();
    if (!activeBranch) return;

    // Get page title for better classification
    const tab = await chrome.tabs.get(details.tabId).catch(() => null);
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
                <span style="font-size:20px;flex-shrink:0">⚠️</span>
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
    await recordPageVisit(details.url, title, favicon, category);

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

// ---- CLI Bridge (WebSocket Client → nav-server) ----

const CLI_SERVER_URL = 'ws://127.0.0.1:9500';
const CLI_RECONNECT_MS = 5_000;

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
    const currentTabs = (await chrome.tabs.query({ currentWindow: true }))
      .map(fromChromeTab).map(toSnapshot);
    const result = await branchOps.checkoutBranch(name, currentTabs);

    const currentWindow = await chrome.windows.getCurrent();
    const existingTabs = await chrome.tabs.query({ windowId: currentWindow.id });

    for (const tab of result.tabsToOpen) {
      await chrome.tabs.create({ windowId: currentWindow.id, url: tab.url, pinned: tab.pinned });
    }
    if (result.tabsToOpen.length > 0) {
      for (const tab of existingTabs) {
        if (tab.id) chrome.tabs.remove(tab.id);
      }
    }
    return { success: true, data: result.branch };
  },
  BRANCH_CREATE: async (payload) => {
    const { name } = payload as { name: string };
    const currentTabs = (await chrome.tabs.query({ currentWindow: true }))
      .map(fromChromeTab).map(toSnapshot);
    const branch = await branchOps.createNewBranch(name, currentTabs, true);
    return { success: true, data: branch };
  },
  BRANCH_DELETE: async (payload) => {
    const { id } = payload as { id: string };
    await branchOps.deleteBranchById(id);
    return { success: true };
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
    const data = await getGraphData();
    return { success: true, data };
  },
};

let cliSocket: WebSocket | null = null;
let cliReconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectToCLIServer() {
  // Don't reconnect if already connected or connecting
  if (cliSocket && (cliSocket.readyState === WebSocket.OPEN || cliSocket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    cliSocket = new WebSocket(CLI_SERVER_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  cliSocket.onopen = () => {
    console.log('[Neuro-Nav] Connected to nav-server');
    if (cliReconnectTimer) {
      clearTimeout(cliReconnectTimer);
      cliReconnectTimer = null;
    }
    // Identify as extension
    cliSocket!.send(JSON.stringify({ source: 'extension', type: 'IDENTIFY' }));
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
    console.log('[Neuro-Nav] Disconnected from nav-server');
    cliSocket = null;
    scheduleReconnect();
  };

  cliSocket.onerror = () => {
    // onclose will fire after onerror — reconnect handled there
    cliSocket?.close();
  };
}

function scheduleReconnect() {
  if (cliReconnectTimer) return;
  cliReconnectTimer = setTimeout(() => {
    cliReconnectTimer = null;
    connectToCLIServer();
  }, CLI_RECONNECT_MS);
}

// Start CLI bridge
connectToCLIServer();

// ---- Extension Install/Update ----

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[Neuro-Nav] Extension installed — v1.0.0');
  } else if (details.reason === 'update') {
    console.log(`[Neuro-Nav] Updated from ${details.previousVersion}`);
  }
});

console.log('[Neuro-Nav] Service Worker initialized');
