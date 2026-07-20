/**
 * storyline.js — Storyline & Achievements tracker (v0.8.19).
 *
 * Background: the 1.0 story chapters (Tour, Falling Skies, ...) are NOT
 * published as tasks by tarkov.dev — confirmed against the live API
 * (server task count matches local, zero chapter hits). What IS published
 * is the achievements list, which mirrors story milestones with their
 * real in-game names and descriptions ("Lost: Locate the crashed plane
 * on Woods...", "Part of the Ship, Part of the Crew...").
 *
 * So this page is an honest tracker over real achievement data: the
 * player ticks what they've earned (profile.achievementsEarned). It does
 * NOT infer map unlocks or quest availability from achievements — the
 * API states no such links, and inventing them is exactly the kind of
 * fabricated logic this app refuses. Map story-gates remain the manual
 * "locked in game" checkbox on each map card.
 *
 * completedPct is the real % of all players holding the achievement at
 * import time — shown as-is, labeled with the import date via the
 * dataset note when present.
 */
import { el, toast } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";
import { getProfile, update } from "../core/store.js";

let view = "all";       // all | earned | unearned
let textFilter = "";

const RARITY_COLOR = {
  Legendary: "var(--brass)",
  Rare: "var(--green)",
  Common: "var(--text-muted)",
};

export default {
  id: "achievements",
  title: "Achievements",
  icon: "quests",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const earned = new Set(profile.achievementsEarned ?? []);
      const all = get("achievements")?.achievements ?? [];

      if (!all.length) {
        container.appendChild(el("div", { class: "panel" },
          el("p", { style: "color:var(--text-muted)" },
            "No achievement data yet. Re-run tools/update_data.py — the " +
            "importer now pulls the achievements list, which is where the " +
            "game's story milestones live."),
        ));
        return;
      }

      let rows = all;
      if (view === "earned") rows = rows.filter((a) => earned.has(a.id));
      if (view === "unearned") rows = rows.filter((a) => !earned.has(a.id));
      if (textFilter) {
        const q = textFilter.toLowerCase();
        rows = rows.filter((a) =>
          a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q));
      }
      // Rarest last so the list reads roughly in "progression" order:
      // common early-game milestones first, legendary endgame at the bottom.
      const order = { Common: 0, Rare: 1, Legendary: 2 };
      rows = [...rows].sort((a, b) =>
        (order[a.rarity] ?? 0) - (order[b.rarity] ?? 0) ||
        (b.completedPct ?? 0) - (a.completedPct ?? 0));

      const viewBtn = (id, label) => el("button", {
        class: `btn ${view === id ? "" : "btn--ghost"}`,
        onclick: () => { view = id; draw(); },
      }, label);

      container.appendChild(el("div", { class: "panel" },
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" },
          viewBtn("all", `All (${all.length})`),
          viewBtn("earned", `Earned (${earned.size})`),
          viewBtn("unearned", "Remaining"),
          el("input", {
            type: "search", placeholder: "Filter — try \u201cplane\u201d or \u201cicebreaker\u201d\u2026",
            value: textFilter, style: "flex:1;min-width:150px",
            oninput: (e) => { textFilter = e.target.value; draw(); },
          })),
        el("p", { style: "font-size:12px;color:var(--text-muted);margin:10px 0 0" },
          "Tick off achievements as you earn them. A few reference story " +
          "content, but the actual story chapters aren't published in any " +
          "API. % = share of all players who have it (at import).")));

      const list = el("ul", { class: "datalist" });
      for (const a of rows.slice(0, 150)) {
        const have = earned.has(a.id);
        const checkbox = el("input", {
          type: "checkbox", checked: have ? "" : null, style: "margin-top:3px",
          onchange: async (e) => {
            const on = e.target.checked;
            await update((p) => {
              const set = new Set(p.achievementsEarned ?? []);
              on ? set.add(a.id) : set.delete(a.id);
              p.achievementsEarned = [...set];
            });
            toast(`${a.name} ${on ? "earned \u2713" : "unmarked"}.`);
            draw();
          },
        });
        list.appendChild(el("li", {},
          el("span", {},
            el("label", { style: "display:flex;align-items:flex-start;gap:10px;cursor:pointer" },
              checkbox,
              el("span", {},
                el("span", { style: `color:${have ? "var(--green)" : "var(--text-bright)"}` }, a.name),
                el("span", { style: `font-size:10px;margin-left:8px;color:${RARITY_COLOR[a.rarity] ?? "var(--text-muted)"}` },
                  a.rarity.toUpperCase()),
                el("div", { style: "font-size:11px;color:var(--text-muted)" },
                  a.hidden && !have ? "(hidden achievement)" : a.description)))),
          el("span", { class: "muted", style: "text-align:right;font-size:11px;white-space:nowrap" },
            a.completedPct != null ? `${a.completedPct.toFixed(1)}%` : "")));
      }
      if (!rows.length) {
        list.appendChild(el("li", {}, el("span", { class: "muted" }, "Nothing matches.")));
      }
      container.appendChild(el("div", { class: "panel" }, list));
      if (rows.length > 150) {
        container.appendChild(el("p", { class: "muted", style: "font-size:12px" },
          `Showing 150 of ${rows.length} — narrow with the filter.`));
      }
    };
    draw();
  },
};
