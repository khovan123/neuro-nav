/* ============================================================
   MANAGE BRANCHES — Use-cases for Git-inspired session branching
   Window-scoped: each branch can be active in multiple windows
   ============================================================ */

import type { BranchEntity } from '@/core/entities/Branch';
import { createBranch } from '@/core/entities/Branch';
import type { TabSnapshot } from '@/core/entities/Tab';
import * as db from '@/infrastructure/db/database';

/** List all branches. */
export async function listBranches(): Promise<BranchEntity[]> {
  return db.getAllBranches();
}

/** Get the currently active branch for a specific window, or null. */
export async function getActiveBranchForWindow(windowId: number): Promise<BranchEntity | null> {
  return (await db.getActiveBranchForWindow(windowId)) ?? null;
}

/** Get any active branch (legacy compat). */
export async function getActiveBranch(): Promise<BranchEntity | null> {
  return (await db.getActiveBranch()) ?? null;
}

/**
 * Create a new branch from the given tabs.
 * If `activate` is true, activates this branch in the given window.
 */
export async function createNewBranch(
  name: string,
  currentTabs: TabSnapshot[],
  activate = false,
  windowId?: number
): Promise<BranchEntity> {
  const existing = await db.getAllBranches();
  if (existing.some((b) => b.name === name)) {
    throw new Error(`Branch "${name}" already exists`);
  }

  const activeBranch = windowId
    ? existing.find((b) => b.activeInWindows?.includes(windowId))
    : existing.find((b) => b.isActive);
  const branch = createBranch(name, currentTabs, activeBranch?.name ?? null);

  if (activate && windowId) {
    // Deactivate current branch for this window
    if (activeBranch) {
      activeBranch.activeInWindows = (activeBranch.activeInWindows ?? []).filter((id) => id !== windowId);
      activeBranch.isActive = activeBranch.activeInWindows.length > 0;
      activeBranch.updatedAt = Date.now();
      await db.saveBranch(activeBranch);
    }
    branch.isActive = true;
    branch.activeInWindows = [windowId];
  }

  await db.saveBranch(branch);
  return branch;
}

/**
 * Checkout a branch by name for a specific window.
 * Saves the current tabs into the previous branch, then restores the target branch's tabs.
 */
export async function checkoutBranch(
  targetName: string,
  currentTabs: TabSnapshot[],
  windowId?: number
): Promise<{ branch: BranchEntity; tabsToOpen: TabSnapshot[] }> {
  const branches = await db.getAllBranches();
  const target = branches.find((b) => b.name === targetName);
  if (!target) {
    throw new Error(`Branch "${targetName}" not found`);
  }

  // If already active in this window, just return
  if (windowId && target.activeInWindows?.includes(windowId)) {
    return { branch: target, tabsToOpen: target.tabs };
  }

  // Save current tabs to the branch currently active in this window
  const activeBranch = windowId
    ? branches.find((b) => b.activeInWindows?.includes(windowId))
    : branches.find((b) => b.isActive);

  if (activeBranch) {
    activeBranch.tabs = currentTabs;
    if (windowId) {
      activeBranch.activeInWindows = (activeBranch.activeInWindows ?? []).filter((id) => id !== windowId);
      activeBranch.isActive = activeBranch.activeInWindows.length > 0;
    } else {
      activeBranch.isActive = false;
    }
    activeBranch.updatedAt = Date.now();
    await db.saveBranch(activeBranch);
  }

  // Activate the target in this window
  if (windowId) {
    if (!target.activeInWindows) target.activeInWindows = [];
    if (!target.activeInWindows.includes(windowId)) {
      target.activeInWindows.push(windowId);
    }
  }
  target.isActive = true;
  target.updatedAt = Date.now();
  await db.saveBranch(target);

  return { branch: target, tabsToOpen: target.tabs };
}

/**
 * Remove a window from a branch's activeInWindows when the window closes.
 */
export async function detachWindowFromBranch(windowId: number): Promise<void> {
  const branches = await db.getAllBranches();
  for (const branch of branches) {
    if (branch.activeInWindows?.includes(windowId)) {
      branch.activeInWindows = branch.activeInWindows.filter((id) => id !== windowId);
      branch.isActive = branch.activeInWindows.length > 0;
      branch.updatedAt = Date.now();
      await db.saveBranch(branch);
      console.log(`[Neuro-Nav] Detached window ${windowId} from branch ${branch.name}`);
    }
  }
}

/** Delete a branch by ID. Cannot delete if active in any window. */
export async function deleteBranchById(id: string): Promise<void> {
  const branch = (await db.getAllBranches()).find((b) => b.id === id);
  if (!branch) return;
  if (branch.activeInWindows?.length > 0) {
    throw new Error('Cannot delete a branch that is active in a window');
  }
  await db.deleteBranch(id);
}

/** Rename a branch. */
export async function renameBranch(id: string, newName: string): Promise<BranchEntity> {
  const branches = await db.getAllBranches();
  const branch = branches.find((b) => b.id === id);
  if (!branch) throw new Error('Branch not found');
  if (branches.some((b) => b.name === newName && b.id !== id)) {
    throw new Error(`Branch "${newName}" already exists`);
  }
  branch.name = newName;
  branch.updatedAt = Date.now();
  await db.saveBranch(branch);
  return branch;
}

/**
 * Sync the tab list of the active branch for a given window.
 * Re-snapshots all tabs currently open in that window and writes to DB.
 * Returns the updated branch, or null if no branch is active for the window.
 */
export async function syncBranchTabs(
  windowId: number,
  currentTabs: TabSnapshot[]
): Promise<BranchEntity | null> {
  const branch = await db.getActiveBranchForWindow(windowId);
  if (!branch) return null;

  branch.tabs = currentTabs;
  branch.updatedAt = Date.now();
  await db.saveBranch(branch);
  return branch;
}
