/**
 * questgraph.js — the Quest Dependency Graph (v0.6).
 *
 * Per-trader chain view rendered as vanilla SVG (no libraries): columns =
 * prerequisite depth, nodes colored by state, edges show unlock order.
 * Tap a node for details + lock reasons. Cross-trader prerequisites still
 * position quests correctly (depth is computed over the full quest set)
 * but aren't drawn as edges — they're listed in the detail panel instead.
 */
import { el } from "../ui/dom.js";
import { getProfile } from "../core/store.js";
import { get } from "../core/dataLoader.js";
import { traderGraph } from "../core/routeEngine.js";
import { questById, lockReasons } from "../core/questEngine.js";

let selectedTrader = null;
let selectedQuest = null;

const NODE_W = 148;
const NODE_H = 40;
const GAP_X = 60;
const GAP_Y = 14;
const PAD = 16;

const STATE_FILL = {
  active: "rgba(90,140,80,.35)",
  locked: "rgba(255,255,255,.05)",
  completed: "rgba(170,140,70,.30)",
};
const STATE_STROKE = {
  active: "var(--olive, #7a9a5a)",
  locked: "var(--text-muted, #777)",
  completed: "var(--brass, #b09050)",
};

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

function truncate(name, max = 20) {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function drawGraph(profile, traderId, onSelect) {
  const { nodes, edges } = traderGraph(profile, traderId);
  if (!nodes.length) {
    return el("p", { style: "color:var(--text-muted);font-size:13px" },
      "No quests for this trader in the current data pack.");
  }

  // Normalize depths to consecutive columns (cross-trader chains can leave gaps).
  const depths = [...new Set(nodes.map((n) => n.depth))].sort((a, b) => a - b);
  const colOf = new Map(depths.map((d, i) => [d, i]));
  const pos = new Map(); // questId -> {x, y}
  let maxRow = 0;
  for (const n of nodes) {
    const col = colOf.get(n.depth);
    pos.set(n.quest.id, {
      x: PAD + col * (NODE_W + GAP_X),
      y: PAD + n.row * (NODE_H + GAP_Y),
    });
    maxRow = Math.max(maxRow, n.row);
  }
  const width = PAD * 2 + depths.length * NODE_W + (depths.length - 1) * GAP_X;
  const height = PAD * 2 + (maxRow + 1) * NODE_H + maxRow * GAP_Y;

  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width, height,
    style: "max-width:none;font-family:inherit",
  });

  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
    const x2 = b.x, y2 = b.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    svg.appendChild(svgEl("path", {
      d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
      fill: "none", stroke: "rgba(255,255,255,.18)", "stroke-width": 1.5,
    }));
  }

  for (const n of nodes) {
    const p = pos.get(n.quest.id);
    const selected = selectedQuest === n.quest.id;
    const g = svgEl("g", { style: "cursor:pointer", onclick: () => onSelect(n.quest.id) },
      svgEl("rect", {
        x: p.x, y: p.y, width: NODE_W, height: NODE_H, rx: 6,
        fill: STATE_FILL[n.state],
        stroke: selected ? "var(--text-bright, #eee)" : STATE_STROKE[n.state],
        "stroke-width": selected ? 2 : 1.2,
      }),
      svgEl("text", {
        x: p.x + 10, y: p.y + 17, fill: "var(--text-bright, #ddd)", "font-size": 11.5,
      }, truncate(n.quest.name)),
      svgEl("text", {
        x: p.x + 10, y: p.y + 31, fill: "var(--text-muted, #888)", "font-size": 9.5,
      }, `LVL ${n.quest.minLevel}${n.quest.kappa ? " · KAPPA" : ""}`));
    svg.appendChild(g);
  }

  // Horizontal scroll wrapper — chains get wide on phone screens.
  return el("div", { style: "overflow-x:auto;-webkit-overflow-scrolling:touch" }, svg);
}

function detailPanel(profile, questId) {
  const quest = questById(questId);
  if (!quest) return null;
  const graphless = quest.prerequisites
    .map((id) => questById(id))
    .filter((q) => q && q.trader !== quest.trader);
  const state = profile.completedQuests.includes(quest.id) ? "completed" : null;
  const reasons = lockReasons(quest, profile);

  return el("div", { class: "panel", style: "margin-top:12px" },
    el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
      el("strong", { style: "color:var(--text-bright)" }, quest.name),
      quest.kappa ? el("span", { class: "badge badge--brass" }, "KAPPA") : null,
      state === "completed" ? el("span", { class: "badge badge--brass" }, "Done") : null),
    el("ul", { style: "margin:8px 0 0 18px;color:var(--text);font-size:13px" },
      ...quest.objectives.map((o) => el("li", { style: "margin:2px 0" }, o))),
    reasons.length && state !== "completed"
      ? el("div", { style: "font-size:12px;color:var(--alert);margin-top:8px" }, reasons.join(" · "))
      : null,
    graphless.length
      ? el("p", { style: "font-size:12px;color:var(--text-muted);margin-top:8px" },
          "Cross-trader prerequisites (not drawn): " + graphless.map((q) => q.name).join(", "))
      : null);
}

export default {
  id: "questgraph",
  title: "Quest Graph",
  icon: "graph",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const traders = (get("traders")?.traders ?? []);
      if (!traders.length) {
        container.appendChild(el("div", { class: "panel" },
          el("p", { style: "color:var(--text-muted)" }, "No trader data.")));
        return;
      }
      if (!selectedTrader || !traders.some((t) => t.id === selectedTrader)) {
        selectedTrader = traders[0].id;
      }

      const legend = el("div", { style: "display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--text-muted)" },
        ...[["active", "Active"], ["locked", "Locked"], ["completed", "Completed"]].map(([s, label]) =>
          el("span", { style: "display:inline-flex;align-items:center;gap:6px" },
            el("span", { style: `width:12px;height:12px;border-radius:3px;display:inline-block;background:${STATE_FILL[s]};border:1px solid ${STATE_STROKE[s]}` }),
            label)));

      container.appendChild(el("div", { class: "panel", style: "margin-bottom:16px" },
        el("div", { style: "display:flex;gap:14px;flex-wrap:wrap;align-items:end" },
          el("div", { class: "field", style: "margin:0;min-width:160px" },
            el("label", {}, "Trader"),
            el("select", { onchange: (e) => { selectedTrader = e.target.value; selectedQuest = null; draw(); } },
              ...traders.map((t) => el("option", { value: t.id, selected: selectedTrader === t.id ? "" : null }, t.name)))),
          legend),
        el("p", { style: "color:var(--text-muted);font-size:12px;margin-top:10px" },
          "Left to right = unlock order. Tap a quest for objectives and lock reasons. Scroll sideways for long chains.")));

      const graphPanel = el("div", { class: "panel" });
      const detailHost = el("div", {});
      const select = (id) => {
        selectedQuest = selectedQuest === id ? null : id;
        detailHost.innerHTML = "";
        const d = selectedQuest ? detailPanel(profile, selectedQuest) : null;
        if (d) detailHost.appendChild(d);
        // redraw graph to move the selection highlight
        graphHost.innerHTML = "";
        graphHost.appendChild(drawGraph(profile, selectedTrader, select));
      };
      const graphHost = el("div", {});
      graphHost.appendChild(drawGraph(profile, selectedTrader, select));
      graphPanel.appendChild(graphHost);
      container.appendChild(graphPanel);
      container.appendChild(detailHost);
    };
    draw();
  },
};
