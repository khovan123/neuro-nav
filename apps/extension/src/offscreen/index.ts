/* ============================================================
   OFFSCREEN DOCUMENT — Hosts the embedding Web Worker
   
   MV3 Service Workers cannot use `new Worker()`.
   This offscreen document bridges the service worker to the
   Web Worker via chrome.runtime messaging.

   Flow:
     Service Worker  →  chrome.runtime.sendMessage  →  Offscreen  →  Worker
     Worker          →  postMessage                 →  Offscreen  →  chrome.runtime.sendMessage  →  Service Worker
   ============================================================ */

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    // The embedding-worker.js is a sibling in the dist output
    worker = new Worker(
      chrome.runtime.getURL('embedding-worker.js'),
      { type: 'module' }
    );

    worker.onmessage = (event) => {
      // Forward all worker messages back to the service worker
      chrome.runtime.sendMessage({
        target: 'background',
        ...event.data,
      }).catch(() => {});
    };
  }
  return worker;
}

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;

  const { action, id, text } = message;

  if (action === 'INIT') {
    getWorker().postMessage({ type: 'INIT' });
    sendResponse({ ok: true });
    return false;
  }

  if (action === 'EMBED') {
    getWorker().postMessage({ type: 'EMBED', id, text });
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

console.log('[Neuro-Nav] Offscreen document ready');
