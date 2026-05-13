/* ============================================================
   SEARCH INDEX — Orama-powered full-text + vector hybrid search
   Stores ChunkDocuments in IndexedDB and indexes them in Orama.
   Phase 4: Semantic search via 384-dim embeddings.
   ============================================================ */

import { create, insert, search, remove, count, type AnyOrama } from '@orama/orama';
import type { ChunkDocument } from '@/core/entities/ChunkDocument';
import { embed, isReady } from '@/infrastructure/ai/embeddingService';

const DB_NAME = 'neuro-nav-search';
const STORE_NAME = 'chunks';  // Was 'pages' in v1
const DB_VERSION = 2;         // Bumped from 1 → 2 for chunk migration

// ---- IndexedDB Persistence ----

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Wipe old 'pages' store from v1 — data will be re-crawled naturally
      if (db.objectStoreNames.contains('pages')) {
        db.deleteObjectStore('pages');
      }

      // Create new chunks store with composite keyPath
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistChunk(chunk: ChunkDocument): Promise<void> {
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).put(chunk);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function loadAllChunks(): Promise<ChunkDocument[]> {
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const req = tx.objectStore(STORE_NAME).getAll();
  return new Promise<ChunkDocument[]>((resolve, reject) => {
    req.onsuccess = () => { db.close(); resolve(req.result as ChunkDocument[]); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

async function removeChunkFromIDB(id: string): Promise<void> {
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).delete(id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function removeChunksByUrl(url: string): Promise<void> {
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const req = store.getAll();
  await new Promise<void>((resolve, reject) => {
    req.onsuccess = () => {
      const chunks = req.result as ChunkDocument[];
      for (const chunk of chunks) {
        if (chunk.url === url) {
          store.delete(chunk.id);
        }
      }
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
}

// ---- Orama Index ----

let oramaInstance: AnyOrama | null = null;

async function getIndex(): Promise<AnyOrama> {
  if (oramaInstance) return oramaInstance;

  oramaInstance = await create({
    schema: {
      id: 'string',
      url: 'string',
      title: 'string',
      chunkText: 'string',
      chunkIndex: 'number',
      category: 'string',
      branch: 'string',
      embedding: 'vector[384]',
      extractedAt: 'number',
    } as const,
  });

  // Hydrate from IndexedDB
  try {
    let chunks = await loadAllChunks();

    // Memory Limit: Keep only the most recent 10,000 chunks in RAM
    const MAX_CHUNKS = 10_000;
    if (chunks.length > MAX_CHUNKS) {
      chunks.sort((a, b) => b.extractedAt - a.extractedAt);
      chunks = chunks.slice(0, MAX_CHUNKS);
    }

    for (const chunk of chunks) {
      await insert(oramaInstance, {
        id: chunk.id,
        url: chunk.url,
        title: chunk.title,
        chunkText: chunk.chunkText.slice(0, 2000),
        chunkIndex: chunk.chunkIndex,
        category: chunk.category,
        branch: chunk.branch ?? 'default',
        embedding: chunk.embedding ?? new Array(384).fill(0),
        extractedAt: chunk.extractedAt,
      });
    }
    console.log(`[SearchIndex] Loaded ${chunks.length} chunks from cache`);
  } catch (err) {
    console.error('[SearchIndex] Hydration failed:', err);
  }

  return oramaInstance;
}

// ---- Public API ----

export interface SearchResult {
  /** Composite chunk ID */
  id: string;
  url: string;
  title: string;
  /** Chunk text for Text Fragments highlight */
  chunkText: string;
  category: string;
  score: number;
}

/**
 * Index a chunk document (upserts by ID).
 */
export async function indexChunk(chunk: ChunkDocument): Promise<void> {
  // Persist to IndexedDB first
  await persistChunk(chunk);

  const idx = await getIndex();

  // Remove existing entry if updating (upsert)
  try {
    await remove(idx, chunk.id);
  } catch {
    // Not found — fine, inserting new doc
  }

  await insert(idx, {
    id: chunk.id,
    url: chunk.url,
    title: chunk.title,
    chunkText: chunk.chunkText.slice(0, 2000),
    chunkIndex: chunk.chunkIndex,
    category: chunk.category,
    branch: chunk.branch ?? 'default',
    embedding: chunk.embedding ?? new Array(384).fill(0),
    extractedAt: chunk.extractedAt,
  });
}

/**
 * Common English stop words that add noise to search results.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
  'just', 'because', 'but', 'and', 'or', 'if', 'while', 'although',
  'this', 'that', 'these', 'those', 'it', 'its', 'what', 'which', 'who',
  'whom', 'whose', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
  'him', 'his', 'she', 'her', 'they', 'them', 'their', 'about', 'up',
]);

/** Remove stop words and return only meaningful terms. */
function extractKeyTerms(query: string): string {
  const words = query.toLowerCase().split(/\s+/);
  const meaningful = words.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return meaningful.length > 0 ? meaningful.join(' ') : query.trim();
}

/**
 * Hybrid search: combines full-text + vector cosine similarity.
 * Results are scoped to the specified branch to prevent context leaks.
 * Falls back to pure lexical search if embeddings are unavailable.
 */
export async function searchPages(query: string, limit = 10, branchName?: string): Promise<SearchResult[]> {
  const idx = await getIndex();
  const cleanQuery = extractKeyTerms(query);

  // Branch filter — only search within the active branch context
  const whereClause = branchName ? { branch: branchName } : undefined;

  // Try hybrid search if AI model is ready
  if (isReady()) {
    try {
      const queryVector = await embed(query);
      const results = await search(idx, {
        term: cleanQuery,
        properties: ['title', 'chunkText'],
        vector: {
          value: queryVector,
          property: 'embedding',
        },
        mode: 'hybrid',
        where: whereClause,
        limit: limit * 2,
        boost: { title: 3, chunkText: 1 },
      });

      if (results.hits.length > 0) {
        return deduplicateByUrl(results.hits, limit);
      }
    } catch (err) {
      console.warn('[SearchIndex] Hybrid search failed, falling back to lexical:', err);
    }
  }

  // Fallback: pure lexical search
  const results = await search(idx, {
    term: cleanQuery,
    properties: ['title', 'chunkText'],
    where: whereClause,
    limit: limit * 2,
    tolerance: 0,
    threshold: 0,
    boost: { title: 5, chunkText: 1 },
  });

  let hits = results.hits;
  if (hits.length === 0) {
    const fallback = await search(idx, {
      term: cleanQuery,
      properties: ['title', 'chunkText'],
      where: whereClause,
      limit,
      tolerance: 1,
      threshold: 0.3,
      boost: { title: 5, chunkText: 1 },
    });
    hits = fallback.hits;
  }

  return deduplicateByUrl(hits, limit);
}

/**
 * Deduplicate results by URL — keep only the best-scoring chunk per page.
 * This prevents the same page from appearing multiple times in results.
 */
function deduplicateByUrl(
  hits: { id: string | number; score: number; document: Record<string, unknown> }[],
  limit: number
): SearchResult[] {
  const seen = new Map<string, SearchResult>();

  for (const hit of hits) {
    const doc = hit.document as Record<string, unknown>;
    const url = doc.url as string;

    if (!seen.has(url) || hit.score > seen.get(url)!.score) {
      seen.set(url, {
        id: doc.id as string,
        url,
        title: doc.title as string,
        chunkText: doc.chunkText as string,
        category: doc.category as string,
        score: hit.score,
      });
    }
  }

  return Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Get total count of indexed chunks.
 */
export async function getIndexCount(): Promise<number> {
  const idx = await getIndex();
  return count(idx);
}

/**
 * Remove all chunks for a URL.
 */
export async function removeFromIndex(url: string): Promise<void> {
  await removeChunksByUrl(url);
  const idx = await getIndex();
  // Remove all Orama entries matching this URL
  const existing = await search(idx, { term: url, properties: ['url'], limit: 50 });
  for (const hit of existing.hits) {
    await remove(idx, hit.id);
  }
}

/**
 * Prune indexed chunks older than the specified number of days.
 */
export async function pruneOldPages(maxAgeDays = 30): Promise<number> {
  const db = await openIDB();
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  const req = store.getAll();
  return new Promise<number>((resolve, reject) => {
    req.onsuccess = async () => {
      const chunks = req.result as ChunkDocument[];
      let deleted = 0;
      for (const chunk of chunks) {
        if (chunk.extractedAt < cutoff) {
          store.delete(chunk.id);
          deleted++;
        }
      }

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

/**
 * Reassign all chunks from `sourceBranch` to `targetBranch`.
 * Updates both IDB persistence and the in-memory Orama index.
 */
export async function reassignChunksBranch(
  sourceBranch: string,
  targetBranch: string
): Promise<number> {
  // Update IDB
  const db = await openIDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const req = store.getAll();

  const reassigned = await new Promise<number>((resolve, reject) => {
    req.onsuccess = () => {
      const chunks = req.result as ChunkDocument[];
      let count = 0;
      for (const chunk of chunks) {
        if (chunk.branch === sourceBranch) {
          chunk.branch = targetBranch;
          store.put(chunk);
          count++;
        }
      }
      tx.oncomplete = () => { db.close(); resolve(count); };
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });

  // Rebuild Orama index to reflect changes (re-hydrate)
  if (reassigned > 0 && oramaInstance) {
    oramaInstance = null; // Force re-hydration on next getOrCreateIndex()
  }

  return reassigned;
}
