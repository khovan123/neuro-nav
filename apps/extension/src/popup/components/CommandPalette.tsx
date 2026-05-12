/* ============================================================
   COMMAND PALETTE — Cmd/Ctrl+K semantic search overlay
   ============================================================ */

import { useState, useEffect, useCallback, useRef } from 'react';
import { searchPages, getIndexCount, type SearchResult } from '@/infrastructure/search/searchIndex';
import { Badge, type BadgeVariant } from '@/shared/ui/Badge';
import { IconSearch, IconClose, IconMonitor, IconFileText, IconMessageCircle, IconFilm, IconShoppingCart, IconMail, IconGlobe } from '@/shared/ui/Icons';

const CATEGORY_COLORS: Record<string, BadgeVariant> = {
  tech: 'info',
  docs: 'success',
  social: 'warning',
  media: 'warning',
  shopping: 'danger',
  email: 'info',
  other: 'default',
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  tech: <IconMonitor size={14} />,
  docs: <IconFileText size={14} />,
  social: <IconMessageCircle size={14} />,
  media: <IconFilm size={14} />,
  shopping: <IconShoppingCart size={14} />,
  email: <IconMail size={14} />,
  other: <IconGlobe size={14} />,
};

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [indexCount, setIndexCount] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
      getIndexCount().then(setIndexCount).catch(() => {});
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const hits = await searchPages(query, 8);
        setResults(hits);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIndex] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      e.preventDefault();
      navigateToResult(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }, [results, selectedIndex, onClose]);

  const navigateToResult = useCallback((result: SearchResult) => {
    // Try to find existing tab with this URL
    chrome.tabs.query({ url: result.url }, (tabs) => {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId) {
          chrome.windows.update(tabs[0].windowId, { focused: true });
        }
      } else {
        chrome.tabs.create({ url: result.url });
      }
    });
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15%]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in" />

      {/* Palette */}
      <div
        className="relative w-[340px] bg-surface-raised border border-border-subtle rounded-xl shadow-2xl overflow-hidden animate-slide-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-subtle">
          <IconSearch size={16} className={searching ? 'text-accent-primary animate-pulse' : 'text-text-tertiary'} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search your browsing history..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary outline-none"
            id="command-palette-input"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-surface-overlay transition-colors cursor-pointer"
          >
            <IconClose size={14} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto">
          {query && results.length === 0 && !searching && (
            <div className="px-4 py-8 text-center text-text-tertiary">
              <p className="text-xs">No results for "{query}"</p>
              <p className="text-[10px] mt-1">{indexCount} pages indexed</p>
            </div>
          )}

          {(() => {
            const maxScore = Math.max(...results.map(r => r.score), 1);
            return results.map((result, i) => (
            <button
              key={result.url}
              className={[
                'w-full text-left px-3 py-2.5 flex items-start gap-2.5',
                'transition-colors duration-(--duration-fast) cursor-pointer',
                i === selectedIndex
                  ? 'bg-accent-primary/10'
                  : 'hover:bg-surface-overlay',
              ].join(' ')}
              onClick={() => navigateToResult(result)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="text-sm mt-0.5 shrink-0">
                {CATEGORY_ICONS[result.category] ?? <IconGlobe size={14} />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-text-primary font-medium truncate block">
                    {result.title || 'Untitled'}
                  </span>
                  <Badge variant={CATEGORY_COLORS[result.category] ?? 'info'} className="shrink-0">
                    {result.category}
                  </Badge>
                </div>
                <span className="text-[11px] text-text-tertiary truncate block mt-0.5">
                  {result.url.replace(/^https?:\/\//, '').slice(0, 60)}
                </span>
                {result.description && (
                  <span className="text-[10px] text-text-tertiary/70 truncate block mt-0.5">
                    {result.description.slice(0, 80)}
                  </span>
                )}
              </div>
              <span className="text-[10px] text-text-tertiary font-mono shrink-0 mt-0.5">
                {Math.round((result.score / maxScore) * 100)}%
              </span>
            </button>
            ));
          })()}
        </div>

        {/* Footer */}
        <div className="px-3 py-1.5 border-t border-border-subtle flex items-center justify-between">
          <span className="text-[10px] text-text-tertiary">
            {indexCount} pages indexed
          </span>
          <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>esc close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
