/* Zero-dependency .env loader — walks up from cwd to find .env */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export function loadEnv(): void {
  let dir = resolve(process.cwd());
  while (true) {
    const envPath = resolve(dir, '.env');
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!(key in process.env)) process.env[key] = value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}
