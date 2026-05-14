/* ============================================================
   RTK STORE — Redux Toolkit store with slices
   ============================================================ */

import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { TabEntity } from '@/core/entities/Tab';
import type { WorkspaceEntity } from '@/core/entities/Workspace';
import type { BranchEntity } from '@/core/entities/Branch';
import type { StashEntry } from '@/core/use-cases/stashMemory';
import type { PeerInfo, SharedWorkspace } from '@/core/entities/Peer';
import type { ProjectContext } from '@/core/entities/ProjectContext';

// ---- Tabs Slice ----

export interface TabsState {
  items: TabEntity[];
  activeTabId: number | null;
  loading: boolean;
  lastUpdated: number;
}

const initialTabsState: TabsState = {
  items: [],
  activeTabId: null,
  loading: true,
  lastUpdated: 0,
};

const tabsSlice = createSlice({
  name: 'tabs',
  initialState: initialTabsState,
  reducers: {
    setTabs(state, action: PayloadAction<TabEntity[]>) {
      state.items = action.payload;
      state.loading = false;
      state.lastUpdated = Date.now();
    },
    setActiveTabId(state, action: PayloadAction<number | null>) {
      state.activeTabId = action.payload;
    },
    updateTab(state, action: PayloadAction<TabEntity>) {
      const idx = state.items.findIndex((t) => t.id === action.payload.id);
      if (idx >= 0) {
        state.items[idx] = action.payload;
      } else {
        state.items.push(action.payload);
      }
      state.lastUpdated = Date.now();
    },
    removeTab(state, action: PayloadAction<number>) {
      state.items = state.items.filter((t) => t.id !== action.payload);
      state.lastUpdated = Date.now();
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
  },
});

// ---- Workspaces Slice ----

export interface WorkspacesState {
  items: WorkspaceEntity[];
  loading: boolean;
}

const initialWorkspacesState: WorkspacesState = {
  items: [],
  loading: true,
};

const workspacesSlice = createSlice({
  name: 'workspaces',
  initialState: initialWorkspacesState,
  reducers: {
    setWorkspaces(state, action: PayloadAction<WorkspaceEntity[]>) {
      state.items = action.payload;
      state.loading = false;
    },
    addWorkspace(state, action: PayloadAction<WorkspaceEntity>) {
      state.items.push(action.payload);
    },
    removeWorkspace(state, action: PayloadAction<string>) {
      state.items = state.items.filter((w) => w.id !== action.payload);
    },
    updateWorkspace(state, action: PayloadAction<WorkspaceEntity>) {
      const idx = state.items.findIndex((w) => w.id === action.payload.id);
      if (idx >= 0) state.items[idx] = action.payload;
    },
  },
});

// ---- Branches Slice ----

export interface BranchesState {
  items: BranchEntity[];
  /** Per-window active branch: windowId -> branchName */
  activeBranchByWindow: Record<number, string>;
  /** Current window's active branch (set by popup on mount) */
  activeBranchName: string | null;
  /** The current window ID (set by popup on mount) */
  currentWindowId: number | null;
  loading: boolean;
}

const initialBranchesState: BranchesState = {
  items: [],
  activeBranchByWindow: {},
  activeBranchName: null,
  currentWindowId: null,
  loading: true,
};

const branchesSlice = createSlice({
  name: 'branches',
  initialState: initialBranchesState,
  reducers: {
    setBranches(state, action: PayloadAction<BranchEntity[]>) {
      state.items = action.payload;
      // Rebuild activeBranchByWindow from branch data
      const byWindow: Record<number, string> = {};
      for (const b of action.payload) {
        if (b.activeInWindows) {
          for (const wid of b.activeInWindows) {
            byWindow[wid] = b.name;
          }
        }
      }
      state.activeBranchByWindow = byWindow;
      // Update current window's active branch
      if (state.currentWindowId != null) {
        state.activeBranchName = byWindow[state.currentWindowId] ?? null;
      }
      state.loading = false;
    },
    addBranch(state, action: PayloadAction<BranchEntity>) {
      state.items.push(action.payload);
      if (action.payload.activeInWindows) {
        for (const wid of action.payload.activeInWindows) {
          state.activeBranchByWindow[wid] = action.payload.name;
        }
      }
      if (state.currentWindowId != null && action.payload.activeInWindows?.includes(state.currentWindowId)) {
        state.activeBranchName = action.payload.name;
      }
    },
    removeBranch(state, action: PayloadAction<string>) {
      state.items = state.items.filter((b) => b.id !== action.payload);
    },
    /** Set active branch for a specific window */
    setActiveBranchForWindow(state, action: PayloadAction<{ windowId: number; branchName: string }>) {
      const { windowId, branchName } = action.payload;
      state.activeBranchByWindow[windowId] = branchName;
      if (state.currentWindowId === windowId) {
        state.activeBranchName = branchName;
      }
    },
    /** Legacy compat — sets activeBranchName directly */
    setActiveBranch(state, action: PayloadAction<string>) {
      state.activeBranchName = action.payload;
      if (state.currentWindowId != null) {
        state.activeBranchByWindow[state.currentWindowId] = action.payload;
      }
    },
    /** Set the current window ID (called once on popup mount) */
    setCurrentWindowId(state, action: PayloadAction<number>) {
      state.currentWindowId = action.payload;
      state.activeBranchName = state.activeBranchByWindow[action.payload] ?? null;
    },
    updateBranchInStore(state, action: PayloadAction<BranchEntity>) {
      const idx = state.items.findIndex((b) => b.id === action.payload.id);
      if (idx >= 0) state.items[idx] = action.payload;
    },
  },
});

// ---- Stash Slice ----

export interface StashState {
  items: StashEntry[];
  loading: boolean;
}

const initialStashState: StashState = {
  items: [],
  loading: true,
};

const stashSlice = createSlice({
  name: 'stash',
  initialState: initialStashState,
  reducers: {
    setStashEntries(state, action: PayloadAction<StashEntry[]>) {
      state.items = action.payload;
      state.loading = false;
    },
    addStashEntry(state, action: PayloadAction<StashEntry>) {
      state.items.push(action.payload);
    },
    removeLatestStash(state) {
      state.items.pop();
    },
  },
});

// ---- Peers Slice (Phase 5) ----

export interface PeersState {
  myPeerId: string;
  myDisplayName: string;
  peers: PeerInfo[];
  incomingShares: SharedWorkspace[];
  initialized: boolean;
}

const initialPeersState: PeersState = {
  myPeerId: '',
  myDisplayName: '',
  peers: [],
  incomingShares: [],
  initialized: false,
};

const peersSlice = createSlice({
  name: 'peers',
  initialState: initialPeersState,
  reducers: {
    setMyPeerInfo(state, action: PayloadAction<{ peerId: string; displayName: string }>) {
      state.myPeerId = action.payload.peerId;
      state.myDisplayName = action.payload.displayName;
      state.initialized = true;
    },
    setPeers(state, action: PayloadAction<PeerInfo[]>) {
      state.peers = action.payload;
    },
    updatePeerStatus(state, action: PayloadAction<{ peerId: string; status: PeerInfo['status'] }>) {
      const peer = state.peers.find((p) => p.peerId === action.payload.peerId);
      if (peer) {
        peer.status = action.payload.status;
      } else {
        state.peers.push({
          peerId: action.payload.peerId,
          displayName: action.payload.peerId,
          status: action.payload.status,
        });
      }
    },
    removePeer(state, action: PayloadAction<string>) {
      state.peers = state.peers.filter((p) => p.peerId !== action.payload);
    },
    addIncomingShare(state, action: PayloadAction<SharedWorkspace>) {
      state.incomingShares.push(action.payload);
    },
    dismissIncomingShare(state, action: PayloadAction<number>) {
      state.incomingShares.splice(action.payload, 1);
    },
  },
});

// ---- Navigation Slice ----

export type NavPage = 'tabs' | 'workspaces' | 'branches' | 'graph' | 'history' | 'peers' | 'snippets' | 'settings';

export interface NavState {
  currentPage: NavPage;
}

const navSlice = createSlice({
  name: 'nav',
  initialState: { currentPage: 'tabs' } as NavState,
  reducers: {
    navigate(state, action: PayloadAction<NavPage>) {
      state.currentPage = action.payload;
      // Persist active page so it survives popup close/reopen
      chrome.storage.local.set({ neuroNavActivePage: action.payload }).catch(() => {});
    },
    restoreNav(state, action: PayloadAction<NavPage>) {
      state.currentPage = action.payload;
    },
  },
});

// ---- Project Slice (Phase 3 — Local Symbiosis) ----

export interface ProjectState {
  context: ProjectContext | null;
  daemonConnected: boolean;
}

const projectSlice = createSlice({
  name: 'project',
  initialState: { context: null, daemonConnected: false } as ProjectState,
  reducers: {
    setProjectContext(state, action: PayloadAction<ProjectContext>) {
      state.context = action.payload;
    },
    clearProjectContext(state) {
      state.context = null;
    },
    setDaemonConnected(state, action: PayloadAction<boolean>) {
      state.daemonConnected = action.payload;
    },
  },
});

// ---- AI Slice (Phase 4 — Vector Embeddings) ----

export type AiModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface AiState {
  modelStatus: AiModelStatus;
  loadProgress: number; // 0–100
  modelName: string;
}

const aiSlice = createSlice({
  name: 'ai',
  initialState: { modelStatus: 'idle', loadProgress: 0, modelName: '' } as AiState,
  reducers: {
    setAiModelStatus(state, action: PayloadAction<AiModelStatus>) {
      state.modelStatus = action.payload;
    },
    setAiLoadProgress(state, action: PayloadAction<{ progress: number; modelName?: string }>) {
      state.loadProgress = action.payload.progress;
      if (action.payload.modelName) state.modelName = action.payload.modelName;
      if (state.modelStatus !== 'loading') state.modelStatus = 'loading';
    },
  },
});

// ---- Store ----

export const store = configureStore({
  reducer: {
    tabs: tabsSlice.reducer,
    workspaces: workspacesSlice.reducer,
    branches: branchesSlice.reducer,
    stash: stashSlice.reducer,
    peers: peersSlice.reducer,
    nav: navSlice.reducer,
    project: projectSlice.reducer,
    ai: aiSlice.reducer,
  },
  devTools: process.env.NODE_ENV !== 'production',
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// Export actions
export const { setTabs, setActiveTabId, updateTab, removeTab, setLoading } = tabsSlice.actions;
export const { setWorkspaces, addWorkspace, removeWorkspace, updateWorkspace } = workspacesSlice.actions;
export const { setBranches, addBranch, removeBranch, setActiveBranch, setActiveBranchForWindow, setCurrentWindowId, updateBranchInStore } = branchesSlice.actions;
export const { setStashEntries, addStashEntry, removeLatestStash } = stashSlice.actions;
export const { setMyPeerInfo, setPeers, updatePeerStatus, removePeer, addIncomingShare, dismissIncomingShare } = peersSlice.actions;
export const { navigate, restoreNav } = navSlice.actions;
export const { setProjectContext, clearProjectContext, setDaemonConnected } = projectSlice.actions;
export const { setAiModelStatus, setAiLoadProgress } = aiSlice.actions;
