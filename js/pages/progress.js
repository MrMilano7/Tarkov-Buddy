/**
 * progress.js — the Progress page (v0.5 analytics).
 *
 * Headline stats, overall + Kappa progress bars, per-trader completion,
 * hideout build-out, item collection %, and recent completions from
 * profile.questLog. Everything is derived — nothing new is persisted here.
 */
import { el } from "../ui/dom.js";
import { getProfile } from "../core/store.js";
import { navigate } from "../core/router.js";
import { progress, traderProgress, questById } from "../core/questEngine.js";
import { hideoutProgress } from "../core/hideoutEngine.js";
import { collectionProgress } from "../core/inventoryEngine.js";
import * as raidEngine from "../core/raidEngine.js";

function panel(title, ...children) {
  return el("section", { class: "panel" },
    el("div", { class: "panel__title" }, title), ...children);
}

function bar(label, done, total, { brass = false } = {}) {
  const pct = total ? (done / total) * 100 : 0;
  return el("div", { style: "margin-bottom:12px" },
    el("div", { style: "display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px" },
      el("span", { style: "color:var(--text)" }, label),
      el("span", { class: "muted" }, `${done}/${total} · ${Math.round(pct)}%`)),
    el("div", { class: "progress" },
      el("div", { class: "progress__fill", style: `width:${pct}%${brass ? ";background:var(--brass)" : ""}` })));
}

function fmtWhen(ts) {
  const d = new Date(ts);
  const days = (Date.now() - ts) / 86400000;
  if (days < 1) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString();
}

export default {
  id: "progress",
  title: "Progress",
  icon: "progress",
  section: "Overview",
  render(container) {
    const profile = getProfile();
    const q = progress(profile);
    const h = hideoutProgress(profile);
    const items = collectionProgress(profile); // default anti-overwhelm scope
    const traders = traderProgress(profile);

    // Headline stats
    const headline = panel("Headline",
      el("div", { class: "stat-row" },
        el("div", { class: "stat" },
          el("span", { class: "stat__value" }, String(profile.level)),
          el("span", { class: "stat__label" }, "PMC level")),
        el("div", { class: "stat" },
          el("span", { class: "stat__value" }, `${q.completed}/${q.total}`),
          el("span", { class: "stat__label" }, "Quests")),
        el("div", { class: "stat" },
          el("span", { class: "stat__value" }, `${q.kappaDone}/${q.kappaTotal}`),
          el("span", { class: "stat__label" }, "Kappa quests")),
        el("div", { class: "stat" },
          el("span", { class: "stat__value" }, `${h.built}/${h.total}`),
          el("span", { class: "stat__label" }, "Hideout levels")),
      ));

    const overall = panel("Quest Completion",
      bar("All quests", q.completed, q.total),
      bar("Kappa (Collector) quests", q.kappaDone, q.kappaTotal, { brass: true }),
      el("p", { style: "color:var(--text-muted);font-size:12px" },
        q.kappaTotal
          ? `${q.kappaTotal - q.kappaDone} Kappa-required quests to go.`
          : "No Kappa data in the current data pack."));

    const perTrader = panel("Per-Trader Progress",
      traders.length
        ? el("div", {}, ...traders.map((t) => bar(t.name, t.done, t.total)))
        : el("p", { style: "color:var(--text-muted);font-size:13px" }, "No trader quest data."));

    const hideoutPanel = panel("Hideout Build-out",
      h.stations
        ? el("div", {},
            bar("Levels built", h.built, h.total),
            el("p", { style: "color:var(--text-muted);font-size:12px" },
              `${h.maxed} of ${h.stations} stations fully upgraded.`))
        : el("p", { style: "color:var(--text-muted);font-size:13px" },
            "No hideout data — run the importer."));

    const collection = panel("Item Collection",
      items.needed
        ? el("div", {},
            bar("Needed items collected", items.collected, items.needed),
            el("p", { style: "color:var(--text-muted);font-size:12px" },
              `${items.itemsDone} of ${items.items} item types fully collected (active-quest + next-upgrade scope). Track counts on the Needed Items page.`))
        : el("p", { style: "color:var(--text-muted);font-size:13px" },
            "Nothing needed in the default scope right now."));

    // Recent completions from questLog, newest first.
    const logEntries = Object.entries(profile.questLog ?? {})
      .filter(([id]) => profile.completedQuests.includes(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    const recentList = el("ul", { class: "datalist" });
    for (const [id, ts] of logEntries) {
      recentList.appendChild(el("li", {},
        el("span", { style: "color:var(--text-bright)" }, questById(id)?.name ?? id),
        el("span", { class: "muted" }, fmtWhen(ts))));
    }
    if (!logEntries.length) {
      recentList.appendChild(el("li", {}, el("span", { class: "muted" },
        "No timestamped completions yet — quests completed from v0.5 onward show up here.")));
    }
    const recent = panel("Recent Completions", recentList);

    // Raid stats (v0.8.1) — from raidEngine, feeding personal risk weighting.
    const raidStats = raidEngine.stats(profile);
    const raidPanel = panel("Raid Performance",
      raidStats.total
        ? el("div", {},
            el("div", { class: "stat-row" },
              el("div", { class: "stat" },
                el("span", { class: "stat__value" }, String(raidStats.total)),
                el("span", { class: "stat__label" }, "Raids logged")),
              el("div", { class: "stat" },
                el("span", { class: "stat__value" }, `${Math.round(raidStats.survivalRate * 100)}%`),
                el("span", { class: "stat__label" }, "Survival rate")),
              el("div", { class: "stat" },
                el("span", { class: "stat__value" }, raidStats.kd.toFixed(2)),
                el("span", { class: "stat__label" }, "K/D"))),
            el("button", { class: "btn btn--ghost", style: "margin-top:12px",
              onclick: () => navigate("raidlog") }, "Open Raid Log"))
        : el("div", {},
            el("p", { style: "color:var(--text-muted);font-size:13px" },
              "No raids logged yet — the Raid Log page feeds your personal risk/familiarity weighting into the Advisor."),
            el("button", { class: "btn btn--ghost", style: "margin-top:10px",
              onclick: () => navigate("raidlog") }, "Log a Raid")));

    const favoriteMaps = raidEngine.byMap(profile).slice(0, 5);
    const favoritesPanel = panel("Favorite Maps",
      favoriteMaps.length
        ? el("ul", { class: "datalist" }, ...favoriteMaps.map((m) =>
            el("li", {},
              el("span", { style: "color:var(--text-bright)" }, m.name),
              el("span", { class: "muted" }, `${m.raids} raids · ${Math.round(m.survivalRate * 100)}% survival`))))
        : el("p", { style: "color:var(--text-muted);font-size:13px" }, "No raid history yet."));

    container.appendChild(el("div", { class: "grid" },
      el("div", { class: "span-2" }, headline),
      overall, perTrader, hideoutPanel, collection, recent, raidPanel, favoritesPanel));
  },
};
