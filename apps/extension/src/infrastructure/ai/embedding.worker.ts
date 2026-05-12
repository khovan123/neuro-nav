/* ============================================================
   EMBEDDING WORKER — Runs @huggingface/transformers in a Web Worker
   to compute 384-dim embeddings without blocking the UI.

   Communication:
     postMessage({ type: 'EMBED', id, text }) → onmessage({ type: 'RESULT', id, embedding })
     postMessage({ type: 'INIT' })             → onmessage({ type: 'READY' })
     Progress events:                           → onmessage({ type: 'PROGRESS', ... })
   ============================================================ */

import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

// ---- CRITICAL: Configure ONNX to load WASM files locally ----
// Chrome extension CSP blocks loading scripts from CDN.
// The WASM files are copied to dist/ by the Vite build plugin.
env.allowLocalModels = false;

// Derive the extension's base URL from the worker's own location
const extensionBase = self.location.href.replace(/[^/]*$/, '');

// Tell ONNX Runtime to load WASM files from the extension bundle
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = extensionBase;
}

let extractor: FeatureExtractionPipeline | null = null;
let initializing = false;

async function init() {
  if (extractor || initializing) return;
  initializing = true;

  try {
    extractor = await (pipeline as any)(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: (progress: any) => {
          // Forward download progress to the service worker
          if (progress.status === 'progress') {
            self.postMessage({
              type: 'PROGRESS',
              file: progress.file ?? '',
              loaded: progress.loaded ?? 0,
              total: progress.total ?? 0,
              progress: progress.progress ?? 0,
            });
          } else if (progress.status === 'initiate') {
            self.postMessage({
              type: 'PROGRESS',
              file: progress.file ?? '',
              loaded: 0,
              total: 0,
              progress: 0,
            });
          } else if (progress.status === 'done') {
            self.postMessage({
              type: 'PROGRESS',
              file: progress.file ?? '',
              loaded: 1,
              total: 1,
              progress: 100,
            });
          }
        },
      }
    );
    self.postMessage({ type: 'READY' });
  } catch (err) {
    console.error('[EmbeddingWorker] Init failed:', err);
    self.postMessage({ type: 'ERROR', error: String(err) });
  } finally {
    initializing = false;
  }
}

self.onmessage = async (event: MessageEvent) => {
  const { type, id, text } = event.data;

  if (type === 'INIT') {
    await init();
    return;
  }

  if (type === 'EMBED') {
    if (!extractor) {
      await init();
    }

    if (!extractor) {
      self.postMessage({ type: 'ERROR', id, error: 'Extractor not ready' });
      return;
    }

    try {
      // Truncate text to ~256 tokens worth (~1200 chars)
      const truncated = (text as string).slice(0, 1200);
      const output = await extractor(truncated, { pooling: 'mean', normalize: true });
      const embedding = Array.from(output.data as Float32Array);
      self.postMessage({ type: 'RESULT', id, embedding });
    } catch (err) {
      self.postMessage({ type: 'ERROR', id, error: String(err) });
    }
  }
};
