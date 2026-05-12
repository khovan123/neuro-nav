#!/usr/bin/env node
/* ============================================================
   NAV-SERVER (nav-daemon) — Companion WebSocket + HTTP server
   Bridges CLI ↔ Chrome Extension on localhost
   
   Architecture:
     - WebSocket (port 9500): Persistent connection with Extension
     - HTTP      (port 9498): Quick-fire commands from CLI
   Auto-shuts down after 10 minutes of inactivity.
   ============================================================ */

import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';

const WS_PORT = parseInt(process.env.NAV_WS_PORT ?? '9500', 10);
const HTTP_PORT = parseInt(process.env.NAV_HTTP_PORT ?? '9498', 10);
const BIND_HOST = process.env.NAV_BIND_HOST ?? '0.0.0.0'; // 0.0.0.0 for WSL2→Windows access
const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

interface NavMessage {
  source: 'cli' | 'extension';
  type: string;
  payload?: unknown;
  requestId?: string;
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

wss.on('connection', (ws) => {
  let role: 'cli' | 'extension' | null = null;

  ws.on('message', (raw) => {
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
  httpServer.close();
  wss.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  httpServer.close();
  wss.close(() => process.exit(0));
});
