/* ============================================================
   PAGE INDEXER — Orchestrates chunking → classification → embedding → indexing
   Phase 4: Processes an array of sliding-window chunks per page.
   ============================================================ */

import type { PageCategory } from '@/core/entities/PageDocument';
import { classifyPage } from '@/core/entities/PageDocument';
import type { ChunkDocument } from '@/core/entities/ChunkDocument';
import { makeChunkId } from '@/core/entities/ChunkDocument';
import { indexChunk } from '@/infrastructure/search/searchIndex';
import { embed, isReady } from '@/infrastructure/ai/embeddingService';

export interface ExtractedChunk {
  text: string;
  index: number;
}

export interface ExtractedPagePayload {
  url: string;
  title: string;
  description: string;
  favicon: string;
  chunks: ExtractedChunk[];
  extractedAt: number;
}

/**
 * Process extracted page chunks: classify, embed each chunk, and index.
 * @param branchName - Active branch name for context isolation.
 * Returns the number of chunks indexed.
 */
export async function processExtractedChunks(payload: ExtractedPagePayload, branchName = 'default'): Promise<number> {
  const category: PageCategory = classifyPage(payload.url, payload.title);
  let indexed = 0;

  for (const chunk of payload.chunks) {
    const doc: ChunkDocument = {
      id: makeChunkId(payload.url, chunk.index),
      url: payload.url,
      title: payload.title,
      favicon: payload.favicon,
      category,
      branch: branchName,
      chunkText: chunk.text,
      chunkIndex: chunk.index,
      extractedAt: payload.extractedAt,
    };

    // Generate vector embedding if the AI model is ready (non-blocking fallback)
    if (isReady() && chunk.text.length > 50) {
      try {
        doc.embedding = await embed(chunk.text);
        doc.embeddedAt = Date.now();
      } catch (err) {
        console.warn(`[Neuro-Nav] Embedding skipped for chunk ${chunk.index}:`, err);
      }
    }

    await indexChunk(doc);
    indexed++;
  }

  if (indexed > 0) {
    console.log(`[Neuro-Nav] 🧠 Indexed ${indexed} chunks from: ${payload.title}`);
  }

  return indexed;
}
