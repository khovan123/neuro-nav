# PRODUCT SPECIFICATION: NEURO-NAV (THE DEVELOPER'S MICRO-OS)

**Version:** 1.5.0
**Target Platform:** Chromium-based Browsers (Chrome, Edge) & Windows/WSL2 Environment
**Architecture Pattern:** Clean Architecture & Event-Driven Services

## 1. Narrative Charter Statement

Neuro-Nav is a Micro-OS integrated directly into the browser, designed specifically for software engineers. By combining version control paradigms (Git-flow), on-device artificial intelligence (ONNX Runtime WASM), and P2P networking (WebRTC), the project fundamentally solves context fragmentation when working with complex systems (such as microservices or nested repositories). All data is stored and computed 100% client-side, ensuring millisecond response times and absolute privacy.

---

## 2. System Architecture Design

The system follows Clean Architecture, separated into 4 distinct layers:

1. **Presentation Layer (UI/UX):** Built with ReactJS + Tailwind CSS v4. State managed via Redux Toolkit. Dark glassmorphism UI with micro-animations, responsive within a 380×540px popup.
2. **Background Processing (Service Worker):** Acts as Message Broker. Manages event queues, WebSocket daemon connection (exponential backoff), alarm scheduler, and Native Messaging bridge.
3. **Local Core Engine:**
   * *Embedding Pipeline:* Uses `@huggingface/transformers` + ONNX Runtime WASM (`all-MiniLM-L6-v2`) in a Web Worker via Offscreen Document, compliant with MV3 Service Worker constraints.
   * *Search Index:* Orama in-memory DB for full-text + semantic search (up to 5,000 pages).
   * *Graph Store:* IndexedDB stores the browsing graph (nodes, edges), with per-branch filtering support.
4. **External Interfaces:**
   * Local WebSocket Server `:9500` (realtime Extension ↔ CLI communication).
   * Local HTTP Server `:9498` (fallback REST API for CLI).
   * WebRTC Data Channels (serverless P2P synchronization).
   * Chrome Native Messaging API (auto-start daemon from extension).

---

## 3. Development Status & Roadmap

*Execution principle: Each Phase requires 100% Core Logic completion and a passing build before moving to the next Phase.*

### PHASE 1: THE FOUNDATION (Core Infrastructure & Session Management) — ✅ COMPLETE

* **1.1. Core Boilerplate & UI:** ReactJS + Tailwind CSS v4 (CSS-first config). Message Passing bridge between Popup ↔ Service Worker. Design system with HSL tokens, glassmorphism, micro-animations.
* **1.2. Active State Management:** Real-time tab tracking, IndexedDB persistence.
* **1.3. Smart Workspaces:** Save/restore tab sets as JSON. Export/Import workspaces.
* **1.4. Auto-Pruning:** Chrome Alarm cleans stale data every 24h.

### PHASE 2: VERSION CONTROL & TERMINAL (Git-flow & CLI Integration) — ✅ COMPLETE

* **2.1. Session Branching:** Checkout/switch browser branches. Each branch stores an independent tab snapshot. **Browsing graph is isolated per-branch.**
* **2.2. Stash & Pop Memory:** Freeze all tabs into temporary storage, restore them intact.
* **2.3. WebSocket Daemon (nav-server):** Port `:9500` (WS) + `:9498` (HTTP). Exponential backoff reconnection with HTTP probe to prevent `ERR_CONNECTION_REFUSED` console noise.
* **2.4. `nav` CLI Tool:** CLI auto-starts daemon, supports `checkout`, `branch`, `stash`, `search`, `scan`, `status`, `setup-native-host`.
* **2.5. Native Messaging:** Extension auto-spawns daemon via `com.neuronav.daemon` host manifest. Graceful fallback if host is not installed.

### PHASE 3: THE BRAIN (On-Device AI — Local Embedding) — ✅ COMPLETE

* **3.1. DOM Text Extraction:** Content script extracts content at `document_idle` via `requestIdleCallback`.
* **3.2. Local Vectorization (WASM):** `@huggingface/transformers` + ONNX Runtime WASM in a Web Worker, running through an Offscreen Document bridge (MV3 compliant). Model `all-MiniLM-L6-v2` (~22MB, cached in IndexedDB).
* **3.3. Semantic Command Palette:** `Cmd/Ctrl + K` opens the search overlay. Orama in-memory DB for semantic search. Chunk upsert uses direct ID-based removal (avoids full-text search to prevent duplicates).
* **3.4. Auto-Tagging:** Automatic page classification (`tech`, `docs`, `social`, `media`, `shopping`, `email`).

### PHASE 4: TELEMETRY & VISUALIZATION — ✅ COMPLETE

* **4.1. Browsing Graph:** D3.js force-directed graph. Convex hull clustering by domain. **Graph nodes are recorded and filtered by the current branch** — each branch has its own browsing map.
* **4.2. Score Algorithm:** `log(visits) × recency × log(linkCount)` — more important nodes render larger.
* **4.3. Category Legend:** Color-coded with an HSL palette for each category (tech, docs, social, media...).

### PHASE 5: SYMBIOTIC ENVIRONMENT (P2P & Ecosystem) — ✅ COMPLETE

* **5.1. P2P WebRTC Sync:** PeerJS-based handshake. Send/receive Workspace JSON via WebRTC Data Channels. No intermediary server.
* **5.2. Project Auto-Discovery:** `nav scan [path] [--watch]` scans `package.json`, `.git`, and detects tech stack.

### PHASE 6: BUILD & PRODUCTION OPTIMIZATION — ✅ COMPLETE

* **6.1. Minified Builds:** Vite build with `minify: true`, reducing ~60% bundle size (JS ~3.3MB → ~1.4MB).
* **6.2. Source Maps:** Enabled for debugging.
* **6.3. Chunk Size Management:** Warning limit set to 1000KB for the embedding worker (~870KB, ML library).
* **6.4. Quiet Transformers Plugin:** Custom Vite plugin converts `console.warn` → `console.log` for HuggingFace library noise.
* **6.5. Native Tooltips:** Uses `title` attribute instead of CSS tooltips to avoid clipping by the popup viewport boundary.

### PHASE 7: TAB LIFECYCLE & UX POLISH — ✅ COMPLETE

* **7.1. Collapse/Expand Checkout:** Session switching uses `chrome.tabGroups.update({ collapsed: true })` + `chrome.tabs.discard()` instead of destructive tab removal. Groups stay visible on the tab bar while freeing RAM.
* **7.2. Auto-save Race Condition Protection:** `groupsBeingClosed` blocker set prevents the debounced auto-save from overwriting IndexedDB with empty arrays during group closure events.
* **7.3. Group-Aware Branch Detection:** Popup detects the active branch by querying the current tab's Chrome group title, not the stored window mapping — correct even when multiple groups coexist.
* **7.4. Persistent Navigation:** Last active nav page is saved to `chrome.storage.local` and restored on popup reopen.
* **7.5. Tab List Performance:** Debounced tab event listeners (200ms batching) and removed flash-clear (`setTabs([])`) to eliminate jitter in the Open Tabs list.
* **7.6. Web Map Consolidation:** Removed standalone "Web Map" nav item — browsing graph visualization is now embedded within the History page.

---

## 4. Technical Decisions

### 1. CLI Transport Mechanism (MV3 Sandbox)

**Decision: Companion WebSocket server**

The WebSocket server runs as a separate process (nav-server), not inside the Background Script. The CLI simply connects to `ws://127.0.0.1:9500`. The extension connects to the same daemon with exponential backoff (max 2 minutes) and a silent HTTP probe before opening the WebSocket.

### 2. P2P Signaling

**Decision: PeerJS Cloud**

Uses PeerJS Cloud for the initial handshake via a short Peer-ID. Actual data is transmitted P2P through WebRTC Data Channels, ensuring privacy.

### 3. AI Pipeline Architecture (MV3)

**Decision: Offscreen Document + Web Worker**

Service Workers cannot instantiate Web Workers directly. An Offscreen Document is used as a bridge, hosting the ONNX inference worker in a standard DOM context. Pipeline: Service Worker → Offscreen Document → Web Worker (ONNX Runtime WASM).

### 4. TailwindCSS Version

**Decision: TailwindCSS v4**

CSS-first config (no `tailwind.config.js` needed). Reduces bundle size and speeds up builds. Custom `@theme` block with HSL design tokens.

### 5. Bundle Size Strategy

**Decision: Minify + Accept ML overhead**

Extension bundle ~1.4MB JS (minified). WASM binary ~21.5MB (ONNX Runtime). This is the inherent cost of local ML — accepted to maintain the offline-first architecture. Lazy model loading on first embedding request.

### 6. Tab Group Lifecycle (Collapse vs Close)

**Decision: Collapse + Discard (non-destructive)**

Chrome Extension API has no programmatic equivalent to the UI's "Close Group" (which hides the group while preserving it). Using `chrome.tabs.remove()` destroys the group entirely. The adopted approach uses `chrome.tabGroups.update({ collapsed: true })` to minimize the group on the tab bar, followed by `chrome.tabs.discard()` on each tab to hibernate RAM. This preserves group identity, prevents data loss, and allows users to click the collapsed label to re-expand manually.

---
