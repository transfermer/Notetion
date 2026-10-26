import { useEffect, useRef } from "preact/hooks";
import { api } from "../api";
import { openNoteInActive } from "../panes";

interface GraphNode {
  id: string;
  title: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphEdge {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function GraphView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Load graph data.
    api
      .getGraph()
      .then((data) => {
        renderGraph(data);
      })
      .catch((err) => console.error("load graph failed", err));

    return () => {
      // Cleanup d3 simulation if needed.
    };
  }, []);

  function renderGraph(data: GraphData) {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Clear previous content.
    svgRef.current.innerHTML = "";

    // Simple force-directed layout using basic physics (no d3 dependency for now).
    const nodes: GraphNode[] = data.nodes.map((n) => ({
      ...n,
      x: Math.random() * width,
      y: Math.random() * height,
      vx: 0,
      vy: 0,
    }));

    const edges: GraphEdge[] = data.edges.map((e) => ({
      ...e,
      source: nodes.find((n) => n.id === e.source) || e.source,
      target: nodes.find((n) => n.id === e.target) || e.target,
    }));

    const svg = svgRef.current;
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    // Draw edges.
    const edgeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    edgeGroup.setAttribute("class", "edges");
    svg.appendChild(edgeGroup);

    for (const edge of edges) {
      const source = edge.source as GraphNode;
      const target = edge.target as GraphNode;
      if (!source.x || !target.x) continue;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(target.x));
      line.setAttribute("y2", String(target.y));
      line.setAttribute("stroke", "var(--border)");
      line.setAttribute("stroke-width", "1");
      edgeGroup.appendChild(line);
    }

    // Draw nodes.
    const nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    nodeGroup.setAttribute("class", "nodes");
    svg.appendChild(nodeGroup);

    for (const node of nodes) {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("transform", `translate(${node.x}, ${node.y})`);
      g.style.cursor = "pointer";

      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("r", "8");
      circle.setAttribute("fill", "var(--accent)");
      g.appendChild(circle);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute("x", "12");
      text.setAttribute("y", "4");
      text.setAttribute("fill", "var(--text)");
      text.setAttribute("font-size", "12");
      text.textContent = node.title || "(untitled)";
      g.appendChild(text);

      g.addEventListener("click", () => {
        openNoteInActive(node.id);
      });

      nodeGroup.appendChild(g);
    }

    // Simple force simulation (100 iterations).
    const alpha = 0.1;
    const repulsion = 1000;
    const attraction = 0.01;
    const centerForce = 0.01;

    for (let iter = 0; iter < 100; iter++) {
      // Repulsion between all nodes.
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = (b.x || 0) - (a.x || 0);
          const dy = (b.y || 0) - (a.y || 0);
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repulsion / (dist * dist);
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          a.vx = (a.vx || 0) - fx;
          a.vy = (a.vy || 0) - fy;
          b.vx = (b.vx || 0) + fx;
          b.vy = (b.vy || 0) + fy;
        }
      }

      // Attraction along edges.
      for (const edge of edges) {
        const source = edge.source as GraphNode;
        const target = edge.target as GraphNode;
        const dx = (target.x || 0) - (source.x || 0);
        const dy = (target.y || 0) - (source.y || 0);
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * attraction;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        source.vx = (source.vx || 0) + fx;
        source.vy = (source.vy || 0) + fy;
        target.vx = (target.vx || 0) - fx;
        target.vy = (target.vy || 0) - fy;
      }

      // Center force.
      for (const node of nodes) {
        node.vx = (node.vx || 0) + (width / 2 - (node.x || 0)) * centerForce;
        node.vy = (node.vy || 0) + (height / 2 - (node.y || 0)) * centerForce;
      }

      // Update positions.
      for (const node of nodes) {
        node.vx = (node.vx || 0) * 0.9; // damping
        node.vy = (node.vy || 0) * 0.9;
        node.x = (node.x || 0) + (node.vx || 0) * alpha;
        node.y = (node.y || 0) + (node.vy || 0) * alpha;

        // Clamp to bounds.
        node.x = Math.max(20, Math.min(width - 20, node.x));
        node.y = Math.max(20, Math.min(height - 20, node.y));
      }
    }

    // Update SVG with final positions.
    const lines = edgeGroup.querySelectorAll("line");
    lines.forEach((line, i) => {
      const edge = edges[i];
      const source = edge.source as GraphNode;
      const target = edge.target as GraphNode;
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(target.x));
      line.setAttribute("y2", String(target.y));
    });

    const nodeElements = nodeGroup.querySelectorAll("g");
    nodeElements.forEach((g, i) => {
      const node = nodes[i];
      g.setAttribute("transform", `translate(${node.x}, ${node.y})`);
    });
  }

  return (
    <div ref={containerRef} class="graph-view">
      <svg ref={svgRef} />
    </div>
  );
}
