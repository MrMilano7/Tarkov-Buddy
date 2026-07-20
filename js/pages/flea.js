/**
 * flea.js — Flea Market watch (v0.8.10).
 *
 * Two ranked lists from the user's own imported items.json:
 *   FLEA — best items to sell on the flea market (24h average prices)
 *   TRADER — best items to sell to traders (for pre-level-15 players,
 *            or flea-banned loot)
 * Defaults to TRADER when profile level < 15, since the flea is locked.
 *
 * Honesty notes:
 *  - Prices are frozen at import time; the footer shows the import date.
 *  - Ranked by ₽/slot by default — the number that actually decides what
 *    goes in the bag — with a toggle for raw price.
 *  - The FLEA list needs a real flea price. Newer imports carry `fleaAvg`
 *    (0 = genuinely no flea data). Older imports only have `avgPrice`,
 *    which silently falls back to trader sell for unlisted items — with
 *    old data we still filter fleaBanned but flag the ambiguity instead
 *    of hiding it.
 *  - `change48h` (48h price trend) renders only when present in the data.
 */
import { el, roubles } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";
import { getProfile } from "../core/store.js";

let tab = null;            // "flea" | "trader" (null = pick from profile level)
let sortPerSlot = true;
let textFilter = "";
let shown = 10;
let excludedCats = new Set();
let showCatFilter = false;

const BUCKETS = [
  ["Keys", /key|keycard/i],
  ["Weapons", /rifle|carbine|shotgun|handgun|pistol|smg|submachine|machine gun|launcher|marksman|revolver|knife|melee|grenade/i],
  ["Weapon mods", /mod|scope|sight|magazine|barrel|stock|grip|muzzle|handguard|mount|receiver|charging|gas block|suppressor|flash|bipod|laser|tactical|auxiliary/i],
  ["Ammo", /ammo/i],
  ["Gear", /armor|rig|backpack|helmet|headphone|headwear|face|eyewear|armband|container|case/i],
  ["Meds", /medic|medikit|drug|stimulant|injector/i],
  ["Food & drink", /food|drink/i],
  ["Barter goods", /barter|electronic|building|household|flammable|jewelry|valuable|tool|energy|fuel|battery|info/i],
];
function bucket(category) {
  for (const [name, re] of BUCKETS) if (re.test(category || "")) return name;
  return "Other";
}

function fleaPrice(i, hasFleaField) {
  if (hasFleaField) return i.fleaAvg || 0;
  return i.fleaBanned ? 0 : (i.avgPrice || 0);
}

function trendBadge(pct) {
  if (pct == null) return null;
  const up = pct > 0;
  const color = up ? "var(--olive)" : pct < 0 ? "var(--alert)" : "var(--text-muted)";
  return el("span", { style: `font-size:11px;color:${color};margin-left:6px`, title: "flea price change, last 48h before import" },
    `${up ? "▲" : pct < 0 ? "▼" : "•"} ${Math.abs(pct).toFixed(1)}%`);
}

function row(i, rank, price, perSlot, trend) {
  return el("li", {},
    el("span", {},
      el("span", { class: "badge badge--brass", style: "min-width:26px;text-align:center;margin-right:8px" }, String(rank)),
      el("span", { style: "color:var(--text-bright)" }, i.name),
      trend,
      el("div", { class: "muted", style: "font-size:11px;color:var(--text-muted);margin-left:34px" },
        `${i.category} · ${i.slots} slot${i.slots > 1 ? "s" : ""}`)),
    el("span", { style: "text-align:right;white-space:nowrap" },
      el("div", { style: "color:var(--text-bright)" }, roubles(perSlot)),
      el("div", { class: "muted", style: "font-size:11px;color:var(--text-muted)" },
        `${roubles(price)} total`)));
}

export default {
  id: "flea",
  title: "Flea Market",
  icon: "loot",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const items = get("items")?.items ?? [];
      const hasFleaField = items.some((i) => "fleaAvg" in i);
      const hasTrend = items.some((i) => i.change48h != null);
      if (tab === null) tab = (profile.level ?? 1) >= 15 ? "flea" : "trader";

      const rowsAll = items
        .map((i) => {
          const price = tab === "flea" ? fleaPrice(i, hasFleaField) : (i.traderSell || 0);
          return { i, price, perSlot: price / (i.slots || 1), bucket: bucket(i.category) };
        })
        .filter((r) => r.price > 0);
      let rows = rowsAll.filter((r) => !excludedCats.has(r.bucket));
      if (textFilter) {
        const q = textFilter.toLowerCase();
        rows = rows.filter((r) => r.i.name.toLowerCase().includes(q) || r.i.category.toLowerCase().includes(q));
      }
      rows.sort((a, b) => sortPerSlot ? b.perSlot - a.perSlot : b.price - a.price);

      const tabBtn = (id, label) => el("button", {
        class: `btn ${tab === id ? "" : "btn--ghost"}`,
        onclick: () => { tab = id; shown = 10; draw(); },
      }, label);

      container.appendChild(el("div", { class: "panel" },
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" },
          tabBtn("flea", "Flea"),
          tabBtn("trader", "Trader sell"),
          el("input", {
            type: "search", placeholder: "Filter items…", value: textFilter,
            style: "flex:1;min-width:140px",
            oninput: (e) => { textFilter = e.target.value; shown = 10; draw(); },
          }),
          el("button", {
            class: "btn btn--ghost", title: "Toggle ranking metric",
            onclick: () => { sortPerSlot = !sortPerSlot; draw(); },
          }, sortPerSlot ? "↓ ₽/slot" : "↓ total ₽")),
        (profile.level ?? 1) < 15 && tab === "flea"
          ? el("p", { style: "font-size:12px;color:var(--brass);margin:10px 0 0" },
              "Flea market unlocks at level 15 — showing anyway, but the Trader tab is what you can actually use right now.")
          : null,
        tab === "flea" && !hasFleaField
          ? el("p", { style: "font-size:12px;color:var(--brass);margin:10px 0 0" },
              "Your item data predates the dedicated flea-price field, so a few unlisted items may show " +
              "trader prices here. Re-run tools/update_data.py for exact flea data and 48h trends.")
          : null));

      // Category filter: tarkov.dev has dozens of raw categories, far too many
      // for chips on a phone. They're grouped into a handful of buckets here;
      // the raw category still shows on each row, and anything unmatched
      // lands in "Other" rather than being silently dropped. Chips WRAP
      // (never a scrolling row — scroll/tap gesture conflicts ate taps on a
      // real phone before, v0.8.3 lesson).
      const allCats = [...new Set(rowsAll.map((r) => r.bucket))].sort();
      const catChip = (c) => {
        const off = excludedCats.has(c);
        return el("button", {
          class: "btn btn--ghost",
          style: `font-size:11px;padding:3px 8px;${off ? "opacity:.45;text-decoration:line-through" : ""}`,
          title: off ? `Show ${c} again` : `Hide ${c} from the list`,
          onclick: () => { off ? excludedCats.delete(c) : excludedCats.add(c); shown = 10; draw(); },
        }, c);
      };
      container.appendChild(el("div", { class: "panel" },
        el("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px" },
          el("span", { class: "panel__title", style: "margin:0" },
            `Categories${excludedCats.size ? ` (${excludedCats.size} hidden)` : ""}`),
          el("span", {},
            excludedCats.size ? el("button", { class: "btn btn--ghost", style: "font-size:11px;margin-right:6px",
              onclick: () => { excludedCats = new Set(); shown = 10; draw(); } }, "Reset") : null,
            el("button", { class: "btn btn--ghost", style: "font-size:11px",
              onclick: () => { showCatFilter = !showCatFilter; draw(); } },
              showCatFilter ? "Hide" : "Filter…"))),
        showCatFilter ? el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;margin-top:10px" },
          ...allCats.map(catChip)) : null));

      const list = el("ul", { class: "datalist" });
      rows.slice(0, shown).forEach((r, idx) =>
        list.appendChild(row(r.i, idx + 1, r.price, Math.round(r.perSlot),
          tab === "flea" && hasTrend ? trendBadge(r.i.change48h) : null)));
      if (!rows.length) {
        list.appendChild(el("li", {}, el("span", { class: "muted" },
          items.length ? "Nothing matches." : "No item data — run tools/update_data.py, then reload.")));
      }
      container.appendChild(el("div", { class: "panel" },
        el("div", { class: "panel__title" },
          tab === "flea" ? "Top flea sales (24h avg at import)" : "Top trader sales"),
        list,
        rows.length > shown ? el("button", {
          class: "btn btn--ghost", style: "margin-top:10px",
          onclick: () => { shown += 20; draw(); },
        }, `Show more (${rows.length - shown} left)`) : null));

      const note = get("items")?.note;
      container.appendChild(el("p", { class: "muted", style: "font-size:11px;color:var(--text-muted)" },
        `Prices are from your last import${note ? ` (${note.toLowerCase()})` : ""} — not live. ` +
        `Flea list excludes flea-banned items. Flea fees not modeled.`));
    };
    draw();
  },
};
