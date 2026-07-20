/**
 * inventory.js — the Needed Items page (v0.5).
 *
 * One consolidated list of everything quests + hideout still need, with
 * manual − [have/needed] + counters persisted to profile.inventory.
 * Scope defaults match the Loot Advisor (active quests) and the Hideout
 * Planner (next upgrades only), with the same opt-in toggles.
 */
import { el } from "../ui/dom.js";
import { getProfile, update } from "../core/store.js";
import { neededItems, collectionProgress } from "../core/inventoryEngine.js";
import { countStepper } from "../ui/countStepper.js";

let searchTerm = "";
let hideCollected = false;
let includeUpcoming = false; // quest look-ahead (locked quests within +10 levels)
let allHideoutLevels = false; // full hideout build-out vs next upgrades

const MAX_ROWS = 250;

function scopeOpts() {
  return { includeLocked: includeUpcoming, levelWindow: 10, allLevels: allHideoutLevels };
}

/** The count control — shared component since v0.9.2 (see ui/countStepper.js). */
function countControl(row, rerenderRow) {
  return countStepper(row.itemId, row.have, row.needed, rerenderRow, { fir: row.fir });
}

function sourceLine(row) {
  const bits = row.sources.map((s) => {
    let label = `${s.type === "quest" ? "Quest" : "Hideout"}: ${s.label} ×${s.count}`;
    if (s.fir) label += " (FIR)";
    if (s.upcoming) label += " — upcoming";
    if (s.blocked) label += " (blocked)";
    return label;
  });
  return bits.join(" · ");
}

function itemRow(row, redraw) {
  const done = row.have >= row.needed;
  return el("li", { style: done ? "opacity:.55" : null },
    el("span", {},
      countControl(row, redraw),
      el("span", { style: "color:var(--text-bright);margin-left:10px" }, row.item.name),
      row.fir ? el("span", { class: "badge", style: "margin-left:8px", title: "At least one quest needs this found in raid" }, "FIR") : null,
      done ? el("span", { class: "badge badge--ok", style: "margin-left:8px" }, "collected ✓") : null),
    el("span", { class: "muted", style: "text-align:right;font-size:12px" }, sourceLine(row))
  );
}

export default {
  id: "inventory",
  title: "Needed Items",
  icon: "inventory",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const rows = neededItems(profile, scopeOpts());
      const prog = collectionProgress(profile, scopeOpts());

      const input = el("input", {
        type: "text", value: searchTerm, placeholder: "Filter items…",
        oninput: (e) => { searchTerm = e.target.value; drawList(); },
      });

      const checkbox = (label, checked, onchange, title) =>
        el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-muted);font-size:12px", title },
          el("input", { type: "checkbox", checked: checked ? "" : null, onchange }), label);

      container.appendChild(el("div", { class: "panel", style: "margin-bottom:16px" },
        el("div", { class: "stat-row" },
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, `${prog.collected}/${prog.needed}`),
            el("span", { class: "stat__label" }, "Items collected")),
          el("div", { class: "stat" },
            el("span", { class: "stat__value" }, `${prog.itemsDone}/${prog.items}`),
            el("span", { class: "stat__label" }, "Item types done")),
          el("div", { style: "flex:1;min-width:160px;align-self:center" },
            el("div", { class: "progress" },
              el("div", { class: "progress__fill", style: `width:${prog.pct}%` }))),
          el("div", { class: "field", style: "margin:0;flex:1;min-width:160px;align-self:center" },
            el("label", {}, "Filter"), input)),
        el("div", { style: "display:flex;gap:18px;flex-wrap:wrap;margin-top:10px" },
          checkbox("Hide collected", hideCollected, (e) => { hideCollected = e.target.checked; draw(); }),
          checkbox("Also hoard for upcoming quests (next 10 levels)", includeUpcoming,
            (e) => { includeUpcoming = e.target.checked; draw(); }),
          checkbox("Include every remaining hideout level", allHideoutLevels,
            (e) => { allHideoutLevels = e.target.checked; draw(); }))));

      const list = el("ul", { class: "datalist" });
      const drawList = () => {
        const q = searchTerm.trim().toLowerCase();
        let shown = rows
          .filter((r) => !q || r.item.name.toLowerCase().includes(q) || r.item.category.toLowerCase().includes(q))
          .filter((r) => !hideCollected || r.have < r.needed);
        const total = shown.length;
        shown = shown.slice(0, MAX_ROWS);
        list.replaceChildren(...shown.map((r) => itemRow(r, draw)));
        if (!total) {
          list.appendChild(el("li", {}, el("span", { class: "muted" },
            rows.length ? "No items match these filters." : "Nothing needed in the current scope — widen it with the toggles above, or take a break, you've earned it.")));
        } else if (total > MAX_ROWS) {
          list.appendChild(el("li", {}, el("span", { class: "muted" },
            `Showing top ${MAX_ROWS} of ${total} — type in the filter to narrow down.`)));
        }
      };
      drawList();

      container.appendChild(el("div", { class: "panel" },
        el("div", { class: "panel__title" }, "Consolidated needs"),
        el("p", { style: "color:var(--text-muted);font-size:12px;margin-bottom:10px" },
          "Counts are manual — tap + as you stash items. FIR marks items at least one quest needs found in raid. Scope matches the Loot Advisor and Hideout Planner defaults."),
        list));
    };
    draw();
  },
};
