/**
 * hideoutEngine.js — pure hideout logic, no DOM.
 *
 * Data: data/hideout.json (imported via tools/update_data.py).
 * Player state: profile.hideout — { stationId -> built level } (0/absent = not built).
 *
 * Requirement checks mirror the quest engine's honesty about what the app
 * can actually know:
 *   - station prerequisites  -> checked against profile.hideout
 *   - trader loyalty         -> checked against profile.traderLevels
 *   - skill levels           -> NOT tracked by the app; surfaced as "verify
 *                               in game" info, never counted as unmet
 *   - item requirements      -> the shopping list; the app doesn't track
 *                               stash contents, so items are always "to collect"
 *
 * The Loot Advisor consumes hideoutNeededItems(), which follows the same
 * "active only vs look-ahead" philosophy as questNeededItems(): by default
 * only each station's NEXT upgrade counts, so a fresh profile doesn't flag
 * half the item database as KEEP.
 */
import { get } from "./dataLoader.js";

export function allStations() {
  return get("hideout")?.stations ?? [];
}

export function stationById(id) {
  return allStations().find((s) => s.id === id) ?? null;
}

/** Built level of a station for this profile (0 = not built). */
export function builtLevel(profile, stationId) {
  return profile.hideout?.[stationId] ?? 0;
}

/** The next upgrade level record for a station, or null if maxed. */
export function nextLevel(profile, station) {
  const current = builtLevel(profile, station.id);
  return station.levels.find((lv) => lv.level === current + 1) ?? null;
}

/** All level records still to build for a station (ascending). */
export function remainingLevels(profile, station) {
  const current = builtLevel(profile, station.id);
  return station.levels.filter((lv) => lv.level > current);
}

/**
 * Non-item requirement checks for one upgrade level.
 * Returns { stations: [{station, name, level, met}], traders: [...], skills: [...] }.
 * Skills carry met: null — the app cannot verify them.
 */
export function requirementChecks(profile, levelRecord) {
  const stations = (levelRecord.stations ?? []).map((r) => ({
    station: r.station,
    name: stationById(r.station)?.name ?? r.station,
    level: r.level,
    met: builtLevel(profile, r.station) >= r.level,
  }));
  const traders = (levelRecord.traders ?? []).map((r) => ({
    trader: r.trader,
    level: r.level,
    met: (profile.traderLevels?.[r.trader] ?? 1) >= r.level,
  }));
  const skills = (levelRecord.skills ?? []).map((r) => ({
    name: r.name,
    level: r.level,
    met: null, // unverifiable — shown as info only
  }));
  return { stations, traders, skills };
}

/** True when every verifiable (station + trader) prerequisite is met. */
export function prereqsMet(profile, levelRecord) {
  const { stations, traders } = requirementChecks(profile, levelRecord);
  return [...stations, ...traders].every((r) => r.met);
}

/**
 * Map of itemId -> [{ station, stationName, level, count, blocked }] for
 * every item a pending hideout upgrade still needs.
 *
 * Default scope: the NEXT level of each station only (allLevels=false),
 * and only upgrades whose station/trader prereqs are met
 * (includeBlocked=false, v0.8.28) — if you can't start the upgrade yet,
 * its items don't belong on the shopping list, the Loot Advisor, or the
 * Needed Items page. Pass includeBlocked=true for the full build-out
 * picture; those rows carry `blocked: true` so the UI can de-emphasise.
 */
export function hideoutNeededItems(profile, { allLevels = false, includeBlocked = false } = {}) {
  const needs = new Map();
  for (const station of allStations()) {
    const levels = allLevels
      ? remainingLevels(profile, station)
      : [nextLevel(profile, station)].filter(Boolean);
    for (const lv of levels) {
      const blocked = !prereqsMet(profile, lv);
      if (blocked && !includeBlocked) continue;
      for (const req of lv.items ?? []) {
        if (!needs.has(req.item)) needs.set(req.item, []);
        needs.get(req.item).push({
          station: station.id,
          stationName: station.name,
          level: lv.level,
          count: req.count,
          blocked,
        });
      }
    }
  }
  return needs;
}

/**
 * Combined shopping list: [{ item, count, sources: [{stationName, level, count}] }]
 * sorted by total count descending. Same scope switch as hideoutNeededItems.
 */
export function shoppingList(profile, { allLevels = false, includeBlocked = false } = {}) {
  const needs = hideoutNeededItems(profile, { allLevels, includeBlocked });
  const rows = [];
  for (const [item, sources] of needs) {
    rows.push({
      item,
      count: sources.reduce((sum, s) => sum + s.count, 0),
      sources,
    });
  }
  rows.sort((a, b) => b.count - a.count);
  return rows;
}

/** Progress summary for the dashboard tile. */
export function hideoutProgress(profile) {
  const stations = allStations();
  let built = 0;
  let total = 0;
  let maxed = 0;
  for (const s of stations) {
    total += s.maxLevel;
    const lvl = Math.min(builtLevel(profile, s.id), s.maxLevel);
    built += lvl;
    if (s.maxLevel > 0 && lvl >= s.maxLevel) maxed++;
  }
  return { built, total, maxed, stations: stations.length };
}
