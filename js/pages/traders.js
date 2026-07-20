/**
 * traders.js — the Trader Engine page.
 * Shows each trader's loyalty ladder from data/traders.json, lets the
 * player set their current LL (persisted to the profile), and checks the
 * player-level requirement for the next tier automatically.
 */
import { el, roubles, toast } from "../ui/dom.js";
import { getProfile, update } from "../core/store.js";
import { get } from "../core/dataLoader.js";
import { allQuests } from "../core/questEngine.js";

/** Trader ids referenced by any quest's reputation requirements (v0.8.27).
 * Only these get a standing input — for everyone else loyalty levels are
 * the whole story. Empty until the importer has run with the new field. */
function repGatedTraderIds() {
  const ids = new Set();
  for (const q of allQuests()) {
    for (const r of q.traderRequirements ?? []) {
      if (r.type === "reputation") ids.add(r.trader);
    }
  }
  return ids;
}

function requirementRow(req, playerLevel) {
  const levelOk = playerLevel >= req.playerLevel;
  const spend = req.spend >= 100000
    ? roubles(req.spend)
    : `$${req.spend.toLocaleString()}`;
  return el("li", {},
    el("span", {},
      el("span", { class: `badge ${levelOk ? "badge--ok" : ""}`, style: "margin-right:8px" }, `LL${req.level}`),
      `Level ${req.playerLevel} · Rep ${req.reputation.toFixed(2)} · Spend ${spend}`),
    el("span", { class: "muted" }, levelOk ? "level met" : `need lvl ${req.playerLevel}`)
  );
}

function traderCard(trader, profile, rerender, repGated) {
  const current = profile.traderLevels[trader.id] ?? 1;

  // Standing input (only for traders with rep-gated quests, e.g. Fence).
  // Rep isn't exposed by any API — check yours on the Character screen
  // in game and mirror it here; quest gating reads this value (default 0).
  const repRow = !repGated ? null : (() => {
    const rep = Number(profile.traderRep?.[trader.id] ?? 0);
    const input = el("input", {
      type: "number", step: "0.01", value: String(rep),
      inputmode: "decimal",
      style: "width:90px;background:var(--bg);color:var(--text-bright);" +
        "border:1px solid var(--border);border-radius:4px;padding:5px 8px;font-size:13px",
    });
    return el("div", { style: "display:flex;align-items:center;gap:8px;margin:2px 0 8px" },
      el("span", { style: "font-size:12px;color:var(--text-muted)" }, "Standing"),
      input,
      el("button", { class: "btn", style: "font-size:11px;padding:4px 10px",
        onclick: async () => {
          const v = parseFloat(input.value);
          if (Number.isNaN(v)) { toast("Enter a number, e.g. -1.2", { error: true }); return; }
          await update((p) => { p.traderRep = { ...(p.traderRep ?? {}), [trader.id]: v }; });
          toast(`${trader.name} standing set to ${v}.`);
          rerender();
        } }, "Save"),
      el("span", { style: "font-size:11px;color:var(--text-muted)" },
        "some quests gate on this (copy it from the in-game Character screen)"));
  })();

  const levelButtons = el("div", { style: "display:flex;gap:6px;margin:10px 0" },
    ...Array.from({ length: trader.loyaltyLevels }, (_, i) => i + 1).map((lvl) =>
      el("button", {
        class: lvl === current ? "btn" : "btn btn--ghost",
        style: "padding:5px 12px",
        onclick: async () => {
          await update((p) => { p.traderLevels[trader.id] = lvl; });
          toast(`${trader.name} set to LL${lvl}.`);
          rerender();
        },
      }, `LL${lvl}`))
  );

  const children = [
    el("div", { style: "display:flex;align-items:center;gap:10px" },
      el("strong", { style: "color:var(--text-bright);font-size:15px" }, trader.name),
      el("span", { class: "badge" }, trader.currency),
      trader.unlockedBy ? el("span", { class: "badge badge--brass" }, "Quest unlock") : null),
    el("p", { style: "color:var(--text-muted);font-size:12px;margin:4px 0 0" }, trader.specialty),
    levelButtons,
    repRow,
  ];

  if (trader.requirements.length) {
    children.push(el("div", { class: "panel__title", style: "margin:6px 0 8px" }, "Loyalty requirements"),
      el("ul", { class: "datalist" },
        ...trader.requirements.map((r) => requirementRow(r, profile.level))));
  } else {
    children.push(el("p", { style: "color:var(--text-muted);font-size:12px" },
      "No loyalty ladder — stock depends on Scav karma."));
  }

  return el("section", { class: "panel" }, ...children);
}

export default {
  id: "traders",
  title: "Traders",
  icon: "traders",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const traders = get("traders")?.traders ?? [];
      const repGated = repGatedTraderIds();
      container.appendChild(el("p", { style: "color:var(--text-muted);margin-bottom:14px;max-width:640px" },
        "Set each trader to your current loyalty level — the Loot Advisor and future planners use this. Requirement rows show whether your PMC level already qualifies for the next tier."));
      container.appendChild(el("div", { class: "grid" },
        ...traders.map((t) => traderCard(t, profile, draw, repGated.has(t.id)))));
    };
    draw();
  },
};
