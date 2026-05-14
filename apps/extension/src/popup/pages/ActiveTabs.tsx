/* ============================================================
   ACTIVE TABS PAGE — Live tab list with search/filter
   ============================================================ */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setTabs, setActiveTabId, removeTab } from '@/store';
import { fromChromeTab } from '@/core/entities/Tab';
import type { TabEntity } from '@/core/entities/Tab';
import { Input } from '@/shared/ui/Input';
import { Badge } from '@/shared/ui/Badge';
import { Tooltip } from '@/shared/ui/Tooltip';
import { IconSearch, IconX, IconPin, IconGlobe } from '@/shared/ui/Icons';

export function ActiveTabs() {
  const dispatch = useAppDispatch();
  const { items: tabs, loading } = useAppSelector((s) => s.tabs);
  const [search, setSearch] = useState('');

  // Fetch all tabs on mount
  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshTabs = () => {
      // Debounce: batch rapid tab events into one re-render (200ms)
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        chrome.tabs.query({}, (chromeTabs) => {
          dispatch(setTabs(chromeTabs.map(fromChromeTab)));
        });
      }, 200);
    };

    // Initial load (no debounce)
    chrome.tabs.query({}, (chromeTabs) => {
      dispatch(setTabs(chromeTabs.map(fromChromeTab)));
    });

    // Listen for meaningful tab changes — NO setTabs([]) flash
    const onUpdated = (_tabId: number, info: chrome.tabs.TabChangeInfo) => {
      // Only refresh on meaningful changes, not every loading/status event
      if (info.url || info.title || info.favIconUrl || info.pinned !== undefined) {
        refreshTabs();
      }
    };

    const onRemoved = (tabId: number) => {
      dispatch(removeTab(tabId));
    };

    const onCreated = () => {
      refreshTabs();
    };

    const onActivated = (info: chrome.tabs.TabActiveInfo) => {
      dispatch(setActiveTabId(info.tabId));
    };

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onActivated.addListener(onActivated);

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onActivated.removeListener(onActivated);
    };
  }, [dispatch]);

  // Group by windowId
  const grouped = useMemo(() => {
    const filtered = tabs.filter(
      (t) =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.url.toLowerCase().includes(search.toLowerCase())
    );

    const groups = new Map<number, TabEntity[]>();
    for (const tab of filtered) {
      const existing = groups.get(tab.windowId) ?? [];
      existing.push(tab);
      groups.set(tab.windowId, existing);
    }
    return groups;
  }, [tabs, search]);

  const handleActivate = useCallback((tab: TabEntity) => {
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
  }, []);

  const handleClose = useCallback(
    (tabId: number, e: React.MouseEvent) => {
      e.stopPropagation();
      chrome.tabs.remove(tabId);
      dispatch(removeTab(tabId));
    },
    [dispatch]
  );

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-3 border-b border-border-subtle">
        <Input
          icon={<IconSearch size={14} />}
          placeholder="Search tabs..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          id="tab-search-input"
        />
      </div>

      {/* Tab count */}
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          {tabs.length} tab{tabs.length !== 1 ? 's' : ''} across{' '}
          {new Set(tabs.map((t) => t.windowId)).size} window
          {new Set(tabs.map((t) => t.windowId)).size !== 1 ? 's' : ''}
        </span>
        {search && (
          <Badge variant="primary">{Array.from(grouped.values()).flat().length} matches</Badge>
        )}
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-4">
        {Array.from(grouped.entries()).map(([windowId, windowTabs], groupIdx) => (
          <div key={windowId} className="animate-fade-in" style={{ animationDelay: `${groupIdx * 50}ms` }}>
            <div className="px-2 py-1 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">
              Window {groupIdx + 1}
            </div>
            <div className="space-y-0.5">
              {windowTabs.map((tab, idx) => (
                <button
                  key={tab.id}
                  onClick={() => handleActivate(tab)}
                  className={[
                    'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg',
                    'text-left group cursor-pointer',
                    'transition-all duration-(--duration-fast)',
                    'hover:bg-surface-overlay',
                    tab.active ? 'bg-surface-overlay border border-border-subtle' : '',
                    'animate-slide-up',
                  ].join(' ')}
                  style={{ animationDelay: `${idx * 30}ms` }}
                  id={`tab-item-${tab.id}`}
                >
                  {/* Favicon */}
                  <div className="w-5 h-5 rounded shrink-0 flex items-center justify-center overflow-hidden bg-surface-hover">
                    {tab.favIconUrl ? (
                      <img src={tab.favIconUrl} alt="" className="w-4 h-4" />
                    ) : (
                      <IconGlobe size={12} className="text-text-tertiary" />
                    )}
                  </div>

                  {/* Title & URL */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-primary truncate leading-tight">
                      {tab.title}
                    </div>
                    <div className="text-[11px] text-text-tertiary truncate">
                      {tab.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)}
                    </div>
                  </div>

                  {/* Status indicators */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {tab.pinned && (
                      <Tooltip content="Pinned">
                        <IconPin size={12} className="text-accent-warning" />
                      </Tooltip>
                    )}
                    {tab.active && <div className="status-dot status-dot-active" />}
                  </div>

                  {/* Close button */}
                  <button
                    onClick={(e) => handleClose(tab.id, e)}
                    className={[
                      'p-1 rounded-md opacity-0 group-hover:opacity-100',
                      'text-text-tertiary hover:text-accent-danger hover:bg-accent-danger/10',
                      'transition-all duration-(--duration-fast)',
                      'cursor-pointer',
                    ].join(' ')}
                    aria-label={`Close tab: ${tab.title}`}
                    id={`close-tab-${tab.id}`}
                  >
                    <IconX size={12} />
                  </button>
                </button>
              ))}
            </div>
          </div>
        ))}

        {grouped.size === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
            <IconSearch size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No tabs found</p>
            <p className="text-xs mt-1">Try a different search term</p>
          </div>
        )}
      </div>
    </div>
  );
}
