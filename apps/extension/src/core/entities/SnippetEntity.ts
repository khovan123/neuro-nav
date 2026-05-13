/* ============================================================
   SNIPPET ENTITY — User-highlighted text saved from web pages
   ============================================================ */

export interface SnippetEntity {
  id: string;
  text: string;
  url: string;
  title: string;
  branch: string;
  note: string;
  createdAt: number;
}

export function makeSnippetId(): string {
  return `snip_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
