#!/usr/bin/env node
/* ============================================================
   NAV-SERVER (nav-daemon) — Companion WebSocket + HTTP server
   Bridges CLI ↔ Chrome Extension on localhost
   
   Architecture:
     - WebSocket (port 9500): Persistent connection with Extension
     - HTTP      (port 9498): Quick-fire commands from CLI
   Auto-shuts down after 10 minutes of inactivity.
   ============================================================ */

import { loadEnv } from './loadEnv.js';
loadEnv();

import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import { resolve } from 'node:path';
import { scanProject, type ScanResult } from './scanner.js';
import { detectTechStack, type TechStackItem } from './techMapper.js';
import { startWatching, stopWatching } from './watcher.js';

const WS_PORT = parseInt(process.env.NAV_WS_PORT ?? '9500', 10);
const HTTP_PORT = parseInt(process.env.NAV_HTTP_PORT ?? '9498', 10);
const BIND_HOST = process.env.NAV_BIND_HOST ?? '0.0.0.0'; // 0.0.0.0 for WSL2→Windows access
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const SECRET_TOKEN = process.env.NAV_SECRET ?? 'neuro_nav_secure_token_2026';

interface NavMessage {
  source: 'cli' | 'extension';
  type: string;
  payload?: unknown;
  requestId?: string;
}

export interface ProjectContext {
  rootPath: string;
  projectName: string;
  gitBranch: string | null;
  techStack: TechStackItem[];
  fileTree: ScanResult['fileTree'];
  totalFiles: number;
  totalDirs: number;
  scannedAt: number;
}

// ---- Cached Project Context ----
let cachedProjectContext: ProjectContext | null = null;

async function performScan(projectPath: string): Promise<ProjectContext> {
  const absPath = resolve(projectPath);
  const [scanResult, techStack] = await Promise.all([
    scanProject(absPath),
    detectTechStack(absPath),
  ]);

  const ctx: ProjectContext = {
    rootPath: scanResult.rootPath,
    projectName: scanResult.projectName,
    gitBranch: scanResult.gitBranch,
    techStack,
    fileTree: scanResult.fileTree,
    totalFiles: scanResult.totalFiles,
    totalDirs: scanResult.totalDirs,
    scannedAt: Date.now(),
  };

  cachedProjectContext = ctx;

  // Start watching for changes (lazy init)
  startWatching(absPath, async () => {
    console.log('[nav-daemon] Re-scanning project after file change...');
    try {
      const updated = await performScan(absPath);
      // Push update to all connected extensions
      broadcast('extension', JSON.stringify({
        source: 'daemon',
        type: 'PROJECT_CONTEXT_UPDATE',
        payload: updated,
      }));
      console.log('[nav-daemon] Pushed PROJECT_CONTEXT_UPDATE to extension');
    } catch (err) {
      console.error('[nav-daemon] Re-scan failed:', err);
    }
  });

  return ctx;
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

// Track connected clients by role
const clients = {
  cli: new Set<WebSocket>(),
  extension: new Set<WebSocket>(),
};

function resetIdleTimer(wss: WebSocketServer) {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('[nav-daemon] Idle timeout — shutting down');
    wss.close(() => process.exit(0));
  }, IDLE_TIMEOUT_MS);
}

function broadcast(target: 'cli' | 'extension', data: string) {
  for (const client of clients[target]) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ---- WebSocket Server ----

const wss = new WebSocketServer({ port: WS_PORT, host: BIND_HOST });

wss.on('listening', () => {
  console.log(`[nav-daemon] WebSocket listening on ws://${BIND_HOST}:${WS_PORT}`);
  resetIdleTimer(wss);
});

wss.on('connection', (ws, req) => {
  // ---- Token Auth via Sec-WebSocket-Protocol ----
  const protocols = req.headers['sec-websocket-protocol'];
  const clientToken = protocols ? protocols.split(',')[0].trim() : '';
  if (clientToken !== SECRET_TOKEN) {
    console.warn(`[nav-daemon] ⛔ Unauthorized connection from: ${req.socket.remoteAddress}`);
    ws.close(1008, 'Unauthorized');
    return;
  }

  let role: 'cli' | 'extension' | null = null;

  ws.on('message', async (raw) => {
    resetIdleTimer(wss);

    let msg: NavMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }

    // First message must identify the client
    if (!role) {
      if (msg.source === 'cli' || msg.source === 'extension') {
        role = msg.source;
        clients[role].add(ws);
        console.log(`[nav-daemon] ${role} connected (total: cli=${clients.cli.size}, ext=${clients.extension.size})`);
        ws.send(JSON.stringify({ type: 'CONNECTED', role }));
        return;
      }
      ws.send(JSON.stringify({ error: 'First message must include source: "cli" | "extension"' }));
      return;
    }

    // Handle SCAN_PROJECT directly in daemon (not forwarded)
    if (msg.type === 'SCAN_PROJECT') {
      const { path: scanPath } = (msg.payload ?? {}) as { path?: string };
      if (!scanPath) {
        ws.send(JSON.stringify({
          source: 'daemon',
          type: 'RESPONSE',
          requestId: msg.requestId,
          success: false,
          error: 'Missing path in payload',
        }));
        return;
      }
      try {
        const ctx = await performScan(scanPath);
        ws.send(JSON.stringify({
          source: 'daemon',
          type: 'RESPONSE',
          requestId: msg.requestId,
          success: true,
          data: ctx,
        }));
        // Also push to all extension clients
        broadcast('extension', JSON.stringify({
          source: 'daemon',
          type: 'PROJECT_CONTEXT_UPDATE',
          payload: ctx,
        }));
      } catch (err) {
        ws.send(JSON.stringify({
          source: 'daemon',
          type: 'RESPONSE',
          requestId: msg.requestId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
      return;
    }

    // Route messages: CLI → Extension, Extension → CLI
    if (role === 'cli') {
      broadcast('extension', raw.toString());
    } else if (role === 'extension') {
      // Skip heartbeat — it's only for keeping the Service Worker alive
      if (msg.type === 'HEARTBEAT') return;
      broadcast('cli', raw.toString());
    }
  });

  ws.on('close', () => {
    if (role) {
      clients[role].delete(ws);
      console.log(`[nav-daemon] ${role} disconnected`);
    }
  });

  ws.on('error', (err) => {
    console.error('[nav-daemon] WebSocket error:', err.message);
  });
});

wss.on('error', (err) => {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.log(`[nav-daemon] Port ${WS_PORT} already in use — another instance may be running`);
    process.exit(0);
  }
  console.error('[nav-daemon] Server error:', err);
});

// ---- HTTP Server (for CLI quick-fire commands) ----

const httpServer = http.createServer((req, res) => {
  resetIdleTimer(wss);

  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /status — connection health check
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      connections: { cli: clients.cli.size, extension: clients.extension.size },
    }));
    return;
  }

  // POST /command — forward a command to the browser extension
  if (req.method === 'POST' && req.url === '/command') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed: { action: string; payload?: unknown };
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Invalid JSON' }));
        return;
      }

      const extensionClients = [...clients.extension].filter(c => c.readyState === WebSocket.OPEN);
      if (extensionClients.length === 0) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Browser extension not connected' }));
        return;
      }

      const msg = JSON.stringify({
        source: 'cli',
        type: parsed.action,
        payload: parsed.payload,
        requestId: crypto.randomUUID(),
      });

      for (const client of extensionClients) {
        client.send(msg);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'success', message: 'Command sent to browser' }));
    });
    return;
  }

  // GET /project — cached project context
  if (req.method === 'GET' && req.url === '/project') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: cachedProjectContext ? 'ok' : 'empty',
      data: cachedProjectContext,
    }));
    return;
  }

  // 404 fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'error', message: 'Not found' }));
});

httpServer.listen(HTTP_PORT, BIND_HOST, () => {
  console.log(`[nav-daemon] HTTP  listening on http://${BIND_HOST}:${HTTP_PORT}`);
});

// ---- Graceful Shutdown ----

process.on('SIGINT', () => {
  console.log('\n[nav-daemon] Shutting down...');
  stopWatching();
  httpServer.close();
  wss.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  stopWatching();
  httpServer.close();
  wss.close(() => process.exit(0));
});
