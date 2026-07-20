/**
 * search.js — global search (Ctrl+K).
 *
 * Builds a flat index from loaded datasets after "data:ready".
 * Each dataset contributes entries via an adapter, so new datasets in
 * later milestones only need one adapter line here to become searchable.
 */
import { get } from "./dataLoader.js";
import { on } from "./events.js";
import { navigate } from "./router.js";

let index = []; // { label, detail, type, pageId }
let overlay, input, resultsEl;
let matches = [];
let selected = -1;

/* ---------- index building ---------- */

const adapters = [
  {
    dataset: "traders",
    map: (data) =>
      data.traders.map((t) => ({
        label: t.name,
        detail: `Trader · ${t.currency}`,
        type: "trader",
        pageId: "traders",
      })),
  },
  {
    dataset: "maps",
    map: (data) =>
      data.maps.map((m) => ({
        label: m.name,
        detail: `Map · ${m.players} players · ${m.duration} min`,
        type: "map",
        pageId: "maps",
      })),
  },
  {
    dataset: "quests",
    map: (data) =>
      data.quests.map((q) => ({
        label: q.name,
        detail: `Quest · ${q.trader}`,
        type: "quest",
        pageId: "quests",
      })),
  },
  {
    dataset: "hideout",
    map: (data) =>
      data.stations.map((s) => ({
        label: s.name,
        detail: `Hideout · ${s.maxLevel} level${s.maxLevel === 1 ? "" : "s"}`,
        type: "hideout",
        pageId: "hideout",
      })),
  },
  {
    dataset: "ammo",
    map: (data) =>
      data.rounds.map((r) => ({
        label: r.fullName,
        detail: `Ammo · ${r.caliber} · PEN ${r.pen}`,
        type: "ammo",
        pageId: "ammo",
      })),
  },
  {
    dataset: "items",
    map: (data) =>
      data.items.map((i) => ({
        label: i.name,
        detail: `Item · ${i.category}`,
        type: "item",
        pageId: "loot",
      })),
  },
];

function buildIndex() {
  index = [];
  for (const adapter of adapters) {
    const data = get(adapter.dataset);
    if (!data) continue;
    try {
      index.push(...adapter.map(data));
    } catch (err) {
      console.error(`[search] adapter "${adapter.dataset}" failed:`, err);
    }
  }
}

/* ---------- querying ---------- */

function query(text) {
  const q = text.trim().toLowerCase();
  if (q.length < 2) return [];
  const starts = [];
  const contains = [];
  for (const entry of index) {
    const label = entry.label.toLowerCase();
    if (label.startsWith(q)) starts.push(entry);
    else if (label.includes(q)) contains.push(entry);
    if (starts.length >= 12) break;
  }
  return [...starts, ...contains].slice(0, 12);
}

/* ---------- UI ---------- */

function renderResults() {
  resultsEl.innerHTML = "";
  matches.forEach((entry, i) => {
    const li = document.createElement("li");
    li.setAttribute("role", "option");
    if (i === selected) li.setAttribute("aria-selected", "true");
    li.innerHTML = `<span>${entry.label}</span><span class="muted">${entry.detail}</span>`;
    li.addEventListener("click", () => choose(entry));
    resultsEl.appendChild(li);
  });
}

function choose(entry) {
  close();
  navigate(entry.pageId);
}

function openSearch() {
  overlay.hidden = false;
  input.value = "";
  matches = [];
  selected = -1;
  renderResults();
  input.focus();
}

function close() {
  overlay.hidden = true;
}

function onKeydown(e) {
  if (e.key === "Escape") return close();
  if (e.key === "ArrowDown") {
    e.preventDefault();
    selected = Math.min(selected + 1, matches.length - 1);
    renderResults();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    selected = Math.max(selected - 1, 0);
    renderResults();
  } else if (e.key === "Enter" && matches[selected]) {
    choose(matches[selected]);
  }
}

export function init() {
  overlay = document.getElementById("search-overlay");
  input = document.getElementById("search-input");
  resultsEl = document.getElementById("search-results");

  // Build now (datasets are already loaded at init time) and rebuild on
  // any future data reload.
  buildIndex();
  on("data:ready", buildIndex);

  document.getElementById("search-open").addEventListener("click", openSearch);
  overlay.querySelector("[data-search-close]").addEventListener("click", close);

  input.addEventListener("input", () => {
    matches = query(input.value);
    selected = matches.length ? 0 : -1;
    renderResults();
  });
  input.addEventListener("keydown", onKeydown);

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      overlay.hidden ? openSearch() : close();
    }
  });
}
