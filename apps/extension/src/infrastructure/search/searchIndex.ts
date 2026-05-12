/* ============================================================
   SEARCH INDEX — Orama-powered full-text + vector search
   Stores PageDocuments in IndexedDB and indexes them in Orama.
   ============================================================ */

import { create, insert, search, remove, count, type AnyOrama } from '@orama/orama';
import type { PageDocument } from '@/core/entities/PageDocument';

const DB_NAME = 'neuro-nav-search';
const STORE_NAME = 'pages';
const DB_VERSION = 1;

// ---- IndexedDB Persistence ----

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistDoc(doc: PageDocument): Promise<void> {
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(doc);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadAllDocs(): Promise<PageDocument[]> {
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();
  return new Promise<PageDocument[]>((resolve, reject) => {
    req.onsuccess = () => { db.close(); resolve(req.result as PageDocument[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function removeDocFromIDB(url: string): Promise<void> {
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(url);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

// ---- Orama Index ----

let oramaInstance: AnyOrama | null = null;

async function getIndex(): Promise<AnyOrama> {
  if (oramaInstance) return oramaInstance;

  oramaInstance = await create({
    schema: {
      url: 'string',
      title: 'string',
      description: 'string',
      text: 'string',
      category: 'string',
      extractedAt: 'number',
    } as const,
  });

  // Hydrate from IndexedDB
  try {
    let docs = await loadAllDocs();
    
    // Memory Limit Optimization: Keep only the most recent 5,000 pages in RAM
    const MAX_PAGES = 5000;
    if (docs.length > MAX_PAGES) {
      docs.sort((a, b) => b.extractedAt - a.extractedAt);
      docs = docs.slice(0, MAX_PAGES);
    }

    for (const doc of docs) {
      await insert(oramaInstance, {
        url: doc.url,
        title: doc.title,
        description: doc.description,
        text: doc.text.slice(0, 2000), // Orama text index — keep manageable
        category: doc.category,
        extractedAt: doc.extractedAt,
      });
    }
    console.log(`[SearchIndex] Loaded ${docs.length} documents from cache`);
  } catch (err) {
    console.error('[SearchIndex] Hydration failed:', err);
  }

  return oramaInstance;
}

// ---- Public API ----

export interface SearchResult {
  url: string;
  title: string;
  description: string;
  category: string;
  score: number;
}

/**
 * Index a page document (upserts by URL).
 */
export async function indexPage(doc: PageDocument): Promise<void> {
  // Persist to IndexedDB first
  await persistDoc(doc);

  const idx = await getIndex();

  // Remove existing entry if updating
  try {
    const existing = await search(idx, { term: doc.url, properties: ['url'], limit: 1 });
    if (existing.hits.length > 0) {
      await remove(idx, existing.hits[0].id);
    }
  } catch {
    // Not found — that's fine
  }

  await insert(idx, {
    url: doc.url,
    title: doc.title,
    description: doc.description,
    text: doc.text.slice(0, 2000),
    category: doc.category,
    extractedAt: doc.extractedAt,
  });
}

/**
 * Full-text search across all indexed pages.
 */
export async function searchPages(query: string, limit = 10): Promise<SearchResult[]> {
  const idx = await getIndex();
  const results = await search(idx, {
    term: query,
    properties: ['title', 'text', 'description', 'url'],
    limit,
    tolerance: 1,       // Allow 1-char typo per term
    threshold: 1,       // 1 = return all partial matches (most lenient)
    boost: { title: 3, description: 2, text: 1 },
  });

  return results.hits.map((hit) => ({
    url: (hit.document as Record<string, unknown>).url as string,
    title: (hit.document as Record<string, unknown>).title as string,
    description: (hit.document as Record<string, unknown>).description as string,
    category: (hit.document as Record<string, unknown>).category as string,
    score: hit.score,
  }));
}

/**
 * Get total count of indexed documents.
 */
export async function getIndexCount(): Promise<number> {
  const idx = await getIndex();
  return count(idx);
}

/**
 * Remove a document by URL.
 */
export async function removeFromIndex(url: string): Promise<void> {
  await removeDocFromIDB(url);
  const idx = await getIndex();
  const existing = await search(idx, { term: url, properties: ['url'], limit: 1 });
  if (existing.hits.length > 0) {
    await remove(idx, existing.hits[0].id);
  }
}

/**
 * Prune indexed pages older than the specified number of days.
 */
export async function pruneOldPages(maxAgeDays = 30): Promise<number> {
  const db = await openIDB();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  
  const req = store.getAll();
  return new Promise<number>((resolve, reject) => {
    req.onsuccess = async () => {
      const docs = req.result as PageDocument[];
      let deleted = 0;
      for (const doc of docs) {
        if (doc.extractedAt < cutoff) {
          store.delete(doc.url);
          deleted++;
        }
      }
      
      // We don't bother removing from Orama in-memory instance because 
      // on next startup, Orama will only hydrate the remaining items,
      // and typically pruning runs in background where Orama might not even be fully hydrated.
      
      tx.oncomplete = () => {
        db.close();
        resolve(deleted);
      };
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}
