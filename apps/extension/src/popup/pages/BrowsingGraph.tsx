/* ============================================================
   BROWSING GRAPH — D3.js force-directed graph visualization
   ============================================================ */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { GraphNode, GraphEdge } from '@/core/entities/Graph';
import { getGraphData, buildClusters } from '@/core/use-cases/graphBuilder';
import { Badge } from '@/shared/ui/Badge';
import { IconGraph } from '@/shared/ui/Icons';

// Category → color
const CATEGORY_COLORS: Record<string, string> = {
  tech:     'hsl(252, 87%, 68%)',   // purple
  docs:     'hsl(152, 68%, 52%)',   // green
  social:   'hsl(38, 92%, 60%)',    // amber
  media:    'hsl(340, 82%, 62%)',   // pink
  shopping: 'hsl(0, 72%, 58%)',     // red
  email:    'hsl(192, 90%, 56%)',   // cyan
  other:    'hsl(220, 12%, 64%)',   // gray
};

interface D3Node extends d3.SimulationNodeDatum {
  id: string;
  title: string;
  domain: string;
  category: string;
  score: number;
  visits: number;
  favicon: string;
  radius: number;
}

interface D3Edge extends d3.SimulationLinkDatum<D3Node> {
  weight: number;
}

export function BrowsingGraph() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [hoveredNode, setHoveredNode] = useState<D3Node | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0, clusters: 0 });

  // Load graph data
  useEffect(() => {
    getGraphData().then((data) => {
      setGraphData(data);
      const clusters = buildClusters(data.nodes);
      setStats({ nodes: data.nodes.length, edges: data.edges.length, clusters: clusters.size });
    }).catch(console.error);
  }, []);

  // Render D3 graph
  useEffect(() => {
    if (!graphData || !svgRef.current || graphData.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Prepare D3 data
    const maxScore = Math.max(...graphData.nodes.map((n) => n.score), 1);

    const d3Nodes: D3Node[] = graphData.nodes.slice(0, 150).map((n) => ({
      id: n.id,
      title: n.title,
      domain: n.domain,
      category: n.category,
      score: n.score,
      visits: n.visits,
      favicon: n.favicon,
      radius: 4 + (n.score / maxScore) * 16, // 4–20px
    }));

    const nodeIds = new Set(d3Nodes.map((n) => n.id));
    const d3Edges: D3Edge[] = graphData.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
      }));

    // Container with zoom
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Cluster hulls
    const clusterMap = new Map<string, D3Node[]>();
    d3Nodes.forEach((n) => {
      const group = clusterMap.get(n.domain) ?? [];
      group.push(n);
      clusterMap.set(n.domain, group);
    });

    const hullGroup = g.append('g').attr('class', 'hulls');

    // Edges
    const linkGroup = g.append('g').attr('class', 'links');
    const links = linkGroup.selectAll('line')
      .data(d3Edges)
      .join('line')
      .attr('stroke', 'hsl(220, 12%, 24%)')
      .attr('stroke-opacity', 0.4)
      .attr('stroke-width', (d) => Math.min(d.weight, 4) * 0.5);

    // Nodes
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodes = nodeGroup.selectAll('circle')
      .data(d3Nodes)
      .join('circle')
      .attr('r', (d) => d.radius)
      .attr('fill', (d) => CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other)
      .attr('fill-opacity', 0.85)
      .attr('stroke', (d) => CATEGORY_COLORS[d.category] ?? CATEGORY_COLORS.other)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.5)
      .attr('cursor', 'pointer')
      .on('mouseenter', (_, d) => setHoveredNode(d))
      .on('mouseleave', () => setHoveredNode(null))
      .on('click', (_, d) => {
        // Open the page
        chrome.tabs.create({ url: d.id });
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .call(
        d3.drag<any, D3Node>()
          .on('start', (event: d3.D3DragEvent<any, D3Node, D3Node>, d: D3Node) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event: d3.D3DragEvent<any, D3Node, D3Node>, d: D3Node) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event: d3.D3DragEvent<any, D3Node, D3Node>, d: D3Node) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Labels (for high-score nodes)
    const labelGroup = g.append('g').attr('class', 'labels');
    const labels = labelGroup.selectAll('text')
      .data(d3Nodes.filter((n) => n.score > maxScore * 0.3))
      .join('text')
      .text((d) => d.domain.length > 20 ? d.domain.slice(0, 18) + '…' : d.domain)
      .attr('font-size', 9)
      .attr('fill', 'hsl(220, 12%, 64%)')
      .attr('text-anchor', 'middle')
      .attr('pointer-events', 'none')
      .attr('dy', (d) => d.radius + 12);

    // Force simulation
    const simulation = d3.forceSimulation(d3Nodes)
      .force('link', d3.forceLink<D3Node, D3Edge>(d3Edges).id((d) => d.id).distance(60).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-80).distanceMax(300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<D3Node>().radius((d) => d.radius + 3))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))
      .on('tick', () => {
        links
          .attr('x1', (d) => (d.source as D3Node).x ?? 0)
          .attr('y1', (d) => (d.source as D3Node).y ?? 0)
          .attr('x2', (d) => (d.target as D3Node).x ?? 0)
          .attr('y2', (d) => (d.target as D3Node).y ?? 0);

        nodes
          .attr('cx', (d) => d.x ?? 0)
          .attr('cy', (d) => d.y ?? 0);

        labels
          .attr('x', (d) => d.x ?? 0)
          .attr('y', (d) => d.y ?? 0);

        // Update convex hulls
        hullGroup.selectAll('path').remove();
        clusterMap.forEach((clusterNodes, domain) => {
          if (clusterNodes.length < 3) return;
          const points: [number, number][] = clusterNodes
            .filter((n) => n.x != null && n.y != null)
            .map((n) => [n.x!, n.y!]);
          if (points.length < 3) return;

          const hull = d3.polygonHull(points);
          if (!hull) return;

          // Expand hull slightly
          const centroid = d3.polygonCentroid(hull);
          const expanded = hull.map(([x, y]) => {
            const dx = x - centroid[0];
            const dy = y - centroid[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            const pad = 15;
            return [x + (dx / len) * pad, y + (dy / len) * pad] as [number, number];
          });

          const color = CATEGORY_COLORS[clusterNodes[0].category] ?? CATEGORY_COLORS.other;
          hullGroup.append('path')
            .attr('d', `M${expanded.map((p) => p.join(',')).join('L')}Z`)
            .attr('fill', color)
            .attr('fill-opacity', 0.04)
            .attr('stroke', color)
            .attr('stroke-opacity', 0.12)
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,4');
        });
      });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [graphData]);

  const handleRefresh = useCallback(() => {
    getGraphData().then((data) => {
      setGraphData(data);
      const clusters = buildClusters(data.nodes);
      setStats({ nodes: data.nodes.length, edges: data.edges.length, clusters: clusters.size });
    }).catch(console.error);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Stats bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <Badge variant="primary">{stats.nodes} pages</Badge>
          <Badge>{stats.edges} links</Badge>
          <Badge variant="info">{stats.clusters} domains</Badge>
        </div>
        <button
          onClick={handleRefresh}
          className="text-[10px] text-text-tertiary hover:text-accent-primary transition-colors cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 relative overflow-hidden">
        {graphData && graphData.nodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-text-tertiary animate-fade-in">
            <IconGraph size={36} className="mb-4 opacity-30" />
            <h2 className="text-lg font-semibold text-text-primary">Nothing here yet</h2>
            <p className="text-xs mt-1 text-center px-8">
              Browse the web and your visited sites will appear here as a visual map.
            </p>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ background: 'var(--color-surface-base)' }}
          />
        )}

        {/* Hover tooltip */}
        {hoveredNode && (
          <div className="absolute bottom-3 left-3 right-3 glass-panel px-3 py-2 animate-fade-in pointer-events-none">
            <div className="flex items-center gap-2">
              {hoveredNode.favicon && (
                <img src={hoveredNode.favicon} alt="" className="w-4 h-4 rounded" />
              )}
              <span className="text-xs font-medium text-text-primary truncate">
                {hoveredNode.title || hoveredNode.domain}
              </span>
              <Badge variant={hoveredNode.category === 'tech' ? 'info' : 'default'}>
                {hoveredNode.category}
              </Badge>
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-text-tertiary">
              <span>{hoveredNode.domain}</span>
              <span>{hoveredNode.visits} visit{hoveredNode.visits !== 1 ? 's' : ''}</span>
              <span>relevance: {hoveredNode.score.toFixed(1)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-subtle overflow-x-auto">
        {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
          <div key={cat} className="flex items-center gap-1 shrink-0">
            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
            <span className="text-[9px] text-text-tertiary">{cat}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
