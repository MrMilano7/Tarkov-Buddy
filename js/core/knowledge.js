/**
 * knowledge.js — the item knowledge graph, no DOM (v0.7, spec Layer 2).
 *
 * For any item id, itemUsage() answers "what is this FOR?" by walking every
 * relationship in the data pack: quest handovers (with Kappa flags), hideout
 * upgrades, craft inputs, and barter inputs. Nothing is hardcoded — new
 * wipes flow in through the importer.
 */
import { get } from "./dataLoader.js";
import { allQuests } from "./questEngine.js";
import { allStations } from "./hideoutEngine.js";

let cache = null;
let cacheKey = 0;

/** Build (and memoize) the full itemId -> usage index. */
function index() {
  const datasets = get("quests") && get("hideout");
  const key = (get("quests")?.quests?.length ?? 0) + (get("crafts")?.crafts?.length ?? 0);
  if (cache && cacheKey === key && datasets) return cache;

  const map = new Map();
  const entry = (id) => {
    if (!map.has(id)) map.set(id, { quests: [], hideout: [], crafts: [], barters: [] });
    return map.get(id);
  };

  for (const q of allQuests()) {
    for (const r of q.requiredItems ?? []) {
      entry(r.item).quests.push({
        questId: q.id, name: q.name, count: r.count,
        fir: !!r.foundInRaid, kappa: !!q.kappa, trader: q.trader, minLevel: q.minLevel,
      });
    }
  }
  for (const s of allStations()) {
    for (const lv of s.levels ?? []) {
      for (const r of lv.items ?? []) {
        entry(r.item).hideout.push({ station: s.id, stationName: s.name, level: lv.level, count: r.count });
      }
    }
  }
  for (const c of get("crafts")?.crafts ?? []) {
    for (const r of c.requires ?? []) {
      entry(r.item).crafts.push({ station: c.station, level: c.level, count: r.count,
        produces: (c.produces ?? []).map((p) => p.item) });
    }
  }
  for (const b of get("barters")?.barters ?? []) {
    for (const r of b.requires ?? []) {
      entry(r.item).barters.push({ trader: b.trader, level: b.level, count: r.count,
        produces: (b.produces ?? []).map((p) => p.item) });
    }
  }
  cache = map;
  cacheKey = key;
  return map;
}

/** Full usage record for an item (empty arrays if unused anywhere). */
export function itemUsage(itemId) {
  return index().get(itemId) ?? { quests: [], hideout: [], crafts: [], barters: [] };
}

/** Find items by (partial) name. Returns [{item, usage}] best matches first. */
export function findItems(term, limit = 5) {
  const q = term.trim().toLowerCase();
  if (!q) return [];
  const items = get("items")?.items ?? [];
  const scored = [];
  for (const item of items) {
    const name = item.name.toLowerCase();
    let score = -1;
    if (name === q) score = 3;
    else if (name.startsWith(q)) score = 2;
    else if (name.includes(q)) score = 1;
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score || a.item.name.length - b.item.name.length);
  return scored.slice(0, limit).map(({ item }) => ({ item, usage: itemUsage(item.id) }));
}

/**
 * "Never sell" set: items still needed by uncompleted quests or unbuilt
 * hideout levels for THIS profile. Complements the Loot Advisor.
 */
export function totalStillNeeded(profile, itemId) {
  const u = itemUsage(itemId);
  let total = 0;
  for (const q of u.quests) {
    if (!profile.completedQuests.includes(q.questId)) total += q.count;
  }
  for (const h of u.hideout) {
    if ((profile.hideout?.[h.station] ?? 0) < h.level) total += h.count;
  }
  return total;
}
