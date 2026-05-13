/* ============================================================
   HISTORY — Browsing history with sequential / graph toggle
   Scoped to the active session (branch).
   ============================================================ */

import { useEffect, useState, useCallback } from 'react';
import { useAppSelector } from '@/store/hooks';
import type { GraphNode } from '@/core/entities/Graph';
import { getGraphData } from '@/core/use-cases/graphBuilder';
import { BrowsingGraph } from './BrowsingGraph';
import { Badge } from '@/shared/ui/Badge';
import { IconGraph, IconListView, IconHistory, IconExternalLink } from '@/shared/ui/Icons';

// Category colors (match BrowsingGraph)
const CATEGORY_DOT: Record<string, string> = {
  tech:     'hsl(252, 87%, 68%)',
  docs:     'hsl(152, 68%, 52%)',
  social:   'hsl(38, 92%, 60%)',
  media:    'hsl(340, 82%, 62%)',
  shopping: 'hsl(0, 72%, 58%)',
  email:    'hsl(192, 90%, 56%)',
  other:    'hsl(220, 12%, 64%)',
};

type ViewMode = 'sequential' | 'graph';

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SequentialHistoryList({ branch }: { branch: string }) {
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getGraphData(branch).then((data) => {
      // Sort by lastVisit descending (most recent first)
      const sorted = [...data.nodes].sort((a, b) => b.lastVisit - a.lastVisit);
      setNodes(sorted);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [branch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-xs">
        Loading…
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary animate-fade-in">
        <IconHistory size={36} className="mb-4 opacity-30" />
        <h2 className="text-lg font-semibold text-text-primary">No history yet</h2>
        <p className="text-xs mt-1 text-center px-8">
          Browse the web and your visited pages will appear here.
        </p>
      </div>
    );
  }

  // Group by date
  const grouped = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const dateKey = new Date(node.lastVisit).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    const group = grouped.get(dateKey) ?? [];
    group.push(node);
    grouped.set(dateKey, group);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {Array.from(grouped.entries()).map(([date, items]) => (
        <div key={date}>
          {/* Date header */}
          <div className="sticky top-0 z-10 px-3 py-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider bg-surface-base/95 backdrop-blur-sm border-b border-border-subtle">
            {date}
          </div>

          {/* History items */}
          {items.map((node) => (
            <button
              key={node.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-hover transition-colors text-left group cursor-pointer border-b border-border-subtle/50"
              onClick={() => chrome.tabs.create({ url: node.id })}
            >
              {/* Category dot */}
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: CATEGORY_DOT[node.category] ?? CATEGORY_DOT.other }}
              />

              {/* Favicon */}
              {node.favicon ? (
                <img src={node.favicon} alt="" className="w-4 h-4 rounded shrink-0" />
              ) : (
                <span className="w-4 h-4 rounded bg-surface-overlay shrink-0" />
              )}

              {/* Title + URL */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-text-primary truncate">
                  {node.title || node.domain}
                </p>
                <p className="text-[10px] text-text-tertiary truncate">
                  {node.domain}
                </p>
              </div>

              {/* Metadata */}
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge variant={node.category === 'tech' ? 'info' : 'default'}>
                  {node.category}
                </Badge>
                <span className="text-[9px] text-text-tertiary whitespace-nowrap">
                  {formatRelativeTime(node.lastVisit)}
                </span>
                <IconExternalLink size={10} className="opacity-0 group-hover:opacity-60 transition-opacity text-text-tertiary" />
              </div>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function History() {
  const [viewMode, setViewMode] = useState<ViewMode>('sequential');
  const activeBranchName = useAppSelector((s) => s.branches.activeBranchName);

  const toggleMode = useCallback(() => {
    setViewMode((prev) => (prev === 'sequential' ? 'graph' : 'sequential'));
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header with toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <IconHistory size={14} className="text-text-tertiary" />
          <span className="text-xs font-medium text-text-primary">
            History
          </span>
          {activeBranchName && (
            <Badge variant="primary">{activeBranchName}</Badge>
          )}
        </div>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 bg-surface-overlay rounded-md p-0.5">
          <button
            onClick={() => setViewMode('sequential')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors cursor-pointer ${
              viewMode === 'sequential'
                ? 'bg-accent-primary/20 text-accent-primary font-medium'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
            title="Sequential list"
          >
            <IconListView size={12} />
            List
          </button>
          <button
            onClick={() => setViewMode('graph')}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors cursor-pointer ${
              viewMode === 'graph'
                ? 'bg-accent-primary/20 text-accent-primary font-medium'
                : 'text-text-tertiary hover:text-text-primary'
            }`}
            title="Graph view"
          >
            <IconGraph size={12} />
            Graph
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {viewMode === 'sequential' ? (
          <SequentialHistoryList branch={activeBranchName ?? '__no_branch__'} />
        ) : (
          <BrowsingGraph branch={activeBranchName ?? '__no_branch__'} />
        )}
      </div>
    </div>
  );
}
