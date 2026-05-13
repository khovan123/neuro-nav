/* ============================================================
   GRAPH BUILDER — Builds + scores the browsing graph
   ============================================================ */

import type { GraphNode, GraphEdge } from '@/core/entities/Graph';
import { extractDomain, computeScore } from '@/core/entities/Graph';
import * as graphStore from '@/infrastructure/db/graphStore';

/**
 * Record a page visit. Creates or updates the node.
 */
export async function recordPageVisit(
  url: string,
  title: string,
  favicon: string,
  category: string,
  branch: string = 'default'
): Promise<void> {
  // Skip non-http
  if (!url.startsWith('http')) return;

  const existing = await graphStore.getNode(url);
  const domain = extractDomain(url);
  const visits = (existing?.visits ?? 0) + 1;

  const node: GraphNode = {
    id: url,
    title: title || existing?.title || url,
    favicon: favicon || existing?.favicon || '',
    category: category || existing?.category || 'other',
    domain,
    visits,
    lastVisit: Date.now(),
    score: 0, // computed below
    cluster: domain, // cluster by domain
    branch,
  };

  // Get edge count for this node
  const allEdges = await graphStore.getAllEdges();
  const linkCount = allEdges.filter((e) => e.source === url || e.target === url).length;
  node.score = computeScore(visits, node.lastVisit, linkCount);

  await graphStore.upsertNode(node);
}

/**
 * Record a navigation transition from one page to another.
 */
export async function recordNavigation(fromUrl: string, toUrl: string): Promise<void> {
  if (!fromUrl.startsWith('http') || !toUrl.startsWith('http')) return;
  if (fromUrl === toUrl) return;
  await graphStore.recordTransition(fromUrl, toUrl);
}

/**
 * Get the full graph data for visualization.
 * Returns nodes with re-computed scores and edges.
 */
export async function getGraphData(branch?: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> {
  const [allNodes, edges] = await Promise.all([
    graphStore.getAllNodes(),
    graphStore.getAllEdges(),
  ]);

  // Filter nodes by branch if specified
  const nodes = branch
    ? allNodes.filter((n) => n.branch === branch)
    : allNodes;

  // Re-compute scores with current edge data
  const nodeIds = new Set(nodes.map((n) => n.id));
  const filteredEdges = branch
    ? edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    : edges;

  for (const node of nodes) {
    const linkCount = filteredEdges.filter((e) => e.source === node.id || e.target === node.id).length;
    node.score = computeScore(node.visits, node.lastVisit, linkCount);
  }

  // Sort by score descending
  nodes.sort((a, b) => b.score - a.score);

  return { nodes, edges: filteredEdges };
}

/**
 * Get cluster metadata: group nodes by domain.
 */
export function buildClusters(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const clusters = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const group = clusters.get(node.cluster) ?? [];
    group.push(node);
    clusters.set(node.cluster, group);
  }
  return clusters;
}
