/* ============================================================
   EMBEDDING SERVICE — High-level API over the offscreen document
   
   In MV3, the service worker cannot use `new Worker()`.
   Instead, we send messages to an offscreen document that
   hosts the actual Web Worker.
   ============================================================ */

export type AiModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AiProgress {
  file: string;
  loaded: number;
  total: number;
  progress: number; // 0–100
}

let modelStatus: AiModelStatus = 'idle';
let pendingCallbacks = new Map<string, {
  resolve: (embedding: number[]) => void;
  reject: (err: Error) => void;
}>();
let idCounter = 0;
let offscreenCreated = false;

// Listeners for status/progress changes (background → popup bridge)
type StatusListener = (status: AiModelStatus) => void;
type ProgressListener = (progress: AiProgress) => void;
const statusListeners: StatusListener[] = [];
const progressListeners: ProgressListener[] = [];

export function onStatusChange(cb: StatusListener): () => void {
  statusListeners.push(cb);
  return () => {
    const idx = statusListeners.indexOf(cb);
    if (idx >= 0) statusListeners.splice(idx, 1);
  };
}

export function onProgress(cb: ProgressListener): () => void {
  progressListeners.push(cb);
  return () => {
    const idx = progressListeners.indexOf(cb);
    if (idx >= 0) progressListeners.splice(idx, 1);
  };
}

function setStatus(s: AiModelStatus) {
  modelStatus = s;
  for (const cb of statusListeners) cb(s);
}

// Listen for messages forwarded from the offscreen document
chrome.runtime.onMessage.addListener((message) => {
  // Only handle messages from the offscreen document (forwarded worker messages)
  if (message.target !== 'background') return;

  const { type, id, embedding, error, file, loaded, total, progress } = message;

  if (type === 'READY') {
    setStatus('ready');
    console.log('[EmbeddingService] Model loaded and ready');
    return;
  }

  if (type === 'PROGRESS') {
    if (modelStatus !== 'loading') setStatus('loading');
    for (const cb of progressListeners) {
      cb({ file: file ?? '', loaded: loaded ?? 0, total: total ?? 0, progress: progress ?? 0 });
    }
    return;
  }

  if (type === 'RESULT' && id) {
    const cb = pendingCallbacks.get(id);
    if (cb) {
      cb.resolve(embedding);
      pendingCallbacks.delete(id);
    }
    return;
  }

  if (type === 'ERROR') {
    if (id) {
      const cb = pendingCallbacks.get(id);
      if (cb) {
        cb.reject(new Error(error));
        pendingCallbacks.delete(id);
      }
    } else {
      setStatus('error');
      console.error('[EmbeddingService] Worker error:', error);
    }
    return;
  }
});

/** Ensure the offscreen document exists */
async function ensureOffscreen(): Promise<void> {
  if (offscreenCreated) return;
  
  // Check if already exists (e.g., after service worker restart)
  const contexts = await (chrome.runtime as any).getContexts?.({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  });

  if (contexts && contexts.length > 0) {
    offscreenCreated = true;
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Run ML model inference in a Web Worker',
    });
    offscreenCreated = true;
    console.log('[EmbeddingService] Offscreen document created');
  } catch (err: any) {
    // Document may already exist
    if (err.message?.includes('Only a single offscreen')) {
      offscreenCreated = true;
    } else {
      console.error('[EmbeddingService] Failed to create offscreen document:', err);
    }
  }
}

/** Initialize the embedding model (async, call early). */
export async function initEmbedding(): Promise<void> {
  if (modelStatus === 'ready' || modelStatus === 'loading') return;
  setStatus('loading');

  await ensureOffscreen();

  chrome.runtime.sendMessage({ target: 'offscreen', action: 'INIT' }).catch(() => {});
}

/** Whether the model is loaded and ready. */
export function isReady(): boolean {
  return modelStatus === 'ready';
}

/** Get current model status. */
export function getStatus(): AiModelStatus {
  return modelStatus;
}

/** Compute a 384-dim embedding for the given text. */
export async function embed(text: string): Promise<number[]> {
  await ensureOffscreen();

  return new Promise((resolve, reject) => {
    const id = `emb_${++idCounter}`;
    pendingCallbacks.set(id, { resolve, reject });
    chrome.runtime.sendMessage({ target: 'offscreen', action: 'EMBED', id, text }).catch((err) => {
      pendingCallbacks.delete(id);
      reject(err);
    });
  });
}

/** Shut down the offscreen document. */
export async function terminate(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch { /* already closed */ }
  offscreenCreated = false;
  setStatus('idle');
  pendingCallbacks.clear();
}
