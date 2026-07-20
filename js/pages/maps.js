/**
 * maps.js — raid briefings (v0.4) + optional visual route overlay (v0.8.3).
 *
 * One card per map: player count, raid timer, level guidance, boss summary.
 * Real tactical map imagery isn't something the importer can fetch or
 * license, so it's opt-in: drop a map image + a hand-fitted calibration
 * into assets/maps/ (see mapCalibration.js) and the Raid Planner will
 * plot the optimized route and suggested extract directly on it. Maps
 * without calibration fall back to the plain text objective list.
 */
import { el } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";
import { HIDDEN_VARIANTS, mapAccessBlock, hasAccessData } from "../core/mapAccess.js";
export { HIDDEN_VARIANTS };
import { getProfile, update } from "../core/store.js";
import { mapScores, mapPlan, orderRoute } from "../core/routeEngine.js";
import { hasCalibration, getImageInfo, gameToPixel } from "../core/mapCalibration.js";
import { KNOWN_MAP_IMAGES, ATTRIBUTION as HOTLINK_ATTRIBUTION } from "../core/mapFetch.js";

function lockToggle(m, profile, rerender) {
  const locked = (profile.lockedMaps ?? []).includes(m.id);
  return el("label", {
    style: "display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-muted);font-size:12px;margin-top:8px",
    title: "Story/event chains gate some maps in game. Mark a map locked and every quest on it drops to Locked across the app.",
  },
    el("input", { type: "checkbox", checked: locked ? "" : null,
      onchange: async (e) => {
        const nowLocked = e.target.checked;
        await update((p) => {
          p.lockedMaps = (p.lockedMaps ?? []).filter((id) => id !== m.id);
          if (nowLocked) p.lockedMaps.push(m.id);
        });
        rerender();
      } }),
    locked ? "Locked in game — quests here excluded" : "Not yet unlocked in game?");
}

function extractList(m) {
  if (!m.extracts?.length) return null;
  return el("div", { style: "margin-top:8px;font-size:12px" },
    el("span", { style: "color:var(--text-muted)" }, "Extracts: "),
    el("span", {}, m.extracts.map((ex) => `${ex.name}${ex.faction !== "Any" ? ` (${ex.faction})` : ""}`).join(", ")));
}

/* ---------- reference maps (v0.8.13) ----------
 * Community map imagery dropped into assets/maps/reference/ and registered
 * with tools/register_maps.py. RE3MR's maps are CC BY-NC-SA 4.0: the credit
 * line rendered under every image is a license requirement, not decoration.
 */
let refManifest = null;   // null = not loaded yet, false = none available
let refRedraw = null;     // ALWAYS the latest render's redraw. The router can
                          // re-render (e.g. on data:ready) between fetch start
                          // and finish; notifying the first caller's draw would
                          // repaint a detached container — the v0.8.13 bug.
function loadReference(onReady) {
  refRedraw = onReady;
  if (refManifest !== null) return;
  refManifest = false;
  fetch("assets/maps/reference.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { if (j?.maps) { refManifest = j; refRedraw?.(); } })
    .catch(() => {});
}

function attributionLine(attr) {
  return el("div", { style: "font-size:11px;color:var(--text-muted);margin-top:4px" },
    "3D map by ",
    el("a", { href: attr?.url || "https://reemr.se", target: "_blank", rel: "noopener",
      style: "color:var(--brass)" }, attr?.author || "RE3MR"),
    " · ",
    el("a", { href: attr?.licenseUrl || "https://creativecommons.org/licenses/by-nc-sa/4.0/",
      target: "_blank", rel: "noopener", style: "color:var(--text-muted)" },
      attr?.license || "CC BY-NC-SA 4.0"));
}

const refOpen = new Set(); // mapIds with the viewer expanded (file-based OR hotlink)

function referenceViewer(m, rerender) {
  const fileEntry = refManifest && refManifest.maps?.[m.id];
  const hotlink = !fileEntry && KNOWN_MAP_IMAGES[m.id];
  if (!fileEntry && !hotlink) return null;

  const open = refOpen.has(m.id);
  const src = fileEntry ? `assets/maps/${fileEntry.file}` : hotlink.mobile;
  const fullSrc = fileEntry ? src : hotlink.full;
  const sizeLabel = fileEntry?.sizeMB != null ? ` (${fileEntry.sizeMB} MB)` : "";
  const toggle = el("button", {
    class: "btn btn--ghost", style: "margin-top:8px;font-size:12px",
    onclick: () => { open ? refOpen.delete(m.id) : refOpen.add(m.id); rerender(); },
  }, open ? "Hide map" : `View map${sizeLabel}`);
  if (!open) return el("div", {}, toggle);
  return el("div", {}, toggle,
    el("a", { href: fullSrc, target: "_blank", rel: "noopener",
      title: "Open full size in a new tab for pinch-zoom" },
      el("img", { src, loading: "lazy", alt: `${m.name} reference map`,
        style: "width:100%;height:auto;display:block;margin-top:8px;border:1px solid var(--border, #333);border-radius:4px" })),
    attributionLine(fileEntry ? refManifest.attribution : HOTLINK_ATTRIBUTION),
    el("div", { style: "font-size:11px;color:var(--text-muted)" },
      hotlink
        ? "Loaded live from RE3MR — needs a connection. Tap the image to open full size."
        : "Tap the image to open full size (pinch-zoom).")
  );
}

function mapCard(m, profile, rerender) {
  const beginner = m.beginnerFriendly
    ? el("span", { class: "badge badge--ok" }, "BEGINNER FRIENDLY") : null;
  const levelNote = m.levelRange && m.levelRange !== "any"
    ? el("span", { class: "badge badge--brass" }, `Suggested level ${m.levelRange}`) : null;

  return el("section", { class: "panel" },
    el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap" },
      el("strong", { style: "color:var(--text-bright);font-size:15px" }, m.name),
      el("span", { class: "muted", style: "font-size:12px;color:var(--text-muted)" },
        `${m.players} PMCs · ${m.duration} min`)),
    (beginner || levelNote)
      ? el("div", { style: "display:flex;gap:6px;margin-top:8px;flex-wrap:wrap" }, beginner, levelNote)
      : null,
    el("p", { style: "color:var(--text);font-size:13px;margin-top:8px" }, m.summary || ""),
    (() => {
      const block = mapAccessBlock(m.id, profile);
      return block && block.level ? el("div", {
        class: "badge", style: "margin-top:8px;color:var(--brass);border-color:var(--brass)",
      }, `Locked — ${block.reason}`) : null;
    })(),
    extractList(m),
    referenceViewer(m, rerender),
    lockToggle(m, profile, rerender));
}

/**
 * Raid Planner (v0.6): routeEngine-ranked raid suggestions. Each map is
 * scored by active objectives, Kappa weight, and still-needed handover
 * items; per-objective coordinates from the importer's geo pass appear as
 * (x, z) game coordinates when available. Map-agnostic objectives are
 * listed once at the bottom — they advance on every raid.
 */
function fmtPositions(positions) {
  if (!positions?.length) return "";
  return " @ " + positions.map((p) => `(${p.x}, ${p.z})`).join(" / ");
}

/** Build an <svg> element with the given attrs (SVG needs its own namespace). */
function svgEl(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  return node;
}

/**
 * Real image + SVG overlay: numbered route dots connected by lines, plus
 * a distinct extract marker, all placed via the map's fitted calibration.
 * Returns null if this map has no calibration (caller falls back to text).
 */
function mapVisual(mapId, route) {
  if (!hasCalibration(mapId)) return null;
  const info = getImageInfo(mapId);

  const stopPixels = route.stops
    .map((s) => {
      const px = gameToPixel(mapId, s);
      return px ? { ...s, x: px.x, y: px.y } : null;
    })
    .filter(Boolean);
  const primaryExtract = route.extractOptions?.[0];
  const extractPixel = primaryExtract ? gameToPixel(mapId, primaryExtract) : null;

  const wrap = el("div", {
    style: "position:relative;margin-top:10px;border:1px solid var(--border-soft);border-radius:4px;overflow:hidden",
  });
  const img = el("img", {
    src: info.image,
    alt: `${mapId} map`,
    style: "display:block;width:100%;height:auto",
  });
  wrap.appendChild(img);

  const svg = svgEl("svg", {
    viewBox: `0 0 ${info.width} ${info.height}`,
    style: "position:absolute;inset:0;width:100%;height:100%;pointer-events:none",
  });

  // Connect the stops in order.
  for (let i = 1; i < stopPixels.length; i++) {
    const a = stopPixels[i - 1];
    const b = stopPixels[i];
    svg.appendChild(svgEl("line", {
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      stroke: "#9dbb46", "stroke-width": Math.max(6, info.width / 800),
      "stroke-dasharray": `${info.width / 200},${info.width / 300}`,
      opacity: "0.9",
    }));
  }
  // Numbered stop markers.
  stopPixels.forEach((p, i) => {
    const r = Math.max(18, info.width / 220);
    svg.appendChild(svgEl("circle", { cx: p.x, cy: p.y, r, fill: "#191b13", stroke: "#9dbb46", "stroke-width": r / 5 }));
    svg.appendChild(svgEl("text", {
      x: p.x, y: p.y, "text-anchor": "middle", "dominant-baseline": "central",
      fill: "#efeddd", "font-size": r * 1.1, "font-family": "sans-serif", "font-weight": "700",
    })).textContent = String(i + 1);
  });
  // Extract marker, visually distinct (diamond).
  if (extractPixel) {
    const r = Math.max(22, info.width / 180);
    const p = extractPixel;
    svg.appendChild(svgEl("polygon", {
      points: `${p.x},${p.y - r} ${p.x + r},${p.y} ${p.x},${p.y + r} ${p.x - r},${p.y}`,
      fill: "#c9a55e", stroke: "#191b13", "stroke-width": r / 6,
    }));
  }

  wrap.appendChild(svg);
  return wrap;
}

function routeBlock(mapId, entries, profile) {
  const route = orderRoute(mapId, entries, profile);
  const parts = [];
  const hasExtracts = route.extractOptions?.length > 0;

  const visual = (route.stops.length > 1 || hasExtracts) ? mapVisual(mapId, route) : null;
  if (visual) parts.push(visual);

  if (route.stops.length > 1) {
    parts.push(el("div", { style: "margin-top:8px" },
      el("div", { style: "font-size:11px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px" },
        `Suggested route (${route.totalDistance}m, nearest-neighbor)`),
      el("ol", { style: "margin:0 0 0 16px;color:var(--text);font-size:12px" },
        ...route.stops.map((s) =>
          el("li", { style: "margin:2px 0" },
            `${s.questName}: ${s.description} `,
            el("span", { class: "muted" }, `(${s.x}, ${s.z})`))))));
  }

  if (hasExtracts) {
    // Extracts aren't guaranteed open in a given raid -- some are randomized
    // by the game each raid, some need a keyword/item/switch -- so this
    // shows a short ranked list (nearest first) rather than one "the"
    // answer, so there's a backup on hand if the top pick is closed.
    parts.push(el("div", { style: "margin-top:6px" },
      el("div", { style: "font-size:11px;color:var(--text-muted);letter-spacing:1px;text-transform:uppercase;margin-bottom:3px" },
        "Extract options (nearest first — none of these are guaranteed open)"),
      ...route.extractOptions.map((ex, i) => {
        const factionNote = ex.faction !== "Any" ? ` · ${ex.faction} only` : "";
        const requiresNote = ex.requires ? ` · ${ex.requires}` : "";
        return el("div", { style: `font-size:12px;margin:2px 0${i > 0 ? ";opacity:0.75" : ""}` },
          el("span", { class: ex.requires ? "badge badge--brass" : "badge badge--green", style: "margin-right:6px" },
            i === 0 ? (ex.requires ? "BEST GUESS (CONDITIONAL)" : "BEST GUESS") : "BACKUP"),
          el("span", { style: "color:var(--text-bright)" }, ex.name),
          el("span", { class: "muted" }, `${factionNote}${requiresNote}${ex.x || ex.z ? ` · (${ex.x}, ${ex.z})` : ""}`));
      })));
  }

  return parts;
}


export function raidPlannerPanel(profile, maps) {
  const scores = mapScores(profile).filter((row) => !HIDDEN_VARIANTS.has(row.mapId));
  const plan = mapPlan(profile);

  const body = [];
  scores.forEach((row, i) => {
    const entries = plan.get(row.mapId) ?? [];
    const scoreBits = [`${row.objectives} objective${row.objectives !== 1 ? "s" : ""}`];
    if (row.kappaQuests) scoreBits.push(`${row.kappaQuests} Kappa`);
    if (row.itemPickups) scoreBits.push(`${row.itemPickups} handover item${row.itemPickups !== 1 ? "s" : ""} still needed`);
    if (row.familiarity) scoreBits.push(`+${row.familiarity} familiarity`);

    body.push(el("div", { style: "margin-bottom:14px" },
      el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap" },
        i === 0 ? el("span", { class: "badge badge--ok" }, "BEST PICK") : null,
        el("strong", { style: "color:var(--text-bright);font-size:13px" }, row.name),
        el("span", { class: "badge badge--brass" }, `score ${row.score}`),
        el("span", { class: "muted", style: "font-size:11px" }, scoreBits.join(" · "))),
      el("ul", { style: "margin:0 0 0 16px;color:var(--text);font-size:13px" },
        ...entries.map((e) =>
          el("li", { style: "margin:3px 0" },
            el("span", { style: "color:var(--text-bright)" },
              `${e.quest.name}${e.quest.kappa ? " ★" : ""}: `),
            el("span", { class: "muted", style: "font-size:12px" },
              e.objectives.map((o) => o.description + fmtPositions(o.positions)).join(" · "))))),
      ...routeBlock(row.mapId, entries, profile)));
  });

  const anywhere = plan.get("any") ?? [];
  if (anywhere.length) {
    body.push(el("div", { style: "margin-bottom:4px" },
      el("div", { style: "display:flex;align-items:center;gap:8px;margin-bottom:4px" },
        el("strong", { style: "color:var(--text-bright);font-size:13px" }, "Any map"),
        el("span", { class: "muted", style: "font-size:11px" }, "progresses on every raid")),
      el("ul", { style: "margin:0 0 0 16px;color:var(--text);font-size:13px" },
        ...anywhere.map((e) =>
          el("li", { style: "margin:3px 0" },
            el("span", { style: "color:var(--text-bright)" }, `${e.quest.name}${e.quest.kappa ? " ★" : ""}: `),
            el("span", { class: "muted", style: "font-size:12px" },
              e.objectives.map((o) => o.description).join(" · ")))))));
  }

  if (!body.length) {
    body.push(el("p", { style: "color:var(--text-muted);font-size:13px" },
      "No active quests. Complete prerequisites or raise your level on the Quests page."));
  }

  return el("section", { class: "panel", style: "margin-bottom:16px" },
    el("div", { class: "panel__title" }, "Raid Planner"),
    el("p", { style: "color:var(--text-muted);font-size:12px;margin-bottom:10px" },
      "Maps ranked by what a raid advances: objectives + Kappa quests (★) + handover items you still need + familiarity from your raid log. Coordinates (x, z) shown where the data pack has them. When 2+ objectives have positions, a nearest-neighbor route and suggested extraction appear below — re-run the importer to fetch positional/extract data."),
    (profile.lockedMaps ?? []).length
      ? el("p", { style: "color:var(--text-muted);font-size:12px;margin:-4px 0 10px" },
          `Excluding ${profile.lockedMaps.length} locked map${profile.lockedMaps.length > 1 ? "s" : ""} — untick "locked in game" on a map card below to include it.`)
      : null,
    ...body);
}

export default {
  id: "maps",
  title: "Maps",
  icon: "maps",
  section: "Raids",
  render(container) {
    const draw = () => {
    container.innerHTML = "";
    loadReference(draw); // async, one-shot; redraws when reference.json lands
    const maps = (get("maps")?.maps ?? []).filter((mp) => !HIDDEN_VARIANTS.has(mp.id));
    const profile = getProfile();

    if (!maps.length) {
      container.appendChild(el("div", { class: "panel" },
        el("p", { style: "color:var(--text-muted)" },
          "No map data. Run the importer: python tools/update_data.py")));
      return;
    }

    // beginner maps first for new players, otherwise keep data order
    const ordered = [...maps].sort((a, b) => (b.beginnerFriendly === true) - (a.beginnerFriendly === true));
    container.appendChild(el("div", { class: "grid" },
      ...ordered.map((m) => mapCard(m, profile, draw))));
    };
    draw();
  },
};
