/**
 * inventoryEngine.js — pure needed-items logic, no DOM (v0.5).
 *
 * Merges questNeededItems() and hideoutNeededItems() into unified rows:
 *   { item, itemId, needed, have, remaining, fir, sources: [...] }
 *
 * Have-counts are manual (profile.inventory, itemId -> count) — the app
 * cannot see the in-game stash, so the player ticks items off as they
 * collect them. Scope defaults stay anti-overwhelm: active quests only and
 * each station's NEXT upgrade only, with the same opt-in toggles the Loot
 * Advisor and Hideout Planner use.
 */
import { get } from "./dataLoader.js";
import { questNeededItems } from "./questEngine.js";
import { hideoutNeededItems } from "./hideoutEngine.js";

/** How many of an item the player says they have. */
export function haveCount(profile, itemId) {
  return profile.inventory?.[itemId] ?? 0;
}

function itemRecord(itemId) {
  const item = (get("items")?.items ?? []).find((i) => i.id === itemId);
  // Items referenced by quests/hideout but missing from items.json still
  // get a row — the id doubles as a display name until the importer catches up.
  return item ?? { id: itemId, name: itemId, category: "Unknown", slots: 1, avgPrice: 0, traderSell: 0, fleaBanned: false };
}

/**
 * Unified needed-items rows for the Needed Items page and Loot Advisor.
 *
 * Options mirror the source engines:
 *   includeLocked / levelWindow — quest look-ahead (questNeededItems)
 *   allLevels                   — full hideout build-out (hideoutNeededItems)
 *
 * Row shape:
 *   item      — the item record (from items.json, or a stub)
 *   itemId    — convenience copy of item.id
 *   needed    — total count across all sources
 *   have      — profile.inventory count
 *   remaining — max(0, needed - have)
 *   fir       — true if ANY quest source requires found-in-raid
 *   sources   — [{ type: "quest"|"hideout", label, count, fir?, upcoming?, blocked? }]
 */
export function neededItems(profile, { includeLocked = false, levelWindow = 10, allLevels = false } = {}) {
  const rows = new Map(); // itemId -> row

  const rowFor = (itemId) => {
    if (!rows.has(itemId)) {
      rows.set(itemId, {
        item: itemRecord(itemId),
        itemId,
        needed: 0,
        have: haveCount(profile, itemId),
        remaining: 0,
        fir: false,
        sources: [],
      });
    }
    return rows.get(itemId);
  };

  const questNeeds = questNeededItems(profile, { includeLocked, levelWindow });
  for (const [itemId, needs] of questNeeds) {
    const row = rowFor(itemId);
    for (const n of needs) {
      row.needed += n.count;
      if (n.foundInRaid) row.fir = true;
      row.sources.push({
        type: "quest",
        label: n.quest.name,
        count: n.count,
        fir: n.foundInRaid,
        upcoming: !!n.upcoming,
      });
    }
  }

  const hideoutNeeds = hideoutNeededItems(profile, { allLevels });
  for (const [itemId, needs] of hideoutNeeds) {
    const row = rowFor(itemId);
    for (const n of needs) {
      row.needed += n.count;
      row.sources.push({
        type: "hideout",
        label: `${n.stationName} L${n.level}`,
        count: n.count,
        blocked: !!n.blocked,
      });
    }
  }

  const out = [...rows.values()];
  for (const row of out) {
    row.remaining = Math.max(0, row.needed - row.have);
  }
  // Most-still-needed first, then name — keeps the "what do I hunt next"
  // answer at the top of the page.
  out.sort((a, b) => b.remaining - a.remaining || a.item.name.localeCompare(b.item.name));
  return out;
}

/**
 * Collection progress across the given scope.
 * counted per item as min(have, needed) so surplus doesn't inflate the bar.
 */
export function collectionProgress(profile, opts = {}) {
  const rows = neededItems(profile, opts);
  let needed = 0;
  let collected = 0;
  let itemsDone = 0;
  for (const row of rows) {
    needed += row.needed;
    collected += Math.min(row.have, row.needed);
    if (row.needed > 0 && row.have >= row.needed) itemsDone++;
  }
  return {
    needed,
    collected,
    pct: needed ? (collected / needed) * 100 : 0,
    items: rows.length,
    itemsDone,
  };
}
