/* ============================================================
   SCANNER — Recursive directory scanner with .gitignore support
   Scans project directories for structure analysis.
   ============================================================ */

import { readdir, stat, readFile } from 'node:fs/promises';
import { join, basename, relative } from 'node:path';
import ignore, { type Ignore } from 'ignore';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileTreeNode[];
}

export interface ScanResult {
  projectName: string;
  rootPath: string;
  gitBranch: string | null;
  fileTree: FileTreeNode;
  totalFiles: number;
  totalDirs: number;
}

// Always ignore these regardless of .gitignore
const BUILTIN_IGNORES = [
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '.next', '.cache', '.turbo', '.nuxt', '.output',
  '__pycache__', '.venv', 'venv', '.tox',
  '.idea', '.vscode', '.DS_Store',
];

const MAX_DEPTH = 4;
const MAX_ENTRIES = 1000;

/**
 * Parse .gitignore file into an ignore instance.
 */
async function loadGitignore(rootPath: string): Promise<Ignore> {
  const ig = ignore();
  ig.add(BUILTIN_IGNORES);

  try {
    const content = await readFile(join(rootPath, '.gitignore'), 'utf-8');
    ig.add(content);
  } catch {
    // No .gitignore — that's fine
  }

  return ig;
}

/**
 * Read current git branch from .git/HEAD.
 */
export async function getGitBranch(rootPath: string): Promise<string | null> {
  try {
    const head = await readFile(join(rootPath, '.git', 'HEAD'), 'utf-8');
    const match = head.trim().match(/^ref: refs\/heads\/(.+)$/);
    return match ? match[1] : head.trim().slice(0, 8); // detached HEAD → short sha
  } catch {
    return null;
  }
}

/**
 * Recursively scan a directory tree.
 */
async function scanDir(
  dirPath: string,
  rootPath: string,
  ig: Ignore,
  depth: number,
  counter: { files: number; dirs: number },
): Promise<FileTreeNode[]> {
  if (depth > MAX_DEPTH || counter.files + counter.dirs >= MAX_ENTRIES) {
    return [];
  }

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return []; // Permission denied or similar
  }

  const children: FileTreeNode[] = [];

  // Sort: dirs first, then files, alphabetical
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  for (const entry of entries) {
    if (counter.files + counter.dirs >= MAX_ENTRIES) break;

    const relPath = relative(rootPath, join(dirPath, entry.name));

    // Check ignore patterns
    if (ig.ignores(relPath)) continue;

    if (entry.isDirectory()) {
      counter.dirs++;
      const subChildren = await scanDir(
        join(dirPath, entry.name),
        rootPath,
        ig,
        depth + 1,
        counter,
      );
      children.push({
        name: entry.name,
        path: relPath,
        type: 'dir',
        children: subChildren,
      });
    } else if (entry.isFile()) {
      counter.files++;
      children.push({
        name: entry.name,
        path: relPath,
        type: 'file',
      });
    }
  }

  return children;
}

/**
 * Scan a project directory and return structured result.
 */
export async function scanProject(rootPath: string): Promise<ScanResult> {
  // Verify path exists
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error(`Not a directory: ${rootPath}`);
  }

  const ig = await loadGitignore(rootPath);
  const gitBranch = await getGitBranch(rootPath);
  const counter = { files: 0, dirs: 0 };

  const children = await scanDir(rootPath, rootPath, ig, 0, counter);

  return {
    projectName: basename(rootPath),
    rootPath,
    gitBranch,
    fileTree: {
      name: basename(rootPath),
      path: '.',
      type: 'dir',
      children,
    },
    totalFiles: counter.files,
    totalDirs: counter.dirs,
  };
}
