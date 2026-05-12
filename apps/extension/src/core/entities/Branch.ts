/* ============================================================
   BRANCH ENTITY — Git-inspired browser session branching (Phase 2)
   ============================================================ */

import type { TabSnapshot } from './Tab';

export interface BranchEntity {
  id: string;
  name: string;
  parentBranch: string | null;
  tabs: TabSnapshot[];
  isActive: boolean;
  /** Window IDs where this branch is currently checked out */
  activeInWindows: number[];
  createdAt: number;
  updatedAt: number;
}

export function createBranch(
  name: string,
  tabs: TabSnapshot[],
  parentBranch: string | null = null
): BranchEntity {
  return {
    id: crypto.randomUUID(),
    name,
    parentBranch,
    tabs,
    isActive: false,
    activeInWindows: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
