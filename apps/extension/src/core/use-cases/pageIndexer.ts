/* ============================================================
   PAGE INDEXER — Orchestrates extraction → classification → embedding → indexing
   ============================================================ */

import type { PageDocument } from '@/core/entities/PageDocument';
import { classifyPage } from '@/core/entities/PageDocument';
import { indexPage } from '@/infrastructure/search/searchIndex';
import { embed, isReady } from '@/infrastructure/ai/embeddingService';

export interface ExtractedPagePayload {
  url: string;
  title: string;
  description: string;
  favicon: string;
  text: string;
  extractedAt: number;
}

/**
 * Process an extracted page: classify, embed (if ready), and index it.
 */
export async function processExtractedPage(payload: ExtractedPagePayload): Promise<PageDocument> {
  const category = classifyPage(payload.url, payload.title);

  const doc: PageDocument = {
    url: payload.url,
    title: payload.title,
    description: payload.description,
    favicon: payload.favicon,
    text: payload.text,
    category,
    extractedAt: payload.extractedAt,
  };

  // Generate vector embedding if the AI model is ready (non-blocking fallback)
  if (isReady() && payload.text.length > 50) {
    try {
      doc.embedding = await embed(payload.text);
      doc.embeddedAt = Date.now();
      console.log(`[Neuro-Nav] 🧠 Embedded: ${doc.title}`);
    } catch (err) {
      console.warn('[Neuro-Nav] Embedding skipped:', err);
    }
  }

  await indexPage(doc);

  return doc;
}
