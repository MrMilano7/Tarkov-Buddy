/**
 * prestige.js — Prestige requirements tracker (v0.9.12).
 *
 * Real data only: tarkov.dev publishes the prestige levels via the
 * `prestige` query — per-level unlock conditions (as TaskObjective
 * descriptions), rewards, and transfer settings (how much stash space and
 * what fraction of skills carry over). We render exactly that.
 *
 * Tracking is manual, same model as Achievements: the game exposes no way
 * to read your live progress, so the player ticks conditions off
 * (profile.prestigeTicked) and marks a level claimed
 * (profile.prestigeAttained). The tracker never infers or auto-completes.
 *
 * Data predating v0.9.12 imports won't have the prestige dataset — the
 * page says so and points at the importer (graceful degradation, not a
 * silent blank).
 */
import { el, toast } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";
import { getProfile, update } from "../core/store.js";

function fmtRate(rate) {
  if (rate == null) return "";
  // API rate is a fraction (e.g. 0.05) — show as a percentage.
  const pct = rate <= 1 ? rate * 100 : rate;
  return `${Number(pct.toFixed(2))}%`;
}

export default {
  id: "prestige",
  title: "Prestige",
  icon: "quests",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const ticked = new Set(profile.prestigeTicked ?? []);
      const attained = profile.prestigeAttained ?? 0;
      const levels = get("prestige")?.prestige ?? [];
      const note = get("prestige")?.note ?? "";

      if (!levels.length) {
        container.appendChild(el("div", { class: "panel" },
          el("p", { style: "color:var(--text-muted)" },
            "No prestige data yet. Your data was imported before v0.9.12 " +
            "added the prestige query — re-run the importer (Settings → " +
            "Import game data, or tools/update_data.py in Termux) and " +
            "this page will fill in."),
        ));
        return;
      }

      container.appendChild(el("div", { class: "panel" },
        el("p", { style: "font-size:12px;color:var(--text-muted);margin:0" },
          "Requirements, rewards, and what carries over — straight from " +
          "tarkov.dev. Tick conditions as you meet them in game; the app " +
          "can't read live progress, so this is your manual checklist. " +
          (note ? note : ""))));

      for (const lv of levels) {
        const conds = lv.conditions ?? [];
        const doneCount = conds.filter((c) => ticked.has(c.id)).length;
        const claimed = attained >= lv.level;

        const head = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" },
          el("h2", { style: "margin:0" }, lv.name),
          el("span", { class: "muted", style: "font-size:12px" },
            conds.length ? `${doneCount}/${conds.length} conditions` : "no published conditions"),
          el("label", { style: "margin-left:auto;display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer" },
            el("input", {
              type: "checkbox", checked: claimed ? "" : null,
              onchange: async (e) => {
                const on = e.target.checked;
                await update((p) => {
                  p.prestigeAttained = on
                    ? Math.max(p.prestigeAttained ?? 0, lv.level)
                    : Math.min(p.prestigeAttained ?? 0, lv.level - 1);
                });
                toast(on ? `${lv.name} claimed \u2713` : `${lv.name} unmarked.`);
                draw();
              },
            }),
            el("span", { style: claimed ? "color:var(--green)" : "" }, "Prestiged")));

        const condList = el("ul", { class: "datalist" });
        for (const c of conds) {
          const have = ticked.has(c.id);
          condList.appendChild(el("li", {},
            el("span", {},
              el("label", { style: "display:flex;align-items:flex-start;gap:10px;cursor:pointer" },
                el("input", {
                  type: "checkbox", checked: have ? "" : null, style: "margin-top:3px",
                  onchange: async (e) => {
                    const on = e.target.checked;
                    await update((p) => {
                      const set = new Set(p.prestigeTicked ?? []);
                      on ? set.add(c.id) : set.delete(c.id);
                      p.prestigeTicked = [...set];
                    });
                    draw();
                  },
                }),
                el("span", { style: have ? "color:var(--green)" : "" }, c.description || c.type)))));
        }

        const extras = [];
        const r = lv.rewards ?? {};
        if (r.items?.length) {
          extras.push(el("div", { style: "font-size:12px;margin-top:8px" },
            el("strong", {}, "Rewards: "),
            r.items.map((it) => `${it.name}${it.count > 1 ? ` \u00d7${it.count}` : ""}`).join(", ")));
        }
        if (r.skills?.length) {
          extras.push(el("div", { style: "font-size:12px;margin-top:4px" },
            el("strong", {}, "Skill rewards: "),
            r.skills.map((s) => `${s.name} +${s.level}`).join(", ")));
        }
        if (r.customization?.length) {
          extras.push(el("div", { style: "font-size:12px;margin-top:4px" },
            el("strong", {}, "Cosmetics: "),
            r.customization.map((c) => c.name).join(", ")));
        }
        const stash = (lv.transfer ?? []).find((t) => t.kind === "stash");
        const skillXfers = (lv.transfer ?? []).filter((t) => t.kind === "skill" && t.rate != null);
        if (stash || skillXfers.length) {
          const bits = [];
          if (stash) bits.push(`stash kept: ${stash.gridWidth}\u00d7${stash.gridHeight ?? "?"}`);
          if (skillXfers.length) {
            bits.push("skills carried: " +
              skillXfers.map((t) => `${t.name} ${fmtRate(t.rate)}`).join(", "));
          }
          extras.push(el("div", { style: "font-size:12px;margin-top:4px;color:var(--text-muted)" },
            el("strong", {}, "After prestiging \u2014 "), bits.join("; ")));
        }

        container.appendChild(el("div", { class: "panel" },
          head,
          conds.length ? condList : el("p", { class: "muted", style: "font-size:12px" },
            "tarkov.dev lists no conditions for this level yet."),
          ...extras));
      }
    };
    draw();
  },
};
