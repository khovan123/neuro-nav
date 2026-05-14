# Neuro-Nav — Privacy Policy

**Last updated:** May 14, 2026

## Overview

Neuro-Nav is a Chrome Extension designed for software engineers to manage browser tabs, search browsing history semantically, and visualize browsing patterns. **All data processing happens entirely on your local device.**

## Data Collection

**Neuro-Nav does NOT collect, transmit, or store any personal data on external servers.**

### What data is processed locally

| Data Type | Purpose | Storage |
|---|---|---|
| Page URLs & Titles | Tab management, browsing graph, session branching | IndexedDB (local) |
| Page text content | AI-powered semantic search (vector embeddings) | IndexedDB (local) |
| Tab and window states | Session management (branch/stash/checkout) | IndexedDB (local) |
| Browsing navigation | Per-branch browsing graph visualization | IndexedDB (local) |

### AI Processing

Neuro-Nav uses the `all-MiniLM-L6-v2` AI model via ONNX Runtime WASM to generate text embeddings for semantic search. **This model runs entirely in your browser** — no data is sent to any cloud service or API.

## Permissions Justification

| Permission | Why it's needed |
|---|---|
| `tabs`, `windows` | Core functionality: managing tab sessions, branching, and window-scoped context |
| `<all_urls>` | Extracting page text content for local AI-powered semantic search |
| `storage`, `unlimitedStorage` | Storing sessions, browsing graph, and vector embeddings locally in IndexedDB |
| `offscreen` | Running AI inference (ONNX Runtime WASM) in a dedicated document, as required by Manifest V3 |
| `nativeMessaging` | Communicating with the optional local CLI daemon for terminal-based workflows |
| `scripting` | Injecting the content script that extracts page text for indexing |
| `webNavigation` | Tracking page navigation events for the browsing graph |
| `alarms` | Scheduling periodic cleanup of old data (every 24 hours) |
| `contextMenus` | Right-click menu integration for quick actions |

## P2P Communication

The optional Peer-to-Peer feature uses WebRTC (via PeerJS) to share workspace data directly between browsers. The PeerJS cloud server is used **only for the initial handshake** (exchanging connection metadata). All actual data transfer happens directly between peers.

## Local CLI Daemon

The optional CLI companion (`nav` command) communicates with the extension via a **local-only** WebSocket server on `127.0.0.1:9500`. No data leaves your machine.

## Third-Party Services

Neuro-Nav does **not** use any analytics, tracking, or telemetry services. The only external service used is:

- **PeerJS Cloud** (optional): Initial WebRTC signaling only. No user data is transmitted.

## Data Retention

All data is stored in your browser's local IndexedDB. You can clear all Neuro-Nav data at any time by:
1. Removing the extension from Chrome, or
2. Clearing site data for the extension in Chrome settings

An automatic pruning process runs every 24 hours to remove data older than 30 days.

## Contact

For questions about this privacy policy, please open an issue at:
https://github.com/khovan123/neuro-nav/issues

Or contact: minhpnq1807@gmail.com
