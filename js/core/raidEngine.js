/**
 * raidEngine.js — the raid logger + adaptive player model (v0.8.1,
 * spec Layer 4), no DOM.
 *
 * Every entry in profile.raidLog is a plain record:
 *   { id, ts, mapId, survived, kills, lootValue, notes }
 * All stats below are derived on read — nothing is pre-aggregated, so
 * editing/deleting raid entries never leaves stale totals behind.
 *
 * The personal weighting this feeds into mapRisk/mapScores is
 * intentionally conservative: with fewer than MIN_SAMPLE raids on a map
 * we don't have enough signal, so we stay neutral rather than guess.
 */
import { get } from "./dataLoader.js";

const MIN_SAMPLE = 3; // raids needed on a map before its personal stats count

/** Build a normalized raid record from post-raid form input. */
export function makeRaidEntry({ mapId, survived, kills, lootValue, notes }) {
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    mapId,
    survived: !!survived,
    kills: Math.max(0, parseInt(kills, 10) || 0),
    lootValue: Math.max(0, parseInt(lootValue, 10) || 0),
    notes: (notes ?? "").trim(),
  };
}

function mapName(mapId) {
  return (get("maps")?.maps ?? []).find((m) => m.id === mapId)?.name ?? mapId;
}

/**
 * Overall stats across every logged raid.
 * Returns { total, survived, deaths, survivalRate, kills, deathsForKD,
 *   kd, totalLoot, avgLoot }.
 */
export function stats(profile) {
  const log = profile.raidLog ?? [];
  const total = log.length;
  const survived = log.filter((r) => r.survived).length;
  const deaths = total - survived;
  const kills = log.reduce((sum, r) => sum + r.kills, 0);
  const totalLoot = log.reduce((sum, r) => sum + r.lootValue, 0);
  return {
    total,
    survived,
    deaths,
    survivalRate: total ? survived / total : null,
    kills,
    // K/D convention: deaths floored at 1 so an all-survived streak doesn't divide by zero.
    kd: total ? kills / Math.max(1, deaths) : null,
    totalLoot,
    avgLoot: total ? totalLoot / total : null,
  };
}

/**
 * Per-map breakdown, most-raided first.
 * Returns [{ mapId, name, raids, survived, survivalRate, kills, avgLoot }].
 */
export function byMap(profile) {
  const log = profile.raidLog ?? [];
  const groups = new Map();
  for (const r of log) {
    if (!groups.has(r.mapId)) groups.set(r.mapId, []);
    groups.get(r.mapId).push(r);
  }
  const rows = [];
  for (const [mapId, entries] of groups) {
    const survived = entries.filter((r) => r.survived).length;
    const kills = entries.reduce((s, r) => s + r.kills, 0);
    const loot = entries.reduce((s, r) => s + r.lootValue, 0);
    rows.push({
      mapId,
      name: mapName(mapId),
      raids: entries.length,
      survived,
      survivalRate: survived / entries.length,
      kills,
      avgLoot: loot / entries.length,
    });
  }
  rows.sort((a, b) => b.raids - a.raids || a.name.localeCompare(b.name));
  return rows;
}

/** Most recent N raids, newest first, with map names resolved. */
export function recent(profile, n = 5) {
  return [...(profile.raidLog ?? [])]
    .sort((a, b) => b.ts - a.ts)
    .slice(0, n)
    .map((r) => ({ ...r, name: mapName(r.mapId) }));
}

/**
 * Personal risk adjustment for a map, in risk points (-2..+2).
 * Below MIN_SAMPLE raids on the map, returns 0 (neutral — not enough data).
 * Survives less than your overall average on this map -> risk goes up;
 * survives more -> risk goes down. Purely a function of logged history.
 */
export function personalRiskAdjustment(profile, mapId) {
  const overall = stats(profile);
  const row = byMap(profile).find((m) => m.mapId === mapId);
  if (!row || row.raids < MIN_SAMPLE || overall.survivalRate == null) return 0;
  const delta = overall.survivalRate - row.survivalRate; // positive = you do worse here than average
  if (delta > 0.25) return 2;
  if (delta > 0.1) return 1;
  if (delta < -0.25) return -2;
  if (delta < -0.1) return -1;
  return 0;
}

/**
 * Small progression-score nudge for mapScores: maps you've logged the
 * most raids on (and survive at/above your average) get a slight bonus,
 * reflecting real familiarity/route knowledge. Neutral below MIN_SAMPLE.
 */
export function favoriteBonus(profile, mapId) {
  const overall = stats(profile);
  const row = byMap(profile).find((m) => m.mapId === mapId);
  if (!row || row.raids < MIN_SAMPLE || overall.survivalRate == null) return 0;
  if (row.survivalRate + 0.05 < overall.survivalRate) return 0; // struggling here — no bonus
  return Math.min(2, Math.floor(row.raids / 5)); // +1 per 5 raids, capped
}

/**
 * Personal expected loot for a map — your OWN logged average, nothing else.
 * Returns { avgLoot, raids } once you have MIN_SAMPLE+ logged raids on the
 * map, else null. Deliberately null (not 0, not a game-data guess): there
 * is no honest number to show below the sample threshold. This is the
 * "Expected Profit" the Mission Planner framing wanted, grounded the only
 * way we found that isn't fabricated — in the raidLog itself.
 */
export function personalExpectedLoot(profile, mapId) {
  const row = byMap(profile).find((m) => m.mapId === mapId);
  if (!row || row.raids < MIN_SAMPLE) return null;
  return { avgLoot: row.avgLoot, raids: row.raids };
}
