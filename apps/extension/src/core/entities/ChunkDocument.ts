/* ============================================================
   CHUNK DOCUMENT — Entity for semantic-chunked page content
   Each page is split into overlapping chunks for vector search.
   ============================================================ */

import type { PageCategory } from '@/core/entities/PageDocument';

export interface ChunkDocument {
  /** Composite key: `${url}#chunk-${chunkIndex}` */
  id: string;
  /** Original page URL */
  url: string;
  title: string;
  favicon: string;
  /** Auto-assigned category */
  category: PageCategory;
  /** Branch name when this chunk was indexed (for context isolation) */
  branch: string;
  /** Chunk content (~1000 chars with 200-char overlap) */
  chunkText: string;
  /** Chunk ordinal within the page (0-based) */
  chunkIndex: number;
  /** 384-dim embedding vector (all-MiniLM-L6-v2) */
  embedding?: number[];
  /** Timestamp when content was extracted */
  extractedAt: number;
  /** Timestamp when embedding was computed */
  embeddedAt?: number;
}

/** Build the composite ID for a chunk. */
export function makeChunkId(url: string, index: number): string {
  return `${url}#chunk-${index}`;
}
