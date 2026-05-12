#!/usr/bin/env node
/* ============================================================
   NAV-CLI — Terminal interface for Neuro-Nav
   Usage: nav <command> [args]

   Supports two communication modes:
     1. WebSocket (default): Persistent two-way via nav-daemon
     2. HTTP fallback: Quick POST to nav-daemon /command endpoint
   ============================================================ */

import { loadEnv } from './loadEnv.js';
loadEnv();

import WebSocket from 'ws';
import { spawn, execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { setupNativeHost } from './native-manifest.js';

const SERVER_URL = process.env.NAV_SERVER ?? 'ws://127.0.0.1:9500';
const HTTP_URL = process.env.NAV_HTTP ?? 'http://127.0.0.1:9498';
const SECRET_TOKEN = process.env.NAV_SECRET ?? 'neuro_nav_secure_token_2026';
const DEFAULT_TOKEN = 'neuro_nav_secure_token_2026';
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
  console.log(`  ${c.cyan}init${c.reset}                     First-time setup (generate secret key)`);
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
  console.log(`  ${c.cyan}scan [path] [--watch]${c.reset}     Scan project directory for tech stack`);
  console.log(`  ${c.cyan}status${c.reset}                   Check daemon connection status`);
  console.log(`  ${c.cyan}ping${c.reset}                     Test connection`);
  console.log(`  ${c.cyan}setup-native-host${c.reset}        Install Chrome Native Messaging host`);
  console.log(`                             ${c.dim}--extension-id=<id>${c.reset}`);
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
    const ws = new WebSocket(SERVER_URL, [SECRET_TOKEN]);
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
  const maxScore = Math.max(...res.data.map(r => r.score), 1);
  for (const r of res.data) {
    const relevance = Math.round((r.score / maxScore) * 100);
    console.log(`  ${c.green}${relevance}%${c.reset} ${c.bold}${r.title}${c.reset}`);
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

async function handleScan(args: string[]) {
  const watchMode = args.includes('--watch');
  const positionalArgs = args.filter((a) => !a.startsWith('--'));
  const targetPath = positionalArgs[0] || '.';
  const absolutePath = resolve(process.cwd(), targetPath);
  console.log(`${c.cyan}Scanning project: ${absolutePath}${c.reset}`);

  const res = await sendCommand('SCAN_PROJECT', { path: absolutePath, watch: watchMode }) as {
    success?: boolean;
    data?: {
      projectName: string;
      gitBranch: string | null;
      techStack: Array<{ name: string; version: string | null; category: string; docUrl: string }>;
      totalFiles: number;
      totalDirs: number;
    };
    error?: string;
  };

  if (!res.success || !res.data) {
    console.log(`${c.red}✗ Scan failed: ${res.error || 'Unknown error'}${c.reset}`);
    return;
  }

  printScanResult(res.data);

  if (watchMode) {
    console.log(`${c.cyan}👁  Watching for changes... (Ctrl+C to stop)${c.reset}`);
    // Keep CLI alive — daemon will push WATCH_UPDATE via WebSocket
    // The daemon re-scans and broadcasts PROJECT_CONTEXT_UPDATE to extension automatically
    process.on('SIGINT', () => {
      console.log(`\n${c.dim}Stopped watching.${c.reset}`);
      process.exit(0);
    });
    // Prevent Node from exiting
    setInterval(() => {}, 60_000);
  }
}

function printScanResult(data: {
  projectName: string;
  gitBranch: string | null;
  techStack: Array<{ name: string; version: string | null; category: string; docUrl: string }>;
  totalFiles: number;
  totalDirs: number;
}) {
  console.log();
  console.log(`${c.bold}📂 ${data.projectName}${c.reset}`);
  if (data.gitBranch) {
    console.log(`  Branch: ${c.magenta}${data.gitBranch}${c.reset}`);
  }
  console.log(`  Files:  ${data.totalFiles} files in ${data.totalDirs} directories`);
  console.log();

  if (data.techStack.length > 0) {
    console.log(`${c.bold}Tech Stack:${c.reset}`);
    for (const tech of data.techStack) {
      const version = tech.version ? ` ${c.dim}v${tech.version}${c.reset}` : '';
      const category = `${c.dim}[${tech.category}]${c.reset}`;
      console.log(`  ${c.green}●${c.reset} ${tech.name}${version} ${category}`);
      console.log(`    ${c.dim}${tech.docUrl}${c.reset}`);
    }
  } else {
    console.log(`${c.dim}No recognizable tech stack found${c.reset}`);
  }

  console.log();
  console.log(`${c.green}✓ Context synced to Chrome Extension${c.reset}`);
}

// ---- Init (First-time Setup) ----

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function findEnvPath(): string {
  // Walk up from cwd to find existing .env, or default to cwd
  let dir = resolve(process.cwd());
  while (true) {
    const envPath = resolve(dir, '.env');
    if (existsSync(envPath)) return envPath;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), '.env');
}

function generateToken(): string {
  try {
    return execSync('openssl rand -hex 32', { encoding: 'utf-8' }).trim();
  } catch {
    // Fallback: use Node crypto
    return Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}

async function handleInit() {
  logo();
  console.log(`${c.bold}🔐 Neuro-Nav Security Setup${c.reset}`);
  console.log();

  const envPath = findEnvPath();
  const envExists = existsSync(envPath);

  // Check if already configured
  if (envExists) {
    const content = readFileSync(envPath, 'utf-8');
    const match = content.match(/^NAV_SECRET=(.+)$/m);
    if (match && match[1] !== DEFAULT_TOKEN) {
      console.log(`${c.green}✓ NAV_SECRET already configured in:${c.reset} ${envPath}`);
      console.log();
      console.log(`${c.dim}Current token: ${match[1].slice(0, 8)}...${match[1].slice(-8)}${c.reset}`);
      console.log();
      const overwrite = await prompt(`${c.yellow}Generate a new token? (y/N): ${c.reset}`);
      if (overwrite.toLowerCase() !== 'y') {
        console.log(`${c.dim}Keeping existing configuration.${c.reset}`);
        return;
      }
    }
  }

  // Ask user: generate or paste?
  console.log(`  ${c.cyan}1${c.reset}) Auto-generate a new token (recommended)`);
  console.log(`  ${c.cyan}2${c.reset}) Enter token manually`);
  console.log();
  const choice = await prompt(`${c.bold}Choose [1/2]: ${c.reset}`);

  let token: string;
  if (choice === '2') {
    token = await prompt(`${c.bold}Enter Secret Key (min 8 characters): ${c.reset}`);
    if (token.length < 8) {
      console.log(`${c.red}✗ Token must be at least 8 characters${c.reset}`);
      return;
    }
  } else {
    token = generateToken();
    console.log(`${c.green}✓ New token generated${c.reset}`);
  }

  // Write/update .env
  let envContent = '';
  if (envExists) {
    envContent = readFileSync(envPath, 'utf-8');
    if (envContent.match(/^NAV_SECRET=.+$/m)) {
      envContent = envContent.replace(/^NAV_SECRET=.+$/m, `NAV_SECRET=${token}`);
    } else {
      envContent = envContent.trimEnd() + `\nNAV_SECRET=${token}\n`;
    }
  } else {
    envContent = [
      '# ============================================================',
      '# NEURO-NAV — Environment Configuration',
      '# ============================================================',
      '',
      `NAV_SECRET=${token}`,
      'NAV_WS_PORT=9500',
      'NAV_HTTP_PORT=9498',
      'NAV_BIND_HOST=0.0.0.0',
      '',
    ].join('\n');
  }

  writeFileSync(envPath, envContent, 'utf-8');

  console.log();
  console.log(`${c.green}✓ Saved to:${c.reset} ${envPath}`);
  console.log();
  console.log(`${c.bold}📋 Next step:${c.reset}`);
  console.log(`  Open Chrome Extension → Neuro-Nav Popup`);
  console.log(`  Paste this token into the ${c.cyan}Secret Key${c.reset} field:`);
  console.log();
  console.log(`  ${c.yellow}${c.bold}${token}${c.reset}`);
  console.log();
  console.log(`${c.dim}(Token is shown only once. Save it if needed.)${c.reset}`);
}

function checkSecretGuard(command: string): boolean {
  // These commands don't need the daemon
  const skipGuard = ['help', '--help', '-h', 'init'];
  if (skipGuard.includes(command)) return true;

  if (SECRET_TOKEN === DEFAULT_TOKEN) {
    console.log(`${c.yellow}⚠ Using default Secret Key (insecure)${c.reset}`);
    console.log(`  Run ${c.cyan}nav init${c.reset} to set up a secure key.`);
    console.log();
  }
  return true;
}

// ---- Main ----

async function main(retried = false) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    usage();
    return;
  }

  // First-time setup
  if (command === 'init') {
    await handleInit();
    return;
  }

  // Native Messaging host setup (no daemon needed)
  if (command === 'setup-native-host') {
    const idArg = args.find(a => a.startsWith('--extension-id='));
    const extensionId = idArg?.split('=')[1];
    if (!extensionId) {
      console.log(`${c.red}✗ Extension ID required${c.reset}`);
      console.log(`  ${c.dim}Find it at chrome://extensions (the ID under Neuro-Nav)${c.reset}`);
      console.log(`  ${c.cyan}nav setup-native-host --extension-id=<id>${c.reset}`);
      return;
    }
    const result = setupNativeHost({ extensionId });
    if (result.success) {
      console.log(`${c.green}✓ Native Messaging host installed${c.reset}`);
      console.log(`  ${c.dim}Manifest: ${result.manifestPath}${c.reset}`);
      console.log();
      console.log(`  ${c.bold}Next:${c.reset} Reload the extension at ${c.cyan}chrome://extensions${c.reset}`);
      console.log(`  The daemon will now auto-start when the extension needs it.`);
    } else {
      console.log(`${c.red}✗ ${result.error}${c.reset}`);
    }
    return;
  }

  // Warn if using default insecure token
  checkSecretGuard(command);

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

      case 'scan':
        await handleScan(args.slice(1));
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
