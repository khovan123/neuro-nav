/* ============================================================
   WATCHER — Real-time file watcher using chokidar
   Watches project config files and triggers re-scan on change.
   ============================================================ */

import { watch, type FSWatcher } from 'chokidar';
import { join } from 'node:path';

// Files that trigger a re-scan when modified
const WATCH_PATTERNS = [
  'package.json',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
  'Dockerfile',
  'tsconfig.json',
  '.env',
  'Makefile',
];

const DEBOUNCE_MS = 2000;

export type WatchCallback = (changedFile: string) => void;

let activeWatcher: FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Start watching a project directory for config file changes.
 * Calls `onRescan` when relevant files change (debounced 2s).
 */
export function startWatching(rootPath: string, onRescan: WatchCallback): void {
  // Stop previous watcher if any
  stopWatching();

  const watchPaths = WATCH_PATTERNS.map(p => join(rootPath, p));

  activeWatcher = watch(watchPaths, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 500 },
  });

  const handleChange = (filePath: string) => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`[watcher] Change detected: ${filePath}`);
      onRescan(filePath);
    }, DEBOUNCE_MS);
  };

  activeWatcher.on('change', handleChange);
  activeWatcher.on('add', handleChange);

  console.log(`[watcher] Watching ${rootPath} for config changes`);
}

/**
 * Stop the active watcher.
 */
export function stopWatching(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (activeWatcher) {
    activeWatcher.close();
    activeWatcher = null;
    console.log('[watcher] Stopped');
  }
}

/**
 * Check if watcher is currently active.
 */
export function isWatching(): boolean {
  return activeWatcher !== null;
}
