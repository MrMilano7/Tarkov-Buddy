/**
 * raidlog.js — Raid Logger page (v0.8.1, spec Layer 4).
 *
 * A quick post-raid form (map, survived, kills, loot value, notes) that
 * writes to profile.raidLog. Everything shown here — survival rate, K/D,
 * per-map breakdown — is computed live by raidEngine from that log; the
 * same log also feeds personal risk/familiarity weighting into the
 * Advisor and Raid Planner (see raidEngine.personalRiskAdjustment /
 * favoriteBonus).
 */
import { el, toast } from "../ui/dom.js";
import { getProfile, update as updateProfile } from "../core/store.js";
import { get } from "../core/dataLoader.js";
import * as raidEngine from "../core/raidEngine.js";

function panel(title, ...children) {
  return el("section", { class: "panel" },
    el("div", { class: "panel__title" }, title), ...children);
}

function fmtWhen(ts) {
  const d = new Date(ts);
  const days = (Date.now() - ts) / 86400000;
  if (days < 1) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString();
}

function statCell(value, label) {
  return el("div", { class: "stat" },
    el("span", { class: "stat__value" }, value),
    el("span", { class: "stat__label" }, label));
}

function logForm(container, redraw) {
  const maps = get("maps")?.maps ?? [];
  const mapSelect = el("select", {},
    ...(maps.length
      ? maps.map((m) => el("option", { value: m.id }, m.name))
      : [el("option", { value: "" }, "No map data loaded")]));
  const survivedSelect = el("select", {},
    el("option", { value: "1" }, "Survived / Extracted"),
    el("option", { value: "0" }, "Died / MIA"));
  const killsInput = el("input", { type: "number", min: "0", value: "0", inputmode: "numeric" });
  const lootInput = el("input", { type: "number", min: "0", step: "1000", value: "0", inputmode: "numeric" });
  const notesInput = el("input", { type: "text", placeholder: "Optional note (e.g. \"died to scav on extract\")" });

  const submit = () => {
    if (!maps.length) { toast("No map data loaded — run the importer first.", { error: true }); return; }
    const entry = raidEngine.makeRaidEntry({
      mapId: mapSelect.value,
      survived: survivedSelect.value === "1",
      kills: killsInput.value,
      lootValue: lootInput.value,
      notes: notesInput.value,
    });
    updateProfile((p) => {
      p.raidLog = [...(p.raidLog ?? []), entry];
    });
    toast(`Logged: ${entry.survived ? "Survived" : "Died"} on ${maps.find((m) => m.id === entry.mapId)?.name ?? entry.mapId}.`);
    container.innerHTML = "";
    redraw();
  };

  return panel("Log a raid",
    el("div", { class: "field" }, el("label", {}, "Map"), mapSelect),
    el("div", { class: "field" }, el("label", {}, "Outcome"), survivedSelect),
    el("div", { class: "field" }, el("label", {}, "Kills"), killsInput),
    el("div", { class: "field" }, el("label", {}, "Loot value (₽)"), lootInput),
    el("div", { class: "field" }, el("label", {}, "Notes"), notesInput),
    el("button", { class: "btn", onclick: submit }, "Log raid"));
}

function headlinePanel(profile) {
  const s = raidEngine.stats(profile);
  if (!s.total) {
    return panel("Headline",
      el("p", { style: "color:var(--text-muted);font-size:13px" },
        "No raids logged yet — log your first one to start building your personal risk model."));
  }
  return panel("Headline",
    el("div", { class: "stat-row" },
      statCell(String(s.total), "Raids logged"),
      statCell(`${Math.round(s.survivalRate * 100)}%`, "Survival rate"),
      statCell(s.kd.toFixed(2), "K/D"),
      statCell(`₽ ${Math.round(s.avgLoot).toLocaleString("en-US")}`, "Avg loot / raid")));
}

function byMapPanel(profile) {
  const rows = raidEngine.byMap(profile);
  if (!rows.length) {
    return panel("Per-map breakdown",
      el("p", { style: "color:var(--text-muted);font-size:13px" }, "Nothing logged yet."));
  }
  const list = el("ul", { class: "datalist" });
  for (const r of rows) {
    list.appendChild(el("li", {},
      el("span", { style: "color:var(--text-bright)" }, r.name),
      el("span", { class: "muted" },
        `${r.raids} raid${r.raids === 1 ? "" : "s"} · ${Math.round(r.survivalRate * 100)}% survival · ${r.kills} kills · avg ₽${Math.round(r.avgLoot).toLocaleString("en-US")}`)));
  }
  return panel("Per-map breakdown", list,
    el("p", { style: "color:var(--text-muted);font-size:11px;margin-top:10px" },
      "Maps with 3+ logged raids feed a personal risk/familiarity adjustment into the Advisor and Raid Planner."));
}

function historyPanel(profile, container, redraw) {
  const entries = raidEngine.recent(profile, 20);
  if (!entries.length) {
    return panel("Raid history",
      el("p", { style: "color:var(--text-muted);font-size:13px" }, "No raids logged yet."));
  }
  const list = el("ul", { class: "datalist" });
  for (const r of entries) {
    list.appendChild(el("li", {},
      el("span", {},
        el("span", { class: `badge ${r.survived ? "badge--ok" : ""}`, style: "margin-right:8px" },
          r.survived ? "ALIVE" : "DEAD"),
        el("span", { style: "color:var(--text-bright)" }, r.name),
        r.notes ? el("span", { class: "muted", style: "margin-left:8px" }, r.notes) : null),
      el("span", { class: "muted" },
        `${r.kills} kills · ₽${r.lootValue.toLocaleString("en-US")} · ${fmtWhen(r.ts)}`,
        el("button", { class: "btn btn--danger", style: "margin-left:10px;padding:2px 8px;font-size:10px", onclick: () => {
          updateProfile((p) => { p.raidLog = (p.raidLog ?? []).filter((x) => x.id !== r.id); });
          container.innerHTML = "";
          redraw();
        } }, "Delete"))));
  }
  return panel(`Raid history (last ${entries.length})`, list);
}

export default {
  id: "raidlog",
  title: "Raid Log",
  icon: "raidlog",
  section: "Overview",
  render(container) {
    const redraw = () => {
      const profile = getProfile();
      container.appendChild(el("div", { class: "grid" },
        el("div", { class: "span-2" }, headlinePanel(profile)),
        logForm(container, redraw),
        byMapPanel(profile),
        el("div", { class: "span-2" }, historyPanel(profile, container, redraw)),
      ));
    };
    redraw();
  },
};
