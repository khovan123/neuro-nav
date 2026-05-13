/* ============================================================
   MESSAGE PASSING PROTOCOL
   Typed message bridge between popup ↔ service worker ↔ content scripts
   ============================================================ */

/**
 * All messages in the system follow this envelope pattern.
 * The `type` field acts as a discriminant for type-safe handlers.
 */

// ---- Message Types ----

export const MSG = {
  // Tab management
  TABS_GET_ALL: 'TABS_GET_ALL',
  TABS_STATE_UPDATE: 'TABS_STATE_UPDATE',
  TAB_CLOSE: 'TAB_CLOSE',
  TAB_ACTIVATE: 'TAB_ACTIVATE',

  // Workspaces
  WORKSPACE_SAVE: 'WORKSPACE_SAVE',
  WORKSPACE_RESTORE: 'WORKSPACE_RESTORE',
  WORKSPACE_DELETE: 'WORKSPACE_DELETE',
  WORKSPACE_LIST: 'WORKSPACE_LIST',
  WORKSPACE_EXPORT: 'WORKSPACE_EXPORT',
  WORKSPACE_IMPORT: 'WORKSPACE_IMPORT',

  // Branches (Phase 2)
  BRANCH_LIST: 'BRANCH_LIST',
  BRANCH_CHECKOUT: 'BRANCH_CHECKOUT',
  BRANCH_CHECKOUT_NEW_WINDOW: 'BRANCH_CHECKOUT_NEW_WINDOW',
  BRANCH_CREATE: 'BRANCH_CREATE',
  BRANCH_DELETE: 'BRANCH_DELETE',
  BRANCH_MERGE: 'BRANCH_MERGE',
  GET_WINDOW_BRANCH: 'GET_WINDOW_BRANCH',

  // Stash (Phase 2)
  STASH_PUSH: 'STASH_PUSH',
  STASH_POP: 'STASH_POP',
  STASH_LIST: 'STASH_LIST',

  // Pruning
  PRUNE_TRIGGER: 'PRUNE_TRIGGER',
  PRUNE_STATUS: 'PRUNE_STATUS',

  // Content extraction & search (Phase 3)
  CONTENT_EXTRACTED: 'CONTENT_EXTRACTED',
  SEARCH_PAGES: 'SEARCH_PAGES',
  INDEX_STATUS: 'INDEX_STATUS',

  // Graph (Phase 4)
  GRAPH_DATA: 'GRAPH_DATA',

  // Reading Progress (v1.5)
  READING_PROGRESS: 'READING_PROGRESS',
  GET_READING_PROGRESS: 'GET_READING_PROGRESS',

  // Snippets (v1.5)
  SNIPPET_SAVE: 'SNIPPET_SAVE',
  SNIPPET_LIST: 'SNIPPET_LIST',
  SNIPPET_DELETE: 'SNIPPET_DELETE',

  // Session Summary (v2.0)
  SESSION_SUMMARY_GENERATE: 'SESSION_SUMMARY_GENERATE',
  SESSION_SUMMARY_GET: 'SESSION_SUMMARY_GET',

  // Generic
  PING: 'PING',
  PONG: 'PONG',
  ERROR: 'ERROR',
} as const;

export type MessageType = (typeof MSG)[keyof typeof MSG];

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
  requestId?: string;
}

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ---- Sender Utilities ----

/** Send a message to the background service worker and await a typed response. */
export async function sendToBackground<TReq = unknown, TRes = unknown>(
  type: MessageType,
  payload?: TReq
): Promise<MessageResponse<TRes>> {
  try {
    const response = await chrome.runtime.sendMessage<Message<TReq>, MessageResponse<TRes>>({
      type,
      payload,
      requestId: crypto.randomUUID(),
    });
    return response ?? { success: false, error: 'No response from background' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/** Send a message to a specific tab's content script. */
export async function sendToTab<TReq = unknown, TRes = unknown>(
  tabId: number,
  type: MessageType,
  payload?: TReq
): Promise<MessageResponse<TRes>> {
  try {
    const response = await chrome.tabs.sendMessage<Message<TReq>, MessageResponse<TRes>>(tabId, {
      type,
      payload,
      requestId: crypto.randomUUID(),
    });
    return response ?? { success: false, error: 'No response from tab' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

/** Create a typed message listener with routing. */
export type MessageHandler = (
  message: Message,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageResponse) => void
) => boolean | void;

export function createMessageRouter(
  handlers: Partial<Record<MessageType, (payload: unknown, sender: chrome.runtime.MessageSender) => Promise<MessageResponse>>>
): MessageHandler {
  return (message, sender, sendResponse) => {
    const handler = handlers[message.type];
    if (!handler) return false;

    handler(message.payload, sender)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          success: false,
          error: err instanceof Error ? err.message : 'Handler error',
        })
      );

    return true; // Keep the message channel open for async response
  };
}
