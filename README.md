<div align="right">
  <a href="README.md"><img alt="English" src="https://img.shields.io/badge/Language-English-blue?style=for-the-badge&logo=google-translate"></a>
  <a href="README-vi.md"><img alt="Tiếng Việt" src="https://img.shields.io/badge/Ngôn_ngữ-Tiếng_Việt-red?style=for-the-badge&logo=google-translate"></a>
</div>

<div align="center">
  <img src="./apps/extension/public/icons/icon-128.png" alt="Neuro-Nav Logo" width="128" />
  <h1>🧠 Neuro-Nav</h1>
  <p><strong>The Developer's Micro-OS: Context management, semantic search, and AI-powered browsing for software engineers.</strong></p>
  
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-v1.6.0-blue.svg" />
    <img alt="React" src="https://img.shields.io/badge/react-%2320232a.svg?style=flat&logo=react&logoColor=%2361DAFB" />
    <img alt="TailwindCSS" src="https://img.shields.io/badge/tailwindcss-%2338B2AC.svg?style=flat&logo=tailwind-css&logoColor=white" />
    <img alt="TypeScript" src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=flat&logo=typescript&logoColor=white" />
    <img alt="Vite" src="https://img.shields.io/badge/vite-%23646CFF.svg?style=flat&logo=vite&logoColor=white" />
    <img alt="ONNX" src="https://img.shields.io/badge/ONNX_Runtime-WASM-orange.svg" />
  </p>

  <p>
    <a href="#-introduction">Introduction</a> •
    <a href="#-core-features">Features</a> •
    <a href="#-architecture">Architecture</a> •
    <a href="#-installation-guide">Installation</a> •
    <a href="#-cli-bridge-nav-command">CLI</a>
  </p>
</div>

---

## 🌟 Introduction

**Neuro-Nav** is a next-generation Chrome Extension built specifically for Software Engineers, Researchers, and Power Users — those who face information fragmentation daily, open dozens of browser tabs simultaneously, and constantly lose their working context (context switching).

Neuro-Nav transforms your browser from a mere "web surfing window" into an **Intelligent Environment (Micro-OS)**. With fully on-device AI vector search, a spider-web graph mapping system, and Git-Flow style tab management, every document you read becomes a part of your "digital brain".

## 🏷️ Release Notes (v1.6.0)

- **Window-Scoped Architecture:** Complete removal of the `chrome.tabGroups` API. Each window is now a branch container ("1 Window = 1 Branch"). The database is the sole source of truth.
- **Deterministic Checkout:** New "Save-Clear-Inject" workflow replaces the old Collapse/Discard approach — saves current window state, opens target branch tabs, then closes old tabs atomically.
- **Session Rename:** Inline rename UI for sessions with duplicate-name validation and DB sync.
- **Simplified Permissions:** Removed `tabGroups` permission from the manifest.
- **Cleaned Settings:** Removed obsolete "Auto Sync with Browser" toggle (no longer applicable).
- **Persistent Navigation:** The popup remembers your last active page (Sessions, History, etc.) across close/reopen cycles.
- **Tab List Performance:** Debounced event listeners (200ms) and removal of flash-clear eliminate jitter in Open Tabs.
- **Web Map Consolidated:** Browsing graph visualization is now embedded within the History page — removed the standalone nav item.
- **Core Framework:** React 18, Vite, Tailwind CSS v4 (CSS-first config), and Manifest V3.
- **Git-flow Tabs:** Branching (`feat/*`, `chill/*`...), Stash & Pop, Workspace Management.
- **On-Device AI Search:** Local vector search using `all-MiniLM-L6-v2` via ONNX Runtime WASM. All inference runs on your machine — no cloud, no API keys.
- **Semantic Search:** Local search engine (Orama in-memory DB), indexing up to 5,000 pages via `Cmd+K`.
- **Per-Branch Graph:** 2D browsing telemetry mapping with D3.js — each branch maintains its own independent graph.
- **P2P Sync:** Serverless peer-to-peer Workspace synchronization via WebRTC (PeerJS).
- **CLI Bridge:** Terminal-first workflow with `nav` command, auto-daemon, and project scanning.
- **Native Messaging:** Auto-start the daemon from the Chrome extension via Chrome’s Native Messaging API.
- **Optimized Builds:** Minified production bundles (~1.4MB JS, ~60% size reduction).

## ✨ Core Features

### 1. 🔀 Git-Flow Tabs & Smart Workspaces
Instead of managing tabs manually, group them into workflows.
* **Workspace:** Save all tabs of a project (e.g., *Next.js docs, Supabase, Github*) into a JSON Workspace format. Easy to import/export.
* **Branching:** Use `nav checkout feat/auth` to save all current tabs and switch to a completely new set of tabs in just 1 click.
* **Stash & Pop:** Screen too messy? "Stash" (hide) all tabs into temporary memory for a clean screen, and "Pop" (restore) them intact when you need them.

### 2. 🧠 On-Device AI Search
Your data stays on your machine. Zero cloud dependency.
* **Vector Embeddings:** Pages are embedded using `all-MiniLM-L6-v2` running locally via ONNX Runtime WASM. No API keys or network access required.
* **DOM Extraction:** Extracts core text content at `document_idle` via `requestIdleCallback`. Eliminates ads and junk.
* **Keyword Search:** The Orama in-memory DB indexes up to 5,000 recent pages as a lightweight fallback.
* **Command Palette:** Press `Cmd/Ctrl + K` to open semantic search. Find pages by meaning, not just keywords.
* **Smart Upsert:** Chunk indexing uses direct ID-based removal to prevent duplicate entry errors during page re-crawls.

### 3. 🌐 Symbiotic Environment & P2P
* **WebRTC Peer-to-Peer:** Send entire JSON Workspaces to colleagues without any intermediary servers.
* **Intent Blocker:** On a coding branch (`feat/*`), the extension warns you if you accidentally navigate to distracting websites.

### 4. 🕸️ Per-Branch Browsing Graph
* Visualize your browsing history as an interactive 2D spider-web map (D3.js force-directed layout).
* **Branch-scoped:** Each branch maintains its own graph — nodes and edges are recorded and filtered per-branch, so switching branches shows only the relevant browsing context.
* **Cluster visualization:** Convex hull grouping by domain with color-coded categories (tech, docs, social, media, shopping, email).
* **Scoring algorithm:** `log(visits) × recency × log(linkCount)` — more important pages appear as larger nodes.

### 5. 🖥️ Terminal-First Workflow
* **CLI Bridge:** Run `nav checkout`, `nav search`, `nav stash` directly from your terminal.
* **Auto-Daemon:** The background process starts and stops automatically — no manual management.
* **Native Messaging:** The extension can auto-start the daemon when it's not running, via Chrome's Native Messaging API.
* **Project Scan:** `nav scan .` detects your tech stack and syncs context to the extension.
* **Resilient Connection:** Exponential backoff (up to 2min) with HTTP probe before WebSocket initialization. No console noise when daemon is offline.

---

## 🏗️ Architecture

```
neuro-nav/
├── apps/
│   └── extension/              # Chrome Extension (React + Vite + Tailwind v4)
│       ├── src/
│       │   ├── background/     # Service Worker — message broker & alarm scheduler
│       │   ├── core/           # Domain entities & use-cases
│       │   ├── infrastructure/ # Database, search index, AI pipeline
│       │   ├── popup/          # React UI (pages, components)
│       │   └── shared/         # Messaging, UI primitives, utilities
│       ├── offscreen.html      # Offscreen Document for AI inference
│       └── public/             # Static assets, manifest.json
└── packages/
    ├── nav-server/             # WebSocket + HTTP daemon (:9500 / :9498)
    └── nav-cli/                # Terminal CLI (`nav` command)
        └── native-host.ts      # Chrome Native Messaging host
```

### AI Pipeline (Manifest V3 Compliant)

```
Service Worker           Offscreen Document         Web Worker
┌──────────────┐    ┌───────────────────┐    ┌─────────────────────┐
│ embeddings   │───▶│ offscreen.html    │───▶│ embedding.worker.ts │
│ Service      │    │ message bridge    │    │ ONNX Runtime WASM   │
│              │◀───│                   │◀───│ all-MiniLM-L6-v2    │
└──────────────┘    └───────────────────┘    └─────────────────────┘
```

> Service Workers cannot instantiate Web Workers directly. The Offscreen Document bridges this gap, hosting the ONNX inference worker in a standard DOM context.

### Build Output

| File | Size | Gzip | Content |
| :--- | :--- | :--- | :--- |
| `embedding-worker.js` | 870 KB | 228 KB | HuggingFace Transformers + ONNX bindings |
| `popup.js` | 247 KB | 74 KB | All popup pages & Redux store |
| `index.js` | 206 KB | 62 KB | React + ReactDOM shared chunk |
| `searchIndex.js` | 86 KB | 28 KB | Orama search engine |
| `background.js` | 25 KB | 8 KB | Service Worker |
| ONNX WASM | 21.5 MB | 5 MB | ML inference runtime (cached) |

---

## ⚖️ Pros & Cons

### ✅ Pros
* **100% Privacy & Offline:** All data (Vector DB, Tabs, History, Graph) is processed locally. AI model runs on-device via WASM — no cloud calls.
* **Optimized Bundle:** Extension JS is ~1.4MB minified (excluding WASM model). AI inference is offloaded to a dedicated worker thread.
* **Modern UX:** Dark "Tech/Neuro" design with glassmorphism, real-time status indicators, and keyboard-first workflows.
* **RAM Optimization:** Auto-pruning every 24h, intelligent indexing limits, and lazy model loading.
* **Branch-Scoped Context:** Browsing graphs, tab states, and workspaces are all isolated per-branch.

### ❌ Cons
* **Desktop Only:** Tab management and P2P features are not available on Mobile browsers.
* **Model Download:** First launch downloads the ~22MB ONNX model (cached in IndexedDB for subsequent launches).
* **No WebGPU LLM Yet:** On-device LLM chat (e.g., Phi-3) is planned but not yet shipped.

---

## 💻 Supported Platforms

| Platform | Status | Notes |
| :--- | :---: | :--- |
| **Google Chrome** | ✅ Perfect | 100% feature support (v114+). |
| **Microsoft Edge** | ✅ Good | Runs smoothly. Latest Edge Chromium recommended. |
| **Brave** | ✅ Good | Runs well, but P2P WebRTC might be blocked by Shields. |
| **Arc Browser** | ⚠️ Limited | `Cmd+K` shortcuts might conflict with Arc's defaults. |
| **Firefox / Safari** | ❌ Unsupported | Uses Chromium-specific APIs (Manifest V3, `chrome.offscreen`). |

---

## 🚀 Installation Guide

### 1. Extension

```bash
git clone https://github.com/neuro-nav/neuro-nav.git
cd neuro-nav
npm install
npm run build
```

Then load in Chrome:
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** → select `apps/extension/dist/`

### 2. CLI

```bash
# From source (monorepo):
npm run build:all
cd packages/nav-server && npm link
cd ../nav-cli && npm link @neuro-nav/server && npm link
```

After linking, the `nav` command is available globally.

### 3. Native Messaging (Auto-Start Daemon)

To let the extension auto-start the daemon:

```bash
# Find your extension ID at chrome://extensions
nav setup-native-host --extension-id=<your-extension-id>
```

This installs a Native Messaging host manifest so the extension can spawn the daemon on demand. Reload the extension after setup.

---

## 💡 Usage Guide

1. **Launch:** Click the Neuro-Nav icon on the Chrome toolbar or press `Ctrl+Shift+N` / `Cmd+Shift+N`.
2. **Save a Working Session:** In the **Sessions** tab, create a session (e.g., `feat/login-api`). The system bundles your current tabs into this session.
3. **AI Search:** Press `Cmd/Ctrl + K` to open the Command Palette. Type a semantic keyword to search across pages you've read.
4. **Browsing Graph:** Switch to the **History** tab to see a visual map and timeline of your browsing for the current session.
5. **P2P Sharing:** Switch to the **Team** tab, copy your ID, and share it with a colleague for direct workspace sync.

---

## 🖥️ CLI Bridge (`nav` command)

Control your browser from the terminal. The CLI automatically starts the background daemon — no manual setup required.

```
Terminal (nav-cli)  ── WebSocket ──→  nav-daemon (:9500)  ←── WebSocket ──  Chrome Extension
                    ── HTTP POST ──→  nav-daemon (:9498)
```

> **All communication is local-only** (`127.0.0.1`). No data leaves your machine.

### Command Reference

| Command | Description |
| :--- | :--- |
| `nav help` | Show all available commands |
| `nav init` | First-time setup (generate secret key) |
| `nav checkout <name>` | Switch to a browser session (shorthand) |
| `nav branch list` | List all saved sessions |
| `nav branch checkout <name>` | Switch to a session |
| `nav branch checkout <name> --new` | Create a new session and switch to it |
| `nav branch create <name>` | Create and activate a new session |
| `nav branch delete <id>` | Delete a session by ID |
| `nav branch rename <id> <new>` | Rename a session |
| `nav workspace list` | List all saved workspaces |
| `nav stash` | Stash current tabs to temporary memory |
| `nav stash pop` | Restore the most recent stash |
| `nav stash list` | List all stash entries |
| `nav search <query>` | Search across indexed pages |
| `nav scan [path] [--watch]` | Scan project directory for tech stack |
| `nav status` | Check daemon & extension connection health |
| `nav ping` | Quick connection test |
| `nav setup-native-host` | Install Chrome Native Messaging host |

### Examples

```bash
# Switch browser context to a feature session
nav checkout feat/auth-system

# Save current tabs and start fresh
nav stash
nav branch create feat/new-api

# Search for a page you read last week
nav search "kubernetes helm values"

# Scan your project for tech stack detection
nav scan . --watch

# Check if everything is connected
nav status
# → Server:    ● Running
# → Extension: ● Connected

# Set up auto-start for the daemon
nav setup-native-host --extension-id=abcdef1234567890
```

### Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `NAV_SERVER` | `ws://127.0.0.1:9500` | WebSocket URL for nav-daemon |
| `NAV_HTTP` | `http://127.0.0.1:9498` | HTTP URL for nav-daemon |
| `NAV_SECRET` | *(default token)* | Authentication token for daemon |

### How It Works

1. You run `nav checkout feat/auth` in your terminal.
2. The CLI tries to connect to the WebSocket daemon. If the daemon isn't running, the CLI **automatically spawns it** in the background.
3. The daemon relays the command to the Chrome Extension's Service Worker.
4. The extension saves your current tabs, opens the session's saved tabs, and sends a success response back through the same channel.
5. The daemon auto-shuts down after **10 minutes** of inactivity to save resources.

---

<div align="center">
  <sub>Designed with 💜 for the builders of tomorrow.</sub>
</div>
