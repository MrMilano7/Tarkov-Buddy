/**
 * crafts.js — Crafts & Barters (v0.8.8).
 *
 * All numbers come from the user's own imported data: crafts.json,
 * barters.json, and the flea/trader prices already in items.json.
 * Margins are labeled "est." and stamped with the import date — prices
 * are as fresh as the last `update_data.py` run, nothing more. Flea
 * market fees are NOT modeled; the note in the footer says so.
 */
import { el, roubles } from "../ui/dom.js";
import { getProfile } from "../core/store.js";
import { enrichedCrafts, enrichedBarters, fmtDuration, priceDataNote } from "../core/tradeEngine.js";

let tab = "crafts";        // crafts | barters
let textFilter = "";
let availableOnly = true;
let sortKey = "margin";    // margin | cost

function ioLine(lines, arrowColor) {
  return lines.map((l, i) =>
    el("span", { style: "white-space:nowrap" },
      i ? el("span", { style: "color:var(--text-muted)" }, " + ") : null,
      el("span", { style: "color:var(--text-bright)" }, l.name),
      l.count > 1 ? el("span", { style: `color:${arrowColor}` }, ` ×${l.count}`) : null));
}

function tradeCard(t) {
  const marginColor = t.margin > 0 ? "var(--olive)" : t.margin < 0 ? "var(--alert)" : "var(--text-muted)";
  const gate = t.kind === "craft" ? `${t.sourceLabel} L${t.level}` : `${t.sourceLabel} LL${t.level}`;
  return el("section", { class: "panel", style: t.available ? null : "opacity:.55" },
    el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap" },
      el("span", {},
        el("span", { class: `badge ${t.available ? "badge--ok" : ""}`, style: "text-transform:capitalize" }, gate),
        t.durationSeconds ? el("span", { class: "muted", style: "margin-left:8px;font-size:12px;color:var(--text-muted)" },
          fmtDuration(t.durationSeconds)) : null),
      el("strong", { style: `color:${marginColor}` },
        `${t.margin >= 0 ? "+" : "−"}${roubles(Math.abs(t.margin))} est.`)),
    el("div", { style: "font-size:13px;margin-top:8px;line-height:1.7" },
      el("div", {},
        el("span", { style: "color:var(--text-muted)" }, "IN  "),
        ...ioLine(t.requires, "var(--alert)"),
        el("span", { class: "muted", style: "margin-left:8px;font-size:11px;color:var(--text-muted)" },
          `(~${roubles(t.cost)})`)),
      el("div", {},
        el("span", { style: "color:var(--text-muted)" }, "OUT "),
        ...ioLine(t.produces, "var(--olive)"),
        el("span", { class: "muted", style: "margin-left:8px;font-size:11px;color:var(--text-muted)" },
          `(~${roubles(t.value)})`))),
    t.priceGaps ? el("div", { style: "font-size:11px;color:var(--brass);margin-top:6px" },
      `⚠ ${t.priceGaps} item(s) had no price data — margin is incomplete`) : null);
}

export default {
  id: "crafts",
  title: "Crafts & Barters",
  icon: "hideout",
  section: "Base",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const all = tab === "crafts" ? enrichedCrafts(profile) : enrichedBarters(profile);

      let shown = all;
      if (availableOnly) shown = shown.filter((t) => t.available);
      if (textFilter) {
        const q = textFilter.toLowerCase();
        shown = shown.filter((t) =>
          t.sourceLabel.includes(q) ||
          t.requires.some((l) => l.name.toLowerCase().includes(q)) ||
          t.produces.some((l) => l.name.toLowerCase().includes(q)));
      }
      shown = [...shown].sort((a, b) =>
        sortKey === "margin" ? b.margin - a.margin : a.cost - b.cost);

      const tabBtn = (id, label) => el("button", {
        class: `btn ${tab === id ? "" : "btn--ghost"}`,
        onclick: () => { tab = id; draw(); },
      }, label);

      container.appendChild(el("div", { class: "panel" },
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" },
          tabBtn("crafts", "Crafts"),
          tabBtn("barters", "Barters"),
          el("input", {
            type: "search", placeholder: "Filter by item or station…", value: textFilter,
            style: "flex:1;min-width:150px",
            oninput: (e) => { textFilter = e.target.value; draw(); },
          }),
          el("button", {
            class: `btn ${sortKey === "margin" ? "" : "btn--ghost"}`,
            title: "Sort by estimated margin",
            onclick: () => { sortKey = sortKey === "margin" ? "cost" : "margin"; draw(); },
          }, sortKey === "margin" ? "↓ margin" : "↓ cost")),
        el("label", { style: "display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--text-muted);font-size:12px;margin-top:10px" },
          el("input", { type: "checkbox", checked: availableOnly ? "" : null,
            onchange: (e) => { availableOnly = e.target.checked; draw(); } }),
          tab === "crafts"
            ? "Only stations I've built (set levels on the Hideout page)"
            : "Only trader levels I've unlocked (set on the Traders page)")));

      if (!all.length) {
        container.appendChild(el("div", { class: "panel" },
          el("p", { class: "muted" },
            "No craft/barter data found. Run tools/update_data.py to import it, then reload.")));
        return;
      }

      const LIMIT = 60;
      container.appendChild(el("div", {},
        ...shown.slice(0, LIMIT).map(tradeCard)));
      if (shown.length > LIMIT) {
        container.appendChild(el("p", { class: "muted", style: "font-size:12px" },
          `Showing top ${LIMIT} of ${shown.length} — narrow with the filter.`));
      }
      if (!shown.length) {
        container.appendChild(el("div", { class: "panel" },
          el("p", { class: "muted" }, "Nothing matches the current filters.")));
      }

      const note = priceDataNote();
      container.appendChild(el("p", { class: "muted", style: "font-size:11px;color:var(--text-muted)" },
        `Margins use flea 24h averages / best trader sell from your last import` +
        `${note ? ` (${note.toLowerCase()})` : ""}. Flea fees not modeled.`));
    };
    draw();
  },
};
