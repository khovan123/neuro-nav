#!/usr/bin/env node
/* ============================================================
   NATIVE MESSAGING HOST — Chrome launches this via stdio
   
   Protocol: 4-byte little-endian length prefix + JSON payload
   
   Messages:
     { type: "START_DAEMON" }  → spawns nav-server as detached process
     { type: "PING" }          → responds with { ok: true }
   ============================================================ */

import { spawn, execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- Native Messaging I/O ----

function readMessage(): Promise<{ type: string; [key: string]: unknown } | null> {
  return new Promise((resolve) => {
    // Read 4-byte length header
    const headerBuf = Buffer.alloc(4);
    let headerRead = 0;

    const onReadable = () => {
      while (headerRead < 4) {
        const chunk = process.stdin.read(4 - headerRead);
        if (!chunk) return; // wait for more data
        chunk.copy(headerBuf, headerRead);
        headerRead += chunk.length;
      }

      process.stdin.removeListener('readable', onReadable);

      const msgLen = headerBuf.readUInt32LE(0);
      if (msgLen === 0 || msgLen > 1024 * 1024) {
        resolve(null);
        return;
      }

      // Read the JSON body
      let bodyRead = 0;
      const bodyBuf = Buffer.alloc(msgLen);

      const onBodyReadable = () => {
        while (bodyRead < msgLen) {
          const chunk = process.stdin.read(msgLen - bodyRead);
          if (!chunk) return;
          chunk.copy(bodyBuf, bodyRead);
          bodyRead += chunk.length;
        }

        process.stdin.removeListener('readable', onBodyReadable);

        try {
          resolve(JSON.parse(bodyBuf.toString('utf-8')));
        } catch {
          resolve(null);
        }
      };

      process.stdin.on('readable', onBodyReadable);
      onBodyReadable();
    };

    process.stdin.on('readable', onReadable);
    onReadable();
  });
}

function sendMessage(msg: object): void {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// ---- Daemon Logic (reuses CLI's approach) ----

function findDaemonScript(): string | null {
  // Try Node module resolution first
  try {
    const serverPkg = fileURLToPath(import.meta.resolve('@neuro-nav/server'));
    const serverDir = dirname(serverPkg);
    const candidate = resolve(serverDir, 'dist/index.js');
    if (existsSync(candidate)) return candidate;
    if (existsSync(serverPkg) && serverPkg.endsWith('dist/index.js')) return serverPkg;
  } catch { /* not found */ }

  // Fallback: relative paths for monorepo
  const candidates = [
    resolve(__dirname, '../../nav-server/dist/index.js'),
    resolve(__dirname, '../../../packages/nav-server/dist/index.js'),
    resolve(__dirname, '../node_modules/@neuro-nav/server/dist/index.js'),
  ];
  return candidates.find(p => existsSync(p)) ?? null;
}

function isDaemonRunning(): Promise<boolean> {
  const httpUrl = process.env.NAV_HTTP ?? 'http://127.0.0.1:9498';
  return fetch(`${httpUrl}/status`)
    .then(r => r.ok)
    .catch(() => false);
}

async function startDaemon(): Promise<{ started: boolean; error?: string }> {
  // Already running?
  if (await isDaemonRunning()) {
    return { started: true };
  }

  const script = findDaemonScript();
  if (!script) {
    return { started: false, error: 'nav-server not found. Install @neuro-nav/server first.' };
  }

  const child = spawn('node', [script], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NAV_WS_PORT: '9500', NAV_HTTP_PORT: '9498' },
  });
  child.unref();

  // Wait up to 3 seconds for daemon to be ready
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isDaemonRunning()) {
      return { started: true };
    }
  }

  return { started: false, error: 'Daemon failed to start within 3 seconds' };
}

// ---- Main ----

async function main() {
  const msg = await readMessage();
  if (!msg) {
    sendMessage({ ok: false, error: 'Invalid message' });
    process.exit(0);
  }

  switch (msg.type) {
    case 'PING':
      sendMessage({ ok: true, type: 'PONG' });
      break;

    case 'START_DAEMON': {
      const result = await startDaemon();
      sendMessage({ ok: result.started, type: 'DAEMON_RESULT', ...result });
      break;
    }

    default:
      sendMessage({ ok: false, error: `Unknown message type: ${msg.type}` });
  }

  // Native messaging hosts should exit after responding
  process.exit(0);
}

main().catch((err) => {
  sendMessage({ ok: false, error: String(err) });
  process.exit(1);
});
