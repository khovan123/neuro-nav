/* ============================================================
   GRAPH ENTITIES — Nodes and edges for the browsing graph
   ============================================================ */

export interface GraphNode {
  /** URL is the unique key */
  id: string;
  title: string;
  favicon: string;
  category: string;
  /** Domain extracted from URL */
  domain: string;
  /** Visit count */
  visits: number;
  /** Last visit timestamp */
  lastVisit: number;
  /** Computed score (frequency × recency × link density) */
  score: number;
  /** Cluster ID (domain-based) */
  cluster: string;
  /** Branch this page was visited in */
  branch?: string;
}

export interface GraphEdge {
  /** Source page URL */
  source: string;
  /** Target page URL */
  target: string;
  /** Number of times this transition occurred */
  weight: number;
  /** Last transition timestamp */
  lastTransition: number;
}

/** Extract domain from URL. */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Score a page node. Higher = more important.
 * Formula: log(visits+1) × recencyMultiplier × log(linkCount+1)
 */
export function computeScore(visits: number, lastVisit: number, linkCount: number): number {
  const now = Date.now();
  const ageHours = (now - lastVisit) / (1000 * 60 * 60);
  // Recency: 1.0 for just visited, decays to ~0.1 over a week
  const recency = Math.max(0.1, 1.0 - ageHours / (24 * 7));
  const freq = Math.log2(visits + 1);
  const density = Math.log2(linkCount + 1) + 1;
  return freq * recency * density;
}
