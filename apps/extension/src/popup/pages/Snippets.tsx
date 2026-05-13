/* ============================================================
   SNIPPETS PAGE — Saved text highlights from web pages
   ============================================================ */

import { useEffect, useState, useCallback } from 'react';
import { useAppSelector } from '@/store/hooks';
import { sendToBackground } from '@/shared/messaging';
import { MSG } from '@/shared/messaging';
import type { SnippetEntity } from '@/core/entities/SnippetEntity';
import { Button } from '@/shared/ui/Button';
import { IconTrash, IconScissors } from '@/shared/ui/Icons';
import { Tooltip } from '@/shared/ui/Tooltip';

/** Group snippets by domain */
function groupByDomain(snippets: SnippetEntity[]): Map<string, SnippetEntity[]> {
  const groups = new Map<string, SnippetEntity[]>();
  for (const s of snippets) {
    let domain: string;
    try { domain = new URL(s.url).hostname; } catch { domain = 'unknown'; }
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain)!.push(s);
  }
  return groups;
}

export function Snippets() {
  const activeBranchName = useAppSelector((s) => s.branches.activeBranchName);
  const [snippets, setSnippets] = useState<SnippetEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const loadSnippets = useCallback(async () => {
    setLoading(true);
    const payload = showAll ? {} : { branch: activeBranchName ?? 'default' };
    const res = await sendToBackground<typeof payload, SnippetEntity[]>(MSG.SNIPPET_LIST, payload);
    if (res.success && res.data) {
      setSnippets(res.data.sort((a, b) => b.createdAt - a.createdAt));
    }
    setLoading(false);
  }, [activeBranchName, showAll]);

  useEffect(() => { loadSnippets(); }, [loadSnippets]);

  const handleDelete = useCallback(async (id: string) => {
    await sendToBackground(MSG.SNIPPET_DELETE, { id });
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleOpen = useCallback((snippet: SnippetEntity) => {
    // Use Text Fragment URL to highlight the snippet on the source page
    const encodedText = encodeURIComponent(snippet.text.slice(0, 100));
    const fragmentUrl = `${snippet.url}#:~:text=${encodedText}`;
    chrome.tabs.create({ url: fragmentUrl });
  }, []);

  const grouped = groupByDomain(snippets);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border-subtle">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Snippets</h2>
            <p className="text-[10px] text-text-tertiary mt-0.5">
              Highlight text on any page → right-click → Save to Neuro-Nav
            </p>
          </div>
          <Button
            variant={showAll ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? 'All sessions' : 'This session'}
          </Button>
        </div>
      </div>

      {/* Snippets list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-pulse text-text-tertiary text-xs">Loading…</div>
          </div>
        ) : snippets.length === 0 ? (
          <div className="text-center py-12 text-text-tertiary">
            <IconScissors size={28} className="mx-auto mb-3 opacity-30" />
            <p className="text-xs">No snippets saved yet</p>
            <p className="text-[11px] mt-1 max-w-[200px] mx-auto">
              Select text on any webpage, right-click, and choose "Save to Neuro-Nav"
            </p>
          </div>
        ) : (
          Array.from(grouped.entries()).map(([domain, items]) => (
            <div key={domain} className="animate-fade-in">
              {/* Domain header */}
              <div className="flex items-center gap-2 mb-1.5 px-1">
                <img
                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=16`}
                  alt=""
                  className="w-3.5 h-3.5 rounded-sm"
                />
                <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
                  {domain}
                </span>
                <span className="text-[10px] text-text-tertiary">
                  ({items.length})
                </span>
              </div>

              {/* Snippet cards */}
              <div className="space-y-1">
                {items.map((snippet) => (
                  <div
                    key={snippet.id}
                    className="group px-3 py-2 rounded-lg bg-surface-overlay/50 hover:bg-surface-overlay
                               border border-transparent hover:border-border-subtle
                               transition-all duration-(--duration-fast) cursor-pointer"
                    onClick={() => handleOpen(snippet)}
                  >
                    <p className="text-xs text-text-secondary line-clamp-3 leading-relaxed">
                      "{snippet.text}"
                    </p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-text-tertiary truncate max-w-[200px]">
                        {snippet.title}
                      </span>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-text-tertiary">
                          {new Date(snippet.createdAt).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric',
                          })}
                        </span>
                        <Tooltip content="Delete snippet">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(snippet.id); }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded
                                       text-text-tertiary hover:text-accent-danger
                                       hover:bg-accent-danger/10 transition-all cursor-pointer"
                          >
                            <IconTrash size={10} />
                          </button>
                        </Tooltip>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
