/* ============================================================
   PROJECT CONTEXT — Types for daemon-scanned project data
   ============================================================ */

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileTreeNode[];
}

export interface TechStackItem {
  name: string;
  version: string | null;
  category: 'framework' | 'database' | 'devtool' | 'runtime' | 'infra';
  docUrl: string;
}

export interface ProjectContext {
  rootPath: string;
  projectName: string;
  gitBranch: string | null;
  techStack: TechStackItem[];
  fileTree: FileTreeNode;
  totalFiles: number;
  totalDirs: number;
  scannedAt: number;
}
