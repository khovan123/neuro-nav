#!/usr/bin/env node
/* ============================================================
   NAV-CLI — Terminal interface for Neuro-Nav
   Usage: nav <command> [args]

   Supports two communication modes:
     1. WebSocket (default): Persistent two-way via nav-daemon
     2. HTTP fallback: Quick POST to nav-daemon /command endpoint
   ============================================================ */

import WebSocket from 'ws';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const SERVER_URL = process.env.NAV_SERVER ?? 'ws://127.0.0.1:9500';
const HTTP_URL = process.env.NAV_HTTP ?? 'http://127.0.0.1:9498';
const RESPONSE_TIMEOUT_MS = 10_000;

// ---- Colors (ANSI escape codes — no dependency) ----

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

// ---- Auto-spawn daemon ----

function findDaemonScript(): string | null {
  // Try Node module resolution first (works for npm install -g @neuro-nav/cli)
  try {
    const serverPkg = fileURLToPath(import.meta.resolve('@neuro-nav/server'));
    const serverDir = dirname(serverPkg);
    const candidate = resolve(serverDir, 'dist/index.js');
    if (existsSync(candidate)) return candidate;
    // If the resolved path IS the dist file directly
    if (existsSync(serverPkg) && serverPkg.endsWith('dist/index.js')) return serverPkg;
  } catch {
    // Module not found — fall through to manual resolution
  }

  // Fallback: relative paths for monorepo development
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(__dirname, '../../nav-server/dist/index.js'),
    resolve(__dirname, '../../../packages/nav-server/dist/index.js'),
    resolve(__dirname, '../node_modules/@neuro-nav/server/dist/index.js'),
  ];
  return candidates.find(p => existsSync(p)) ?? null;
}

function isDaemonRunning(): Promise<boolean> {
  return fetch(`${HTTP_URL}/status`)
    .then(r => r.ok)
    .catch(() => false);
}

async function ensureDaemonRunning(): Promise<boolean> {
  if (await isDaemonRunning()) return true;

  const script = findDaemonScript();
  if (!script) {
    console.log(`${c.yellow}⚠ nav-daemon not found. Install @neuro-nav/server first.${c.reset}`);
    return false;
  }

  console.log(`${c.dim}Starting nav-daemon in background...${c.reset}`);
  const child = spawn('node', [script], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NAV_WS_PORT: '9500', NAV_HTTP_PORT: '9498' },
  });
  child.unref();

  // Wait for daemon to be ready (max 3 seconds)
  for (let i = 0; i < 6; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isDaemonRunning()) {
      console.log(`${c.green}✓ nav-daemon started (PID ${child.pid})${c.reset}`);
      return true;
    }
  }

  console.log(`${c.red}✗ nav-daemon failed to start${c.reset}`);
  return false;
}

// ---- CLI Helpers ----

function logo() {
  console.log(`${c.magenta}${c.bold}⚡ Neuro-Nav CLI${c.reset} ${c.dim}v1.0.0${c.reset}`);
  console.log();
}

function usage() {
  logo();
  console.log(`${c.bold}USAGE${c.reset}`);
  console.log(`  nav <command> [args]`);
  console.log();
  console.log(`${c.bold}COMMANDS${c.reset}`);
  console.log(`  ${c.cyan}help${c.reset}                     Show this help message`);
  console.log(`  ${c.cyan}checkout <name>${c.reset}           Shorthand for branch checkout`);
  console.log(`  ${c.cyan}branch list${c.reset}              List all branches`);
  console.log(`  ${c.cyan}branch checkout <name>${c.reset}   Switch to a branch`);
  console.log(`  ${c.cyan}branch create <name>${c.reset}     Create and activate a new branch`);
  console.log(`  ${c.cyan}branch delete <id>${c.reset}       Delete a branch by ID`);
  console.log(`  ${c.cyan}workspace list${c.reset}           List saved workspaces`);
  console.log(`  ${c.cyan}stash${c.reset}                    Stash current tabs`);
  console.log(`  ${c.cyan}stash pop${c.reset}                Pop the latest stash`);
  console.log(`  ${c.cyan}stash list${c.reset}               List stash entries`);
  console.log(`  ${c.cyan}search <query>${c.reset}           Search indexed pages`);
  console.log(`  ${c.cyan}status${c.reset}                   Check daemon connection status`);
  console.log(`  ${c.cyan}ping${c.reset}                     Test connection`);
  console.log();
  console.log(`${c.bold}ENVIRONMENT${c.reset}`);
  console.log(`  NAV_SERVER    WebSocket URL (default: ${SERVER_URL})`);
  console.log(`  NAV_HTTP      HTTP URL      (default: ${HTTP_URL})`);
  console.log();
  console.log(`${c.bold}AUTO-DAEMON${c.reset}`);
  console.log(`  The daemon starts automatically when you run any command.`);
  console.log(`  It shuts down after 10 minutes of inactivity.`);
}

// ---- WebSocket Communication ----

function sendCommand(type: string, payload?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);
    let responded = false;

    const timeout = setTimeout(() => {
      if (!responded) {
        responded = true;
        ws.close();
        reject(new Error('Timeout waiting for response'));
      }
    }, RESPONSE_TIMEOUT_MS);

    ws.on('open', () => {
      // Identify as CLI
      ws.send(JSON.stringify({ source: 'cli', type: 'IDENTIFY' }));
    });

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      // Skip the CONNECTED ack, then send the actual command
      if (msg.type === 'CONNECTED') {
        ws.send(JSON.stringify({
          source: 'cli',
          type,
          payload,
          requestId: crypto.randomUUID(),
        }));
        return;
      }

      // This is the response from the extension
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        ws.close();
        resolve(msg);
      }
    });

    ws.on('error', (err) => {
      if (!responded) {
        responded = true;
        clearTimeout(timeout);
        reject(err);
      }
    });
  });
}

// ---- Command Handlers ----

async function handleBranch(args: string[]) {
  const sub = args[0];

  if (!sub || sub === 'list') {
    const res = await sendCommand('BRANCH_LIST') as { data?: Array<{ name: string; isActive: boolean; tabs: unknown[]; updatedAt: number }> };
    if (!res.data?.length) {
      console.log(`${c.dim}No branches${c.reset}`);
      return;
    }
    console.log(`${c.bold}Branches:${c.reset}`);
    for (const b of res.data) {
      const indicator = b.isActive ? `${c.green}● ` : `${c.dim}○ `;
      const active = b.isActive ? ` ${c.green}(active)${c.reset}` : '';
      console.log(`  ${indicator}${c.bold}${b.name}${c.reset}${active} — ${b.tabs.length} tabs`);
    }
    return;
  }

  if (sub === 'checkout') {
    const name = args[1];
    if (!name) { console.log(`${c.red}Usage: nav branch checkout <name>${c.reset}`); return; }
    await doCheckout(name);
    return;
  }

  if (sub === 'create') {
    const name = args[1];
    if (!name) { console.log(`${c.red}Usage: nav branch create <name>${c.reset}`); return; }
    console.log(`${c.cyan}Creating branch ${c.bold}${name}${c.reset}...`);
    const res = await sendCommand('BRANCH_CREATE', { name }) as { data?: { name: string } };
    console.log(`${c.green}✓ Created and activated ${c.bold}${res.data?.name}${c.reset}`);
    return;
  }

  if (sub === 'delete') {
    const id = args[1];
    if (!id) { console.log(`${c.red}Usage: nav branch delete <id>${c.reset}`); return; }
    await sendCommand('BRANCH_DELETE', { id });
    console.log(`${c.green}✓ Branch deleted${c.reset}`);
    return;
  }

  console.log(`${c.red}Unknown branch subcommand: ${sub}${c.reset}`);
}

async function doCheckout(name: string) {
  console.log(`${c.cyan}Checking out ${c.bold}${name}${c.reset}...`);
  const res = await sendCommand('BRANCH_CHECKOUT', { name }) as { data?: { name: string }; success?: boolean; error?: string };
  if (res.success === false) {
    console.log(`${c.red}✗ ${res.error ?? 'Checkout failed'}${c.reset}`);
    return;
  }
  console.log(`${c.green}✓ Switched to ${c.bold}${res.data?.name}${c.reset}`);
}

async function handleStash(args: string[]) {
  const sub = args[0];

  if (!sub) {
    console.log(`${c.cyan}Stashing current tabs...${c.reset}`);
    await sendCommand('STASH_PUSH');
    console.log(`${c.green}✓ Tabs stashed${c.reset}`);
    return;
  }

  if (sub === 'pop') {
    console.log(`${c.cyan}Popping stash...${c.reset}`);
    const res = await sendCommand('STASH_POP') as { success: boolean; error?: string };
    if (!res.success) {
      console.log(`${c.yellow}${res.error ?? 'Stash is empty'}${c.reset}`);
      return;
    }
    console.log(`${c.green}✓ Stash popped${c.reset}`);
    return;
  }

  if (sub === 'list') {
    const res = await sendCommand('STASH_LIST') as { data?: Array<{ id: number; tabs: unknown[]; createdAt: number }> };
    if (!res.data?.length) {
      console.log(`${c.dim}Stash is empty${c.reset}`);
      return;
    }
    console.log(`${c.bold}Stash (${res.data.length}):${c.reset}`);
    for (const entry of res.data) {
      const time = new Date(entry.createdAt).toLocaleString();
      console.log(`  ${c.dim}#${entry.id}${c.reset} — ${entry.tabs.length} tabs — ${c.dim}${time}${c.reset}`);
    }
    return;
  }

  console.log(`${c.red}Unknown stash subcommand: ${sub}${c.reset}`);
}

async function handleWorkspace(args: string[]) {
  const sub = args[0];
  if (!sub || sub === 'list') {
    const res = await sendCommand('WORKSPACE_LIST') as { data?: Array<{ name: string; tabs: unknown[] }> };
    if (!res.data?.length) {
      console.log(`${c.dim}No saved workspaces${c.reset}`);
      return;
    }
    console.log(`${c.bold}Workspaces:${c.reset}`);
    for (const ws of res.data) {
      console.log(`  ${c.cyan}${ws.name}${c.reset} — ${ws.tabs.length} tabs`);
    }
    return;
  }

  console.log(`${c.red}Unknown workspace subcommand: ${sub}${c.reset}`);
}

async function handleSearch(query: string) {
  if (!query) {
    console.log(`${c.red}Usage: nav search <query>${c.reset}`);
    return;
  }
  console.log(`${c.cyan}Searching: ${c.bold}${query}${c.reset}...`);
  const res = await sendCommand('SEARCH_PAGES', { query, limit: 10 }) as { data?: Array<{ title: string; url: string; score: number }> };
  if (!res.data?.length) {
    console.log(`${c.dim}No results${c.reset}`);
    return;
  }
  console.log(`${c.bold}Results (${res.data.length}):${c.reset}`);
  for (const r of res.data) {
    const score = (r.score * 100).toFixed(0);
    console.log(`  ${c.green}${score}%${c.reset} ${c.bold}${r.title}${c.reset}`);
    console.log(`       ${c.dim}${r.url}${c.reset}`);
  }
}

async function handleStatus() {
  try {
    const res = await fetch(`${HTTP_URL}/status`);
    const data = await res.json() as { status: string; connections: { cli: number; extension: number } };
    console.log(`${c.bold}Daemon Status:${c.reset}`);
    console.log(`  Server:    ${c.green}● Running${c.reset}`);
    console.log(`  Extension: ${data.connections.extension > 0 ? `${c.green}● Connected` : `${c.red}○ Disconnected`}${c.reset}`);
    console.log(`  CLI:       ${c.dim}${data.connections.cli} session(s)${c.reset}`);
  } catch {
    console.log(`${c.red}✗ nav-daemon is not running${c.reset}`);
    console.log(`  Start it: ${c.cyan}npx @neuro-nav/server${c.reset}`);
  }
}

// ---- Main ----

async function main(retried = false) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  try {
    switch (command) {
      // Shorthand: `nav checkout <name>`
      case 'checkout': {
        const name = args[1];
        if (!name) { console.log(`${c.red}Usage: nav checkout <name>${c.reset}`); return; }
        await doCheckout(name);
        break;
      }

      case 'branch':
        await handleBranch(args.slice(1));
        break;

      case 'stash':
        await handleStash(args.slice(1));
        break;

      case 'workspace':
        await handleWorkspace(args.slice(1));
        break;

      case 'search':
        await handleSearch(args.slice(1).join(' '));
        break;

      case 'status':
        await handleStatus();
        break;

      case 'ping':
        console.log(`${c.cyan}Pinging...${c.reset}`);
        await sendCommand('PING');
        console.log(`${c.green}✓ Connection OK${c.reset}`);
        break;

      default:
        console.log(`${c.red}Unknown command: ${command}${c.reset}`);
        console.log(`Run ${c.cyan}nav help${c.reset} for usage`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ECONNREFUSED') && !retried) {
      // Auto-spawn daemon and retry once
      const started = await ensureDaemonRunning();
      if (started) {
        console.log(`${c.dim}Retrying command...${c.reset}`);
        return main(true); // Retry once
      }
      console.log(`${c.red}✗ Cannot connect to nav-daemon at ${SERVER_URL}${c.reset}`);
    } else {
      console.error(`${c.red}Error: ${msg}${c.reset}`);
    }
    process.exit(1);
  }
}

main();
