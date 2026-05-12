/* ============================================================
   WORKSPACES PAGE — Save, restore, export/import tab collections
   ============================================================ */

import { useEffect, useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setWorkspaces, addWorkspace, removeWorkspace } from '@/store';
import { fromChromeTab, toSnapshot } from '@/core/entities/Tab';
import { createWorkspace, type WorkspaceEntity } from '@/core/entities/Workspace';
import * as db from '@/infrastructure/db/database';
import { Button } from '@/shared/ui/Button';
import { Input } from '@/shared/ui/Input';
import { Badge } from '@/shared/ui/Badge';
import { Tooltip } from '@/shared/ui/Tooltip';
import { IconPlus, IconPlay, IconTrash, IconDownload, IconUpload, IconGrid, IconGlobe } from '@/shared/ui/Icons';
import type { ProjectContext } from '@/core/entities/ProjectContext';

export function Workspaces() {
  const dispatch = useAppDispatch();
  const { items: workspaces, loading } = useAppSelector((s) => s.workspaces);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [projectCtx, setProjectCtx] = useState<ProjectContext | null>(null);

  useEffect(() => {
    db.getAllWorkspaces().then((ws) => dispatch(setWorkspaces(ws)));
    // Load project context from chrome.storage
    chrome.storage.local.get('projectContext', (r) => {
      if (r.projectContext) setProjectCtx(r.projectContext);
    });
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.projectContext) {
        setProjectCtx(changes.projectContext.newValue ?? null);
      }
    };
    chrome.storage.local.onChanged.addListener(listener);
    return () => chrome.storage.local.onChanged.removeListener(listener);
  }, [dispatch]);

  const handleSave = useCallback(async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const chromeTabs = await chrome.tabs.query({ currentWindow: true });
      const snapshots = chromeTabs.map(fromChromeTab).map(toSnapshot);
      const ws = createWorkspace(newName.trim(), snapshots);
      await db.saveWorkspace(ws);
      dispatch(addWorkspace(ws));
      setNewName('');
    } finally {
      setSaving(false);
    }
  }, [newName, dispatch]);

  const handleRestore = useCallback(async (ws: WorkspaceEntity) => {
    const window = await chrome.windows.create({ focused: true });
    for (const tab of ws.tabs) {
      await chrome.tabs.create({ windowId: window.id, url: tab.url, pinned: tab.pinned });
    }
    if (window.tabs?.[0]?.id) chrome.tabs.remove(window.tabs[0].id);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await db.deleteWorkspace(id);
    dispatch(removeWorkspace(id));
  }, [dispatch]);

  const handleExport = useCallback((ws: WorkspaceEntity) => {
    const blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neuro-nav-${ws.name.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const ws = JSON.parse(text) as WorkspaceEntity;
      ws.id = crypto.randomUUID();
      ws.createdAt = Date.now();
      await db.saveWorkspace(ws);
      dispatch(addWorkspace(ws));
    };
    input.click();
  }, [dispatch]);

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 w-full rounded-lg" />)}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border-subtle space-y-2">
        <div className="flex items-center gap-2">
          <Input placeholder="Workspace name..." value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSave()} className="flex-1" id="workspace-name-input" />
          <Button variant="primary" size="sm" icon={<IconPlus size={14} />} loading={saving} disabled={!newName.trim()} onClick={handleSave} id="save-workspace-btn">Save</Button>
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" icon={<IconUpload size={13} />} onClick={handleImport} id="import-workspace-btn">Import</Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {/* Auto-workspace from project scan */}
        {projectCtx && (
          <div className="card-interactive p-3 animate-fade-in border-l-2 border-l-emerald-400" id="project-workspace-card">
            <div className="flex items-start gap-2.5">
              <span className="text-xl shrink-0 mt-0.5">📂</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text-primary truncate">{projectCtx.projectName}</h3>
                  {projectCtx.gitBranch && (
                    <Badge variant="info">{projectCtx.gitBranch}</Badge>
                  )}
                  <Badge variant="success">Local</Badge>
                </div>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  {projectCtx.totalFiles} files · {projectCtx.totalDirs} dirs · {projectCtx.techStack.length} techs
                </p>
              </div>
            </div>
            {/* Tech stack pills */}
            <div className="mt-2.5 flex flex-wrap gap-1">
              {projectCtx.techStack.map((tech) => (
                <Tooltip key={tech.name} content={`Open ${tech.name} docs`} position="bottom">
                  <button
                    onClick={() => chrome.tabs.create({ url: tech.docUrl })}
                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-hover text-text-secondary hover:bg-accent-primary/15 hover:text-accent-primary transition-colors cursor-pointer"
                  >
                    {tech.name}{tech.version ? ` ${tech.version}` : ''}
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5 border-t border-border-subtle pt-2.5">
              <Button
                variant="primary"
                size="sm"
                icon={<IconPlay size={12} />}
                onClick={() => {
                  for (const tech of projectCtx.techStack) {
                    if (tech.docUrl) chrome.tabs.create({ url: tech.docUrl });
                  }
                }}
              >Open All Docs</Button>
            </div>
          </div>
        )}

        {workspaces.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-text-tertiary">
            <IconGrid size={28} className="mb-3 opacity-30" />
            <p className="text-sm font-medium">No saved workspaces</p>
            <p className="text-xs mt-1">Save your current tabs to create one</p>
          </div>
        ) : (
          workspaces.map((ws, i) => (
            <div key={ws.id} className="card-interactive p-3 animate-fade-in" style={{ animationDelay: `${i * 60}ms` }} id={`workspace-card-${ws.id}`}>
              <div className="flex items-start gap-2.5">
                <span className="text-xl shrink-0 mt-0.5">{ws.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-text-primary truncate">{ws.name}</h3>
                    <Badge>{ws.tabs.length} tabs</Badge>
                  </div>
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    {new Date(ws.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1">
                {ws.tabs.slice(0, 5).map((tab, j) => (
                  <Tooltip key={j} content={tab.title} position="bottom">
                    <div className="w-5 h-5 rounded bg-surface-hover flex items-center justify-center overflow-hidden">
                      {tab.favIconUrl ? <img src={tab.favIconUrl} alt="" className="w-3.5 h-3.5" /> : <IconGlobe size={10} className="text-text-tertiary" />}
                    </div>
                  </Tooltip>
                ))}
                {ws.tabs.length > 5 && (
                  <div className="w-5 h-5 rounded bg-surface-hover flex items-center justify-center">
                    <span className="text-[9px] text-text-tertiary">+{ws.tabs.length - 5}</span>
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center gap-1.5 border-t border-border-subtle pt-2.5">
                <Button variant="primary" size="sm" icon={<IconPlay size={12} />} onClick={() => handleRestore(ws)}>Open</Button>
                <Button variant="ghost" size="sm" icon={<IconDownload size={12} />} onClick={() => handleExport(ws)}>Export</Button>
                <div className="flex-1" />
                <Button variant="danger" size="sm" icon={<IconTrash size={12} />} onClick={() => handleDelete(ws.id)}>Delete</Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
