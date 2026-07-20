/**
 * pathGraph.js — routing over hand-traced waypoint paths.
 *
 * Why this exists: no API or dataset exposes a real walkable-path/navmesh for
 * any Tarkov map (confirmed via research — this isn't for lack of trying).
 * Automated approaches (image color/edge segmentation) were tried and failed:
 * the map art has too much shading/texture variance for reliable building or
 * water detection, and an edge-density cost surface literally routed through
 * the black margin outside the map, since "visually simple" isn't the same
 * as "walkable." See project history for the full account.
 *
 * What actually works: a person who knows the real map traces how they'd
 * walk it, on top of the real calibrated image. Each trace becomes a chain
 * of real waypoints. This module treats those chains as a graph (nodes +
 * edges with real distances) so that:
 *   - routing between two points *on* a traced path follows the real trace
 *   - routing between points with no nearby trace coverage honestly falls
 *     back to a straight line for the uncovered portion, rather than
 *     inventing geometry
 *   - adding more traces over time naturally grows the graph (shared nodes
 *     where traces cross/run close), so coverage compounds rather than
 *     staying isolated per-trace
 *
 * With a single trace (today), this collapses to "walk along the one known
 * chain if you're near it, else straight line" -- that's expected and
 * correct, not a bug. The Dijkstra-based routeAlongGraph() below is written
 * generally so it doesn't need to change when more traces are added.
 */

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Build a graph from one or more traced routes.
 * traces: [{ points: [{x,z}, ...] }, ...] -- each points array is an ordered
 * polyline as walked (already simplified, e.g. via Douglas-Peucker).
 *
 * Nodes are deduped by exact (rounded) coordinate so that traces sharing an
 * endpoint or crossing point (in future, multiple traces) merge into shared
 * graph nodes instead of staying disconnected.
 */
export function buildGraph(traces) {
  const nodes = []; // [{id, x, z}]
  const nodeIndex = new Map(); // "x,z" -> id
  const adjacency = new Map(); // id -> [{to, dist}]

  function nodeIdFor(pt) {
    const key = `${Math.round(pt.x)},${Math.round(pt.z)}`;
    if (nodeIndex.has(key)) return nodeIndex.get(key);
    const id = nodes.length;
    nodes.push({ id, x: pt.x, z: pt.z });
    nodeIndex.set(key, id);
    adjacency.set(id, []);
    return id;
  }

  function addEdge(aId, bId) {
    const a = nodes[aId], b = nodes[bId];
    const d = dist(a, b);
    adjacency.get(aId).push({ to: bId, dist: d });
    adjacency.get(bId).push({ to: aId, dist: d });
  }

  const edges = []; // flat list for snapping: [{a, b}]
  for (const trace of traces ?? []) {
    const pts = trace.points ?? [];
    for (let i = 0; i < pts.length - 1; i++) {
      const aId = nodeIdFor(pts[i]);
      const bId = nodeIdFor(pts[i + 1]);
      if (aId === bId) continue; // dedupe exact repeats
      addEdge(aId, bId);
      edges.push({ a: aId, b: bId });
    }
  }

  return { nodes, edges, adjacency };
}

/**
 * Find the closest point on the graph to an arbitrary (x,z), by projecting
 * onto every edge segment (not just nodes) so entry/exit points can fall
 * mid-edge, not just at a traced bend. Returns null if the graph has no
 * edges at all.
 */
export function snapToGraph(graph, point) {
  if (!graph.edges.length) return null;
  let best = null;
  for (const { a, b } of graph.edges) {
    const A = graph.nodes[a], B = graph.nodes[b];
    const abx = B.x - A.x, abz = B.z - A.z;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 0 ? ((point.x - A.x) * abx + (point.z - A.z) * abz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: A.x + t * abx, z: A.z + t * abz };
    const d = dist(point, proj);
    if (!best || d < best.distToGraph) {
      best = { edgeA: a, edgeB: b, t, x: proj.x, z: proj.z, distToGraph: d };
    }
  }
  return best;
}

/** Dijkstra over the graph's node adjacency, returning node ids in path order. */
function dijkstra(graph, startId, endId) {
  const dists = new Map([[startId, 0]]);
  const prev = new Map();
  const visited = new Set();
  const queue = [[0, startId]];
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [d, id] = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    if (id === endId) break;
    for (const { to, dist: edgeDist } of graph.adjacency.get(id) ?? []) {
      const nd = d + edgeDist;
      if (!dists.has(to) || nd < dists.get(to)) {
        dists.set(to, nd);
        prev.set(to, id);
        queue.push([nd, to]);
      }
    }
  }
  if (!dists.has(endId)) return null;
  const path = [endId];
  let cur = endId;
  while (cur !== startId) {
    cur = prev.get(cur);
    if (cur === undefined) return null;
    path.push(cur);
  }
  return path.reverse();
}

/**
 * Route from `start` to `end` (arbitrary real game coordinates), using the
 * traced graph wherever it actually has coverage.
 *
 * maxSnapDist caps how far a point can be from the nearest trace before
 * it's considered "not covered." Three cases:
 *   - both ends covered: ride the real graph the whole way
 *   - one end covered: ride the real graph from the covered end to whichever
 *     real graph node is closest to the uncovered end, then a straight line
 *     for the rest -- better than abandoning real data that IS available
 *   - neither end covered: honest straight line, no graph involved
 *
 * Returns { points: [{x,z}], onGraph: [bool per segment], usedGraph: bool }
 * so callers (and any UI) can render the graph-backed part differently from
 * the straight-line fallback part, e.g. solid vs dashed.
 */
export function routeAlongGraph(graph, start, end, maxSnapDist = 60) {
  const snapStart = snapToGraph(graph, start);
  const snapEnd = snapToGraph(graph, end);
  const startCovered = snapStart && snapStart.distToGraph <= maxSnapDist;
  const endCovered = snapEnd && snapEnd.distToGraph <= maxSnapDist;

  if (!startCovered && !endCovered) {
    return { points: [start, end], onGraph: [false], usedGraph: false };
  }

  // Build a virtual graph with snap points inserted as real nodes, splitting
  // whichever edge they land on, so routing can start/end exactly there
  // rather than only at traced bends.
  const virtualNodes = [];
  const virtualAdjacency = new Map();
  for (const n of graph.nodes) virtualAdjacency.set(n.id, [...(graph.adjacency.get(n.id) ?? [])]);

  function insertVirtual(snap) {
    const vid = graph.nodes.length + virtualNodes.length;
    const vNode = { id: vid, x: snap.x, z: snap.z };
    virtualNodes.push(vNode);
    virtualAdjacency.set(vid, []);
    const A = graph.nodes[snap.edgeA], B = graph.nodes[snap.edgeB];
    const dA = dist(vNode, A), dB = dist(vNode, B);
    virtualAdjacency.get(vid).push({ to: snap.edgeA, dist: dA });
    virtualAdjacency.get(snap.edgeA).push({ to: vid, dist: dA });
    virtualAdjacency.get(vid).push({ to: snap.edgeB, dist: dB });
    virtualAdjacency.get(snap.edgeB).push({ to: vid, dist: dB });
    return vid;
  }

  const allNodesBase = [...graph.nodes];
  const virtualGraph = { nodes: allNodesBase, adjacency: virtualAdjacency };

  if (startCovered && endCovered) {
    const startVid = insertVirtual(snapStart);
    const endVid = insertVirtual(snapEnd);
    virtualGraph.nodes = [...graph.nodes, ...virtualNodes];
    const pathIds = dijkstra(virtualGraph, startVid, endVid);
    if (!pathIds) return { points: [start, end], onGraph: [false], usedGraph: false };

    const graphPoints = pathIds.map((id) => ({ x: virtualGraph.nodes[id].x, z: virtualGraph.nodes[id].z }));
    const points = [start, ...graphPoints, end];
    const onGraph = [
      snapStart.distToGraph <= 1,
      ...graphPoints.slice(0, -1).map(() => true),
      snapEnd.distToGraph <= 1,
    ];
    return { points, onGraph, usedGraph: true };
  }

  // Partial coverage: one end is near the graph, the other isn't. Ride the
  // graph from the covered end to whichever real node is geometrically
  // closest to the uncovered end, then a plain straight line for the rest.
  const coveredIsStart = startCovered;
  const coveredSnap = coveredIsStart ? snapStart : snapEnd;
  const uncoveredPoint = coveredIsStart ? end : start;

  const entryVid = insertVirtual(coveredSnap);
  virtualGraph.nodes = [...graph.nodes, ...virtualNodes];

  // Closest real graph node to the uncovered point -- the "exit" node where
  // we leave the graph and switch to a straight line.
  let exitNode = graph.nodes[0];
  let exitDist = Infinity;
  for (const n of graph.nodes) {
    const d = dist(n, uncoveredPoint);
    if (d < exitDist) { exitDist = d; exitNode = n; }
  }

  const pathIds = dijkstra(virtualGraph, entryVid, exitNode.id);
  if (!pathIds) return { points: [start, end], onGraph: [false], usedGraph: false };

  const graphPoints = pathIds.map((id) => ({ x: virtualGraph.nodes[id].x, z: virtualGraph.nodes[id].z }));

  const points = coveredIsStart
    ? [start, ...graphPoints, end]
    : [start, ...graphPoints.slice().reverse(), end];

  const onGraph = coveredIsStart
    ? [coveredSnap.distToGraph <= 1, ...graphPoints.slice(0, -1).map(() => true), false]
    : [false, ...graphPoints.slice(0, -1).map(() => true), coveredSnap.distToGraph <= 1];

  return { points, onGraph, usedGraph: true, partialCoverage: true };
}
