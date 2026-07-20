/**
 * quests.js — the Quest Tracker.
 * Renders every quest with live availability from questEngine, filterable
 * by status / trader / map. Completing a quest persists to the profile
 * and immediately unlocks its dependents.
 */
import { el } from "../ui/dom.js";
import { countStepper } from "../ui/countStepper.js";
import { haveCount } from "../core/inventoryEngine.js";
import { get as getData } from "../core/dataLoader.js";
import { toast } from "../ui/dom.js";
import { getProfile, update } from "../core/store.js";
import { get } from "../core/dataLoader.js";
import { relevantQuests, allQuests, questState, lockReasons, progress } from "../core/questEngine.js";

const STATE_ORDER = { active: 0, locked: 1, completed: 2 };
const STATE_LABEL = { active: "Active", locked: "Locked", completed: "Done" };
const STATE_BADGE = { active: "badge--ok", locked: "", completed: "badge--brass" };

// Filter state survives re-renders within the session.
const filters = { status: "active", trader: "all", map: "all", kappaOnly: false };

function traderName(id) {
  return get("traders")?.traders.find((t) => t.id === id)?.name ?? id;
}
function mapName(id) {
  if (id === "any") return "Any map";
  return get("maps")?.maps.find((m) => m.id === id)?.name ?? id;
}

function filterBar(rerender) {
  const select = (key, options) => {
    const s = el("select", { onchange: (e) => { filters[key] = e.target.value; rerender(); } },
      ...options.map(([value, label]) =>
        el("option", { value, selected: filters[key] === value ? "" : null }, label)));
    return s;
  };

  const traders = get("traders")?.traders ?? [];
  const maps = get("maps")?.maps ?? [];

  return el("div", { class: "panel", style: "margin-bottom:16px" },
    el("div", { style: "display:flex;gap:14px;flex-wrap:wrap" },
      el("div", { class: "field", style: "margin:0;flex:1;min-width:120px" },
        el("label", {}, "Status"),
        select("status", [["all", "All"], ["active", "Active"], ["locked", "Locked"], ["completed", "Completed"], ["hidden", "Hidden"]])),
      el("div", { class: "field", style: "margin:0;flex:1;min-width:120px" },
        el("label", {}, "Trader"),
        select("trader", [["all", "All traders"], ...traders.map((t) => [t.id, t.name])])),
      el("div", { class: "field", style: "margin:0;flex:1;min-width:120px" },
        el("label", {}, "Map"),
        select("map", [["all", "All maps"], ["any", "Any map"], ...maps.map((m) => [m.id, m.name])])),
      el("label", { style: "display:flex;align-items:center;gap:8px;align-self:end;cursor:pointer;color:var(--text-muted);font-size:12px;padding-bottom:8px" },
        el("input", { type: "checkbox", checked: filters.kappaOnly ? "" : null,
          onchange: (e) => { filters.kappaOnly = e.target.checked; rerender(); } }),
        "Kappa only"),
    )
  );
}

function questCard(quest, profile, rerender) {
  const state = questState(quest, profile);

  const header = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
    el("strong", { style: "color:var(--text-bright)" }, quest.name),
    el("span", { class: `badge ${STATE_BADGE[state]}` }, STATE_LABEL[state]),
    quest.kappa ? el("span", { class: "badge badge--brass", title: "Required for Kappa" }, "KAPPA") : null,
  );

  const meta = el("div", { class: "muted", style: "font-size:12px;color:var(--text-muted);margin:4px 0 8px" },
    `${traderName(quest.trader)} · ${mapName(quest.map)} · Level ${quest.minLevel}+`,
    quest.wikiLink ? el("a", { href: quest.wikiLink, target: "_blank", rel: "noopener",
      style: "margin-left:8px;color:var(--brass)" }, "wiki guide ↗") : null);

  const objectives = el("ul", { style: "margin:0 0 10px 18px;color:var(--text)" },
    ...quest.objectives.map((o) => el("li", { style: "margin:2px 0" }, o)));

  const children = [header, meta, objectives];

  // v0.9.2: hand-in items get inline steppers (same counts as Needed Items
  // and the Hideout shopping list — profile.inventory is the one truth).
  // Shown on active quests only; completed hand-ins are history, and locked
  // quests already surface through the Needed Items look-ahead toggle.
  if (state === "active" && quest.requiredItems?.length) {
    const itemNames = new Map((getData("items")?.items ?? []).map((i) => [i.id, i.name]));
    children.push(el("div", { style: "margin:0 0 10px" },
      el("div", { style: "font-size:12px;color:var(--text-muted);margin-bottom:4px" }, "Hand-in items"),
      ...quest.requiredItems.map((req) =>
        el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:3px 0;font-size:13px" },
          el("span", {},
            itemNames.get(req.item) ?? req.item,
            ` \u00d7${req.count}`,
            req.foundInRaid ? el("span", { class: "badge badge--brass", style: "margin-left:6px" }, "FIR") : null),
          countStepper(req.item, haveCount(profile, req.item), req.count, rerender, { compact: true, fir: req.foundInRaid })))));
  }

  if (state === "locked") {
    children.push(el("div", { style: "font-size:12px;color:var(--alert);margin-bottom:8px" },
      lockReasons(quest, profile).join(" · ")));
  }

  const r = quest.rewards ?? {};
  const rewardBits = [];
  if (r.exp) rewardBits.push(`${r.exp.toLocaleString()} EXP`);
  if (r.roubles) rewardBits.push(`\u20BD ${r.roubles.toLocaleString()}`);
  if (r.dollars) rewardBits.push(`$${r.dollars.toLocaleString()}`);
  if (r.unlocks) rewardBits.push(`Unlocks: ${r.unlocks}`);
  if (rewardBits.length) {
    children.push(el("div", { style: "font-size:12px;color:var(--text-muted);margin-bottom:10px" },
      `Rewards: ${rewardBits.join(" · ")}`));
  }

  const hideBtn = el("button", {
    class: "btn btn--ghost",
    title: "Hide event/story quests that unlock via in-game triggers",
    onclick: async () => {
      await update((p) => {
        p.hiddenQuests = p.hiddenQuests ?? [];
        if (!p.hiddenQuests.includes(quest.id)) p.hiddenQuests.push(quest.id);
      });
      toast(`"${quest.name}" hidden. Find it under Status: Hidden.`);
      rerender();
    },
  }, "Hide");

  if (state === "active") {
    children.push(el("div", { style: "display:flex;gap:8px" }, el("button", {
      class: "btn",
      onclick: async () => {
        await update((p) => {
          if (!p.completedQuests.includes(quest.id)) p.completedQuests.push(quest.id);
          p.questLog = p.questLog ?? {};
          p.questLog[quest.id] = Date.now();
        });
        toast(`"${quest.name}" completed.`);
        rerender();
      },
    }, "Mark Completed"), hideBtn));
  } else if (state === "completed") {
    children.push(el("button", {
      class: "btn btn--ghost",
      onclick: async () => {
        await update((p) => {
          p.completedQuests = p.completedQuests.filter((id) => id !== quest.id);
          if (p.questLog) delete p.questLog[quest.id];
        });
        rerender();
      },
    }, "Undo"));
  } else {
    children.push(hideBtn);
  }

  return el("section", { class: "panel" }, ...children);
}

export default {
  id: "quests",
  title: "Quests",
  icon: "quests",
  section: "Progression",
  render(container) {
    const draw = () => {
      const rerenderSafe = () => draw();
      container.innerHTML = "";
      const profile = getProfile();
      const p = progress(profile);

      container.appendChild(el("div", { class: "panel", style: "margin-bottom:16px" },
        el("div", { class: "stat-row" },
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, `${p.completed}/${p.total}`),
            el("span", { class: "stat__label" }, "Quests completed")),
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, `${p.kappaDone}/${p.kappaTotal}`),
            el("span", { class: "stat__label" }, "Kappa progress")),
          el("div", { style: "flex:1;min-width:160px;align-self:center" },
            el("div", { class: "progress" },
              el("div", { class: "progress__fill", style: `width:${p.total ? (p.completed / p.total) * 100 : 0}%` })))
        )));

      container.appendChild(filterBar(draw));

      if (filters.status === "hidden") {
        const hidden = allQuests().filter((q) => (profile.hiddenQuests ?? []).includes(q.id));
        container.appendChild(el("div", { class: "grid" },
          ...(hidden.length ? hidden : []).map((q) =>
            el("section", { class: "panel" },
              el("strong", { style: "color:var(--text-bright)" }, q.name),
              el("p", { class: "muted", style: "font-size:12px;color:var(--text-muted);margin:4px 0 10px" },
                `${traderName(q.trader)} · Level ${q.minLevel}+`),
              el("button", {
                class: "btn btn--ghost",
                onclick: async () => {
                  await update((p) => { p.hiddenQuests = (p.hiddenQuests ?? []).filter((id) => id !== q.id); });
                  rerenderSafe();
                },
              }, "Unhide")))));
        if (!hidden.length) {
          container.appendChild(el("div", { class: "panel" },
            el("p", { style: "color:var(--text-muted)" }, "No hidden quests.")));
        }
        return;
      }

      let quests = relevantQuests(profile)
        .filter((q) => filters.trader === "all" || q.trader === filters.trader)
        .filter((q) => filters.map === "all" || q.map === filters.map)
        .filter((q) => !filters.kappaOnly || q.kappa)
        .filter((q) => filters.status === "all" || questState(q, profile) === filters.status)
        .sort((a, b) =>
          STATE_ORDER[questState(a, profile)] - STATE_ORDER[questState(b, profile)] ||
          a.minLevel - b.minLevel);

      if (!quests.length) {
        container.appendChild(el("div", { class: "panel" },
          el("p", { style: "color:var(--text-muted)" }, "No quests match these filters. Clear a filter to see more.")));
        return;
      }

      container.appendChild(el("div", { class: "grid" },
        ...quests.map((q) => questCard(q, profile, draw))));
    };
    draw();
  },
};
