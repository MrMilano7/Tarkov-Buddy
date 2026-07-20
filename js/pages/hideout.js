/**
 * hideout.js — the Hideout Planner (v0.3).
 *
 * Per station: set the built level (persisted to profile.hideout), see the
 * next upgrade's requirements with live met/unmet checks. A combined
 * shopping list totals every item still needed, defaulting to "next
 * upgrades only" with a toggle for the full remaining build-out — the same
 * anti-overwhelm philosophy as the Loot Advisor.
 */
import { el, toast } from "../ui/dom.js";
import { countStepper } from "../ui/countStepper.js";
import { getProfile, update } from "../core/store.js";
import { get } from "../core/dataLoader.js";
import {
  allStations, builtLevel, nextLevel, requirementChecks, prereqsMet,
  shoppingList, hideoutProgress,
} from "../core/hideoutEngine.js";
import { haveCount } from "../core/inventoryEngine.js";

let stationFilter = "";
let listAllLevels = false; // shopping list scope: next upgrades vs everything
let listIncludeBlocked = false; // show items for upgrades whose prereqs aren't met (v0.8.28)

function itemNameMap() {
  const map = new Map();
  for (const i of get("items")?.items ?? []) map.set(i.id, i.name);
  return map;
}

function traderName(id) {
  return get("traders")?.traders.find((t) => t.id === id)?.name ?? id;
}

function fmtBuildTime(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m build`;
  if (h) return `${h}h build`;
  return `${m}m build`;
}

/** The level control: − [current/max] + */
function levelControl(station, profile, rerender) {
  const current = builtLevel(profile, station.id);
  const setLevel = async (lvl) => {
    const clamped = Math.max(0, Math.min(station.maxLevel, lvl));
    if (clamped === current) return;
    await update((p) => {
      p.hideout = p.hideout ?? {};
      p.hideout[station.id] = clamped;
    });
    if (clamped > current) toast(`${station.name} set to level ${clamped}.`);
    rerender();
  };
  return el("div", { style: "display:flex;align-items:center;gap:8px" },
    el("button", { class: "btn btn--ghost", title: "Decrease level", disabled: current <= 0 ? "" : null,
      onclick: () => setLevel(current - 1) }, "−"),
    el("span", { class: "badge badge--brass", style: "min-width:52px;text-align:center" },
      `L${current} / ${station.maxLevel}`),
    el("button", { class: "btn btn--ghost", title: "Increase level", disabled: current >= station.maxLevel ? "" : null,
      onclick: () => setLevel(current + 1) }, "+"),
  );
}

function checkRow(label, met) {
  const mark = met === null ? "◇" : met ? "✓" : "✗";
  const color = met === null ? "var(--text-muted)" : met ? "var(--olive)" : "var(--alert)";
  return el("li", { style: "margin:2px 0" },
    el("span", {},
      el("span", { style: `color:${color};margin-right:8px;font-weight:bold` }, mark),
      label,
      met === null ? el("span", { class: "muted", style: "margin-left:6px;font-size:11px" }, "verify in game") : null));
}

function stationCard(station, profile, itemNames, rerender) {
  const next = nextLevel(profile, station);

  const header = el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap" },
    el("strong", { style: "color:var(--text-bright)" }, station.name),
    levelControl(station, profile, rerender));

  const children = [header];

  if (!next) {
    children.push(el("p", { style: "color:var(--text-muted);font-size:12px;margin-top:8px" },
      "Fully upgraded. Nothing left to build here."));
    return el("section", { class: "panel" }, ...children);
  }

  const ready = prereqsMet(profile, next);
  const buildTime = fmtBuildTime(next.buildTimeSeconds);
  children.push(el("div", { style: "display:flex;align-items:center;gap:8px;margin:8px 0 4px;flex-wrap:wrap" },
    el("span", { class: "muted", style: "font-size:12px;color:var(--text-muted)" }, `Next: level ${next.level}`),
    el("span", { class: `badge ${ready ? "badge--ok" : ""}` }, ready ? "GATHER ITEMS" : "BLOCKED"),
    buildTime ? el("span", { class: "muted", style: "font-size:12px;color:var(--text-muted)" }, buildTime) : null));

  const checks = requirementChecks(profile, next);
  const rows = [];
  for (const r of checks.stations) rows.push(checkRow(`${r.name} level ${r.level}`, r.met));
  for (const r of checks.traders) rows.push(checkRow(`${traderName(r.trader)} LL${r.level}`, r.met));
  for (const r of checks.skills) rows.push(checkRow(`${r.name} skill ${r.level}`, r.met));
  for (const req of next.items ?? []) {
    const have = haveCount(profile, req.item);
    rows.push(el("li", { style: "margin:3px 0;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap" },
      el("span", {},
        el("span", { style: "color:var(--brass);margin-right:8px;font-weight:bold" }, "\u25a3"),
        `${itemNames.get(req.item) ?? req.item} \u00d7${req.count}`),
      countStepper(req.item, have, req.count, rerender, { compact: true })));
  }
  if (rows.length) {
    children.push(el("ul", { style: "margin:6px 0 0 4px;list-style:none;color:var(--text);font-size:13px" }, ...rows));
  } else {
    children.push(el("p", { style: "color:var(--text-muted);font-size:12px" }, "No requirements — build when ready."));
  }

  return el("section", { class: "panel" }, ...children);
}

function shoppingPanel(profile, itemNames, rerender) {
  const rows = shoppingList(profile, { allLevels: listAllLevels, includeBlocked: listIncludeBlocked });
  const list = el("ul", { class: "datalist" });
  for (const row of rows) {
    const detail = row.sources
      .map((s) => `${s.stationName} L${s.level} ×${s.count}${s.blocked ? " (blocked)" : ""}`)
      .join(" · ");
    const have = haveCount(profile, row.item);
    const done = have >= row.count;
    list.appendChild(el("li", { style: done ? "opacity:.55" : null },
      el("span", { style: "display:inline-flex;align-items:center;gap:10px;flex-wrap:wrap" },
        el("span", { style: "color:var(--text-bright)" }, itemNames.get(row.item) ?? row.item),
        countStepper(row.item, have, row.count, rerender, { compact: true })),
      el("span", { class: "muted", style: "text-align:right;font-size:12px" }, detail)));
  }
  if (!rows.length) {
    list.appendChild(el("li", {}, el("span", { class: "muted" },
      "Nothing to collect — every pending upgrade is covered or the hideout is maxed.")));
  }

  return el("div", { class: "panel" },
    el("div", { class: "panel__title" }, "Shopping List"),
    el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-muted);font-size:12px;margin-bottom:10px" },
      el("input", { type: "checkbox", checked: listAllLevels ? "" : null,
        onchange: (e) => { listAllLevels = e.target.checked; rerender(); } }),
      "Include every remaining level (not just each station's next upgrade)"),
    el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-muted);font-size:12px;margin-bottom:10px" },
      el("input", { type: "checkbox", checked: listIncludeBlocked ? "" : null,
        onchange: (e) => { listIncludeBlocked = e.target.checked; rerender(); } }),
      "Include blocked upgrades (prereqs not met yet)"),
    list);
}

export default {
  id: "hideout",
  title: "Hideout",
  icon: "hideout",
  section: "Base",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const stations = allStations();

      if (!stations.length) {
        container.appendChild(el("div", { class: "panel" },
          el("div", { class: "panel__title" }, "Hideout data not imported yet"),
          el("p", { style: "color:var(--text-muted)" },
            "The shipped data pack contains no hideout stations. Run the importer once (with internet), then refresh:"),
          el("pre", { style: "margin-top:10px;padding:10px;background:rgba(0,0,0,.25);overflow-x:auto;font-size:12px" },
            "cd ~/storage/downloads/tarkov-companion\npython tools/update_data.py")));
        return;
      }

      const itemNames = itemNameMap();
      const prog = hideoutProgress(profile);
      const filterInput = el("input", {
        type: "text", value: stationFilter, placeholder: "Filter stations…",
        oninput: (e) => { stationFilter = e.target.value; drawGrid(); },
      });

      container.appendChild(el("div", { class: "panel", style: "margin-bottom:16px" },
        el("div", { class: "stat-row" },
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, `${prog.built}/${prog.total}`),
            el("span", { class: "stat__label" }, "Levels built")),
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, `${prog.maxed}/${prog.stations}`),
            el("span", { class: "stat__label" }, "Stations maxed")),
          el("div", { style: "flex:1;min-width:160px;align-self:center" },
            el("div", { class: "progress" },
              el("div", { class: "progress__fill", style: `width:${prog.total ? (prog.built / prog.total) * 100 : 0}%` }))),
          el("div", { class: "field", style: "margin:0;flex:1;min-width:160px;align-self:center" },
            el("label", {}, "Filter"), filterInput))));

      container.appendChild(shoppingPanel(profile, itemNames, draw));

      const gridHost = el("div", { style: "margin-top:16px" });
      container.appendChild(gridHost);
      const drawGrid = () => {
        gridHost.innerHTML = "";
        const q = stationFilter.trim().toLowerCase();
        const shown = stations.filter((s) => !q || s.name.toLowerCase().includes(q));
        if (!shown.length) {
          gridHost.appendChild(el("div", { class: "panel" },
            el("p", { style: "color:var(--text-muted)" }, "No stations match the filter.")));
          return;
        }
        gridHost.appendChild(el("div", { class: "grid" },
          ...shown.map((s) => stationCard(s, profile, itemNames, draw))));
      };
      drawGrid();
    };
    draw();
  },
};
