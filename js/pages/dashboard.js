/**
 * dashboard.js — the home page (v0.8 overhaul).
 *
 * Mockup-style command-center layout. Every number is derived from the
 * player profile + JSON datasets; nothing is hardcoded or invented.
 * Stats the raid logger will unlock later (survival rate, K/D) are
 * intentionally absent rather than faked.
 */
import { el } from "../ui/dom.js";
import { getProfile, update as updateProfile } from "../core/store.js";
import { get, stats } from "../core/dataLoader.js";
import { navigate } from "../core/router.js";
import {
  allStations, nextLevel, prereqsMet, requirementChecks, hideoutProgress,
} from "../core/hideoutEngine.js";
import { progress as questProgress, questsByState, traderProgress } from "../core/questEngine.js";
import { collectionProgress, neededItems } from "../core/inventoryEngine.js";
import { mapScores, mapPlan, orderRoute } from "../core/routeEngine.js";
import { recommendations } from "../core/advisorEngine.js";
import * as raidEngine from "../core/raidEngine.js";

/* ---------- helpers ---------- */
function panel(title, opts, ...children) {
  const { seeAll } = opts ?? {};
  const head = seeAll
    ? el("div", { class: "panel__head" },
        el("div", { class: "panel__title" }, title),
        el("button", { class: "link", onclick: () => navigate(seeAll) }, "See all"))
    : el("div", { class: "panel__title" }, title);
  return el("section", { class: "panel" }, head, ...children);
}

const pct = (done, total) => (total ? (done / total) * 100 : 0);

function bar(width, brass = false) {
  return el("div", { class: "progress" },
    el("div", {
      class: `progress__fill${brass ? " progress__fill--brass" : ""}`,
      style: `width:${Math.min(100, width)}%`,
    }));
}

function bumpLevel(delta) {
  updateProfile((p) => {
    p.level = Math.min(79, Math.max(1, p.level + delta));
  });
}

function levelStepper(level) {
  return el("span", { class: "lvl-stepper" },
    el("button", {
      class: "lvl-stepper__btn", "aria-label": "Decrease level",
      onclick: () => bumpLevel(-1),
    }, "–"),
    el("em", {}, `Level ${level}`),
    el("button", {
      class: "lvl-stepper__btn", "aria-label": "Increase level",
      onclick: () => bumpLevel(1),
    }, "+"),
  );
}

/* ---------- player strip ---------- */
function playerStrip(profile) {
  const qp = questProgress(profile);
  const hp = hideoutProgress(profile);
  const cp = collectionProgress(profile);
  const rs = raidEngine.stats(profile);

  const cell = (value, label, sub) =>
    el("div", { class: "pstrip__cell" },
      el("span", { class: "pstrip__value" }, value),
      el("span", { class: "pstrip__label" }, label),
      sub ?? null);

  return el("section", { class: "panel pstrip" },
    el("div", { class: "pstrip__cell pstrip__id" },
      el("div", { class: "pstrip__name" },
        profile.name, levelStepper(profile.level)),
      el("div", { class: "pstrip__meta" }, `${profile.faction} · ${qp.completed}/${qp.total} quests complete`),
      bar(pct(qp.completed, qp.total))),
    cell(`${Math.round(pct(qp.kappaDone, qp.kappaTotal))}%`, "Kappa",
      el("span", { class: "pstrip__meta" }, `${qp.kappaDone}/${qp.kappaTotal}`)),
    cell(hp.stations ? `${hp.built}/${hp.total}` : "—", "Hideout levels",
      hp.stations ? el("span", { class: "pstrip__meta" }, `${hp.maxed} maxed`) : null),
    cell(`${Math.round(cp.pct)}%`, "Items collected",
      el("span", { class: "pstrip__meta" }, `${cp.collected}/${cp.needed} needed`)),
    cell(rs.total ? `${Math.round(rs.survivalRate * 100)}%` : "—", "Survival rate",
      rs.total ? el("span", { class: "pstrip__meta" }, `${rs.total} raids logged`) : null),
    cell(rs.total ? rs.kd.toFixed(2) : "—", "K/D"),
  );
}

/* ---------- recommended raid hero ---------- */
function heroPanel(profile) {
  const scores = mapScores(profile);
  const best = scores[0];
  if (!best) {
    return panel("Recommended raid", null,
      el("p", { style: "color:var(--text-muted);font-size:13px" },
        "No active quests to rank maps by — complete prerequisites or check the Quests page."),
      el("button", { class: "btn btn--ghost", style: "margin-top:10px", onclick: () => navigate("quests") }, "Open Quests"));
  }

  const why = [];
  why.push(`${best.quests} active quest${best.quests === 1 ? "" : "s"}, ${best.objectives} objective${best.objectives === 1 ? "" : "s"} on this map`);
  if (best.kappaQuests) why.push(`${best.kappaQuests} Kappa-required quest${best.kappaQuests === 1 ? "" : "s"} (weighted 2×)`);
  if (best.itemPickups) why.push(`${best.itemPickups} still-needed handover item${best.itemPickups === 1 ? "" : "s"} can drop here`);
  if (best.familiarity) why.push(`+${best.familiarity} familiarity bonus — you've logged good survival rates here`);
  const entries = mapPlan(profile).get(best.mapId) ?? [];
  const route = orderRoute(best.mapId, entries, profile);
  if (route.extractOptions?.[0]) {
    const ex = route.extractOptions[0];
    why.push(`Suggested extract: ${ex.name}${ex.faction !== "Any" ? ` (${ex.faction})` : ""}${ex.requires ? " — not guaranteed open" : ""}`);
  }
  const runnerUp = scores[1];
  if (runnerUp) why.push(`Next best: ${runnerUp.name} (score ${runnerUp.score})`);

  return el("section", { class: "hero span-all" },
    el("div", { class: "hero__main" },
      el("div", { class: "hero__kicker" }, "★ Recommended raid"),
      el("div", { class: "hero__title" }, best.name),
      el("ul", { class: "hero__why" }, why.map((w) => el("li", {}, w)))),
    el("div", { class: "hero__side" },
      el("div", { class: "hero__score" },
        el("b", {}, String(best.score)),
        el("span", {}, "priority score")),
      el("button", { class: "btn", onclick: () => navigate("maps") }, "View route")),
  );
}

/* ---------- priorities (advisor) ---------- */
const KIND_LABEL = { build: "BUILD", raid: "RAID", level: "LEVEL", kappa: "KAPPA" };

function prioritiesPanel(profile) {
  const recs = recommendations(profile).slice(0, 5);
  if (!recs.length) {
    return panel("Your priorities", { seeAll: "advisor" },
      el("p", { style: "color:var(--text-muted);font-size:13px" }, "Nothing urgent — the Coach has the full picture."));
  }
  const list = el("ol", { class: "priolist" });
  recs.forEach((r, i) => {
    list.appendChild(el("li", { onclick: () => navigate(r.page) },
      el("span", { class: "priolist__num" }, String(i + 1)),
      el("div", { class: "priolist__body" },
        el("div", { class: "priolist__title" }, r.title),
        el("div", { class: "priolist__why" }, r.why)),
      el("span", { class: "badge badge--green" }, KIND_LABEL[r.kind] ?? r.kind.toUpperCase()),
    ));
  });
  return panel("Your priorities", { seeAll: "advisor" }, list);
}

/* ---------- active quests ---------- */
function activeQuestsPanel(profile) {
  const { active } = questsByState(profile);
  const traders = get("traders")?.traders ?? [];
  const maps = get("maps")?.maps ?? [];
  const tName = (id) => traders.find((t) => t.id === id)?.name ?? id;
  const mName = (id) => (!id || id === "any") ? "Any map" : (maps.find((m) => m.id === id)?.name ?? id);

  if (!active.length) {
    return panel("Active quests", { seeAll: "quests" },
      el("p", { style: "color:var(--text-muted);font-size:13px" }, "No quests are active at your current level."));
  }
  // Kappa quests first, then by minLevel — the ones most worth doing now.
  const shown = [...active]
    .sort((a, b) => (b.kappa - a.kappa) || (a.minLevel - b.minLevel))
    .slice(0, 5);

  const rows = shown.map((q) => el("div", { class: "qrow" },
    el("div", { class: "qrow__body" },
      el("div", { class: "qrow__name" }, q.name),
      el("div", { class: "qrow__sub" },
        `${tName(q.trader)} · ${q.objectives.length} objective${q.objectives.length === 1 ? "" : "s"}${q.kappa ? " · Kappa" : ""}`)),
    el("span", { class: "qrow__map" }, mName(q.map)),
  ));
  return panel(`Active quests (${active.length})`, { seeAll: "quests" }, ...rows);
}

/* ---------- hideout: next build ---------- */
function hideoutPanel(profile) {
  const hp = hideoutProgress(profile);
  if (!hp.stations) {
    return panel("Hideout status", { seeAll: "hideout" },
      el("p", { style: "color:var(--text-muted);font-size:13px" },
        "No hideout data yet — run the importer, then plan your build-out."));
  }

  // Prefer a station whose prerequisites are met; fall back to any upgradable.
  let pick = null;
  for (const s of allStations()) {
    const next = nextLevel(profile, s);
    if (!next) continue;
    const met = prereqsMet(profile, next);
    if (met && !pick?.met) pick = { station: s, next, met };
    else if (!pick) pick = { station: s, next, met };
    if (pick?.met) break;
  }

  if (!pick) {
    return panel("Hideout status", { seeAll: "hideout" },
      el("p", { style: "color:var(--text-muted);font-size:13px" }, "Every station is maxed. Impressive."),
      bar(100));
  }

  const checks = requirementChecks(profile, pick.next);
  const list = el("ul", { class: "checklist" });
  for (const c of checks.stations) list.appendChild(el("li", { class: c.met ? "ok" : "no" }, `${c.name} level ${c.level}`));
  for (const c of checks.traders) list.appendChild(el("li", { class: c.met ? "ok" : "no" }, `${c.trader} LL${c.level}`));
  for (const c of checks.skills) list.appendChild(el("li", { class: "info" }, `${c.name} level ${c.level} (check in game)`));
  const itemReqs = pick.next.items ?? [];
  if (itemReqs.length) list.appendChild(el("li", { class: "info" }, `${itemReqs.length} item requirement${itemReqs.length === 1 ? "" : "s"} — see planner`));

  return panel("Hideout status", { seeAll: "hideout" },
    el("div", { class: "qrow", style: "border:none;padding-top:0" },
      el("div", { class: "qrow__body" },
        el("div", { class: "qrow__name" }, `${pick.station.name} → level ${pick.next.level}`),
        el("div", { class: "qrow__sub" }, pick.met ? "Prerequisites met" : "Blocked — see below")),
      el("span", { class: `badge ${pick.met ? "badge--green" : ""}` }, pick.met ? "READY" : "BLOCKED")),
    list,
    el("div", { style: "margin-top:10px" }, bar(pct(hp.built, hp.total))),
    el("div", { class: "qrow__sub", style: "margin-top:4px" }, `${hp.built}/${hp.total} levels built · ${hp.maxed}/${hp.stations} stations maxed`),
  );
}

/* ---------- needed items (smart loot mini) ---------- */
function lootPanel(profile) {
  const rows = neededItems(profile)
    .filter((r) => r.remaining > 0)
    .slice(0, 5); // engine already sorts by most-still-needed

  if (!rows.length) {
    return panel("Smart loot advisor", { seeAll: "inventory" },
      el("p", { style: "color:var(--text-muted);font-size:13px" }, "Everything currently needed is collected."));
  }
  const items = rows.map((r) => {
    const labels = [...new Set(r.sources.map((s) => s.label))];
    const sub = labels.slice(0, 2).join(" · ") + (labels.length > 2 ? ` · +${labels.length - 2} more` : "");
    return el("div", { class: "qrow" },
      el("div", { class: "qrow__body" },
        el("div", { class: "qrow__name" }, `${r.item?.name ?? r.itemId}${r.fir ? " (FiR)" : ""}`),
        el("div", { class: "qrow__sub" }, sub)),
      el("span", { class: "badge badge--brass" }, `${r.have}/${r.needed}`),
    );
  });
  return panel("Smart loot advisor", { seeAll: "inventory" }, ...items);
}

/* ---------- trader progress grid ---------- */
function traderPanel(profile) {
  const rows = traderProgress(profile);
  if (!rows.length) {
    return panel("Trader progress", { seeAll: "traders" },
      el("p", { style: "color:var(--text-muted);font-size:13px" }, "No trader quest data loaded."));
  }
  const grid = el("div", { class: "tgrid" });
  for (const r of rows) {
    const ll = profile.traderLevels?.[r.trader] ?? 1;
    grid.appendChild(el("div", { class: "tgrid__cell" },
      el("span", { class: "tgrid__name" }, r.name),
      el("span", { class: "tgrid__pct" }, `LL${ll} · ${r.done}/${r.total}`),
      bar(r.pct)));
  }
  return panel("Trader progress", { seeAll: "progress" }, grid);
}

/* ---------- data status (compact) ---------- */
function dataPanel() {
  const s = stats();
  const ok = s.loaded === s.total;
  return panel("Data status", null,
    el("ul", { class: "datalist" },
      el("li", {},
        el("span", {}, "Datasets"),
        el("span", { class: `badge ${ok ? "badge--ok" : ""}` }, `${s.loaded}/${s.total}`)),
      el("li", {},
        el("span", {}, "Game version"),
        el("span", { class: "muted" }, s.gameVersion)),
      el("li", {},
        el("span", {}, "Data pack"),
        el("span", { class: "muted" }, s.dataVersion)),
    ));
}

/* ---------- raid log summary ---------- */
function raidLogPanel(profile) {
  const recentRaids = raidEngine.recent(profile, 4);
  if (!recentRaids.length) {
    return panel("Raid log", { seeAll: "raidlog" },
      el("p", { style: "color:var(--text-muted);font-size:13px" },
        "Nothing logged yet — log raids to build your personal risk model."),
      el("button", { class: "btn btn--ghost", style: "margin-top:10px", onclick: () => navigate("raidlog") }, "Log a raid"));
  }
  const rows = recentRaids.map((r) => el("div", { class: "qrow" },
    el("div", { class: "qrow__body" },
      el("div", { class: "qrow__name" }, r.name),
      el("div", { class: "qrow__sub" }, `${r.kills} kills · ₽${r.lootValue.toLocaleString("en-US")}`)),
    el("span", { class: `badge ${r.survived ? "badge--ok" : ""}` }, r.survived ? "ALIVE" : "DEAD"),
  ));
  return panel("Raid log", { seeAll: "raidlog" }, ...rows);
}

export default {
  id: "dashboard",
  title: "Dashboard",
  icon: "dashboard",
  section: "Overview",
  render(container) {
    const profile = getProfile();
    container.appendChild(el("div", { class: "grid" },
      el("div", { class: "span-all" }, playerStrip(profile)),
      heroPanel(profile),
      el("div", { class: "span-2" }, prioritiesPanel(profile)),
      activeQuestsPanel(profile),
      hideoutPanel(profile),
      lootPanel(profile),
      traderPanel(profile),
      raidLogPanel(profile),
      dataPanel(),
    ));
  },
};
