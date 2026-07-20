/**
 * loot.js — the Loot Advisor (keep/sell system).
 *
 * Verdict logic, in priority order:
 *   1. KEEP  — an uncompleted quest still needs it (FIR flagged), or a
 *              pending hideout upgrade requires it (v0.3)
 *   2. FLEA  — flea value per slot clears the "worth carrying" threshold
 *   3. SELL  — everything else goes to a trader
 *
 * Scope philosophy (anti-overwhelm): quests count active ones only unless
 * the look-ahead toggle is on; hideout counts each station's NEXT upgrade
 * only (hideoutEngine.hideoutNeededItems default).
 */
import { el, roubles } from "../ui/dom.js";
import { getProfile } from "../core/store.js";
import { get } from "../core/dataLoader.js";
import { questNeededItems } from "../core/questEngine.js";
import { hideoutNeededItems } from "../core/hideoutEngine.js";
import { haveCount } from "../core/inventoryEngine.js";

const FLEA_PER_SLOT_THRESHOLD = 15000; // ₽/slot — tune per wipe economy

let searchTerm = "";
let includeUpcoming = false; // when true, also hoard for locked quests within +10 levels
const MAX_ROWS = 250; // full item DB is ~4000 records; render the top slice

function verdictFor(item, needs, hideoutNeeds, profile) {
  const questNeed = needs.get(item.id);
  const hideoutNeed = hideoutNeeds.get(item.id);
  if (questNeed || hideoutNeed) {
    const totalNeeded =
      (questNeed ?? []).reduce((sum, n) => sum + n.count, 0) +
      (hideoutNeed ?? []).reduce((sum, n) => sum + n.count, 0);
    const have = haveCount(profile, item.id);

    // Fully collected (v0.5): the need is satisfied, so the verdict falls
    // through to the normal FLEA/SELL economics with a "collected ✓" note.
    if (have >= totalNeeded) {
      const note = " · needs collected ✓";
      const perSlotC = Math.round(item.avgPrice / item.slots);
      if (!item.fleaBanned && perSlotC >= FLEA_PER_SLOT_THRESHOLD) {
        return { verdict: "FLEA", cls: "badge--brass", reason: `${roubles(perSlotC)}/slot on the flea market${note}` };
      }
      return { verdict: "SELL", cls: "", reason: `Trader sale ${roubles(item.traderSell)}${item.fleaBanned ? " (flea banned)" : ""}${note}` };
    }

    const reasons = [];
    if (questNeed) {
      const quests = questNeed.map((n) =>
        `${n.quest.name} ×${n.count}${n.foundInRaid ? " (FIR)" : ""}${n.upcoming ? " — upcoming" : ""}`);
      reasons.push(`Quest: ${quests.join("; ")}`);
    }
    if (hideoutNeed) {
      const upgrades = hideoutNeed.map((n) => `${n.stationName} L${n.level} ×${n.count}`);
      reasons.push(`Hideout: ${upgrades.join("; ")}`);
    }
    reasons.push(`have ${have}/${totalNeeded}`);
    return { verdict: "KEEP", cls: "badge--ok", reason: reasons.join(" · ") };
  }
  const perSlot = Math.round(item.avgPrice / item.slots);
  if (!item.fleaBanned && perSlot >= FLEA_PER_SLOT_THRESHOLD) {
    return { verdict: "FLEA", cls: "badge--brass", reason: `${roubles(perSlot)}/slot on the flea market` };
  }
  return { verdict: "SELL", cls: "", reason: `Trader sale ${roubles(item.traderSell)}${item.fleaBanned ? " (flea banned)" : ""}` };
}

function itemRow(item, needs, hideoutNeeds, profile) {
  const v = verdictFor(item, needs, hideoutNeeds, profile);
  return el("li", {},
    el("span", {},
      el("span", { class: `badge ${v.cls}`, style: "margin-right:10px;min-width:44px;display:inline-block;text-align:center" }, v.verdict),
      el("span", { style: "color:var(--text-bright)" }, item.name),
      el("span", { class: "muted", style: "margin-left:8px" }, `${item.category} · ${item.slots} slot${item.slots > 1 ? "s" : ""}`)),
    el("span", { class: "muted", style: "text-align:right" }, v.reason)
  );
}

export default {
  id: "loot",
  title: "Loot Advisor",
  icon: "loot",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const items = get("items")?.items ?? [];
      const needs = questNeededItems(profile, { includeLocked: includeUpcoming, levelWindow: 10 });
      const hideoutNeeds = hideoutNeededItems(profile); // next upgrades only
      const isNeeded = (id) => needs.has(id) || hideoutNeeds.has(id);

      const input = el("input", {
        type: "text", value: searchTerm, placeholder: "Filter items…",
        oninput: (e) => { searchTerm = e.target.value; list.replaceChildren(...rows()); },
      });

      const rows = () => {
        const q = searchTerm.trim().toLowerCase();
        const filtered = items
          .filter((i) => !q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q))
          .sort((a, b) => {
            const av = isNeeded(a.id) ? 0 : 1;
            const bv = isNeeded(b.id) ? 0 : 1;
            return av - bv || b.avgPrice / b.slots - a.avgPrice / a.slots;
          });
        if (!filtered.length) {
          return [el("li", {}, el("span", { class: "muted" }, "No items match."))];
        }
        const shown = filtered.slice(0, MAX_ROWS).map((i) => itemRow(i, needs, hideoutNeeds, profile));
        if (filtered.length > MAX_ROWS) {
          shown.push(el("li", {}, el("span", { class: "muted" },
            `Showing top ${MAX_ROWS} of ${filtered.length} — type in the filter to narrow down.`)));
        }
        return shown;
      };

      const keepCount = items.filter((i) => isNeeded(i.id)).length;

      container.appendChild(el("div", { class: "panel", style: "margin-bottom:16px" },
        el("div", { class: "stat-row" },
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, String(keepCount)),
            el("span", { class: "stat__label" }, "Items quests/hideout need")),
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, String(items.length)),
            el("span", { class: "stat__label" }, "Items in database")),
          el("div", { class: "field", style: "margin:0;flex:1;min-width:180px;align-self:center" },
            el("label", {}, "Filter"), input),
          el("label", { style: "display:flex;align-items:center;gap:8px;align-self:center;cursor:pointer;color:var(--text-muted);font-size:12px" },
            el("input", { type: "checkbox", checked: includeUpcoming ? "" : null,
              onchange: (e) => { includeUpcoming = e.target.checked; draw(); } }),
            "Also keep for upcoming quests (next 10 levels)"))));

      const list = el("ul", { class: "datalist" }, ...rows());
      container.appendChild(el("div", { class: "panel" },
        el("div", { class: "panel__title" }, "Keep / Sell verdicts"),
        el("p", { style: "color:var(--text-muted);font-size:12px;margin-bottom:10px" },
          "KEEP — a quest you can do right now needs it (FIR = found in raid), or your next hideout upgrade requires it. Tick the checkbox to also hoard for quests unlocking within your next 10 levels. FLEA — worth listing. SELL — trader fodder."),
        list));
    };
    draw();
  },
};
