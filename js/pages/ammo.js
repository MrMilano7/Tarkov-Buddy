/**
 * ammo.js — the Ammo Guide (v0.4).
 *
 * Rounds grouped by caliber, sorted by penetration. The six chips on each
 * row grade effectiveness against armor classes 1-6 using the community
 * rule of thumb (pen ≈ class × 10 to reliably defeat it):
 *   green  — pen ≥ class×10 + 5   (defeats it consistently)
 *   amber  — within ±5             (contested)
 *   red    — pen < class×10 − 5    (don't bother)
 * This is a heuristic, not a ballistics sim — good enough to pick a
 * loadout at a glance, which is the point.
 */
import { el } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";

let textFilter = "";
let caliberFilter = "ALL";
let sortKey = "pen"; // pen | damage

function armorChip(cls, pen) {
  const delta = pen - cls * 10;
  const color = delta >= 5 ? "var(--olive)" : delta >= -5 ? "var(--brass)" : "var(--alert)";
  const label = delta >= 5 ? "defeats" : delta >= -5 ? "contested" : "ineffective";
  return el("span", {
    title: `Class ${cls}: ${label}`,
    style: `display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;` +
      `font-size:10px;font-weight:bold;border:1px solid ${color};color:${color};margin-right:3px;border-radius:2px`,
  }, String(cls));
}

function roundRow(r) {
  const pellets = r.projectiles > 1 ? ` ×${r.projectiles}` : "";
  const tracer = r.tracer ? el("span", { class: "badge", style: "margin-left:6px" }, "TRACER") : null;
  return el("li", { title: r.fullName },
    el("span", {},
      el("span", { style: "color:var(--text-bright)" }, r.name), tracer,
      el("div", { class: "muted", style: "font-size:11px;color:var(--text-muted)" },
        `DMG ${r.damage}${pellets} · PEN ${r.pen} · frag ${r.frag}% · ${r.velocity} m/s`)),
    el("span", { style: "text-align:right;white-space:nowrap" },
      ...[1, 2, 3, 4, 5, 6].map((c) => armorChip(c, r.pen))));
}

export default {
  id: "ammo",
  title: "Ammo Guide",
  icon: "ammo",
  section: "Raids",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const rounds = get("ammo")?.rounds ?? [];

      if (!rounds.length) {
        container.appendChild(el("div", { class: "panel" },
          el("div", { class: "panel__title" }, "Ammo data not imported yet"),
          el("p", { style: "color:var(--text-muted)" },
            "Run the importer once (with internet), then refresh: python tools/update_data.py")));
        return;
      }

      const calibers = ["ALL", ...new Set(rounds.map((r) => r.caliber))];
      const controls = el("div", { class: "panel", style: "margin-bottom:16px" },
        el("div", { style: "display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end" },
          el("div", { class: "field", style: "margin:0;flex:2;min-width:160px" },
            el("label", {}, "Filter"),
            el("input", { type: "text", value: textFilter, placeholder: "Round name…",
              oninput: (e) => { textFilter = e.target.value; drawList(); } })),
          el("div", { class: "field", style: "margin:0;flex:1;min-width:140px" },
            el("label", {}, "Caliber"),
            el("select", { onchange: (e) => { caliberFilter = e.target.value; drawList(); } },
              ...calibers.map((c) => el("option", { value: c, selected: c === caliberFilter ? "" : null },
                c === "ALL" ? "All calibers" : c)))),
          el("div", { class: "field", style: "margin:0;min-width:120px" },
            el("label", {}, "Sort by"),
            el("select", { onchange: (e) => { sortKey = e.target.value; drawList(); } },
              el("option", { value: "pen", selected: sortKey === "pen" ? "" : null }, "Penetration"),
              el("option", { value: "damage", selected: sortKey === "damage" ? "" : null }, "Damage")))),
        el("p", { class: "muted", style: "font-size:11px;color:var(--text-muted);margin:10px 0 0" },
          "Chips grade each round against armor classes 1-6: green defeats it, amber is contested, red is ineffective. Rule-of-thumb, not a ballistics simulator."));
      container.appendChild(controls);

      const listHost = el("div");
      container.appendChild(listHost);

      const drawList = () => {
        listHost.innerHTML = "";
        const q = textFilter.trim().toLowerCase();
        let shown = rounds.filter((r) =>
          (caliberFilter === "ALL" || r.caliber === caliberFilter) &&
          (!q || r.name.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)));
        shown = [...shown].sort((a, b) => b[sortKey] - a[sortKey]);

        if (!shown.length) {
          listHost.appendChild(el("div", { class: "panel" },
            el("p", { style: "color:var(--text-muted)" }, "No rounds match.")));
          return;
        }

        // group by caliber, preserving sort inside each group
        const groups = new Map();
        for (const r of shown) {
          if (!groups.has(r.caliber)) groups.set(r.caliber, []);
          groups.get(r.caliber).push(r);
        }
        for (const [caliber, list] of groups) {
          listHost.appendChild(el("section", { class: "panel", style: "margin-bottom:12px" },
            el("div", { class: "panel__title" }, caliber),
            el("ul", { class: "datalist" }, ...list.map(roundRow))));
        }
      };
      drawList();
    };
    draw();
  },
};
