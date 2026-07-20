/**
 * mapAccess.js — map variants and access gating (v0.8.18, DOM-free).
 *
 * Two related problems, one module:
 *
 * 1. VARIANTS. The API models level bands and day/night as separate maps
 *    (ground-zero vs ground-zero-21, factory vs night-factory). In-game
 *    they're the same place, so quest objectives pointing at a variant id
 *    must COUNT TOWARD THE BASE MAP, not be dropped — a level-21+ player's
 *    Ground Zero quests live on the "ground-zero-21" id. `canonicalMapId`
 *    is the single mapping; display code hides variants, planning code
 *    merges them.
 *
 * 2. ACCESS. Newer imports carry per-map `access` from the API:
 *    { minLevel, maxLevel, accessKeys[], accessKeysMinLevel }. Real data,
 *    used to auto-exclude maps the player can't enter yet (the "planner
 *    recommends Icebreaker at level 1" bug) with an explicit reason.
 *    maxLevel is deliberately IGNORED for locking — level bands are merged
 *    via canonicalization, so the base map represents all bands.
 *    Older imports have `access: undefined` → no auto-locks, and the UI
 *    tells the user to re-run the importer rather than silently knowing
 *    less. The manual "locked in game" checkbox always still applies —
 *    story gating exists that no API exposes.
 */
import { get } from "./dataLoader.js";

const VARIANT_BASE = {
  "night-factory": "factory",
  "the-lab-dark": "the-lab",
  "ground-zero-21": "ground-zero",
  "ground-zero-tutorial": "ground-zero",
};

export const HIDDEN_VARIANTS = new Set(Object.keys(VARIANT_BASE));

/** Variant id -> base id; anything else passes through unchanged. */
export function canonicalMapId(id) {
  return VARIANT_BASE[id] ?? id;
}

/** True if any map entry in the current data carries access info. */
export function hasAccessData() {
  return (get("maps")?.maps ?? []).some((m) => m.access != null);
}

function mapById(id) {
  return (get("maps")?.maps ?? []).find((m) => m.id === id);
}

/**
 * Why can't this profile enter this map right now?
 * Returns null (no known blocker) or { reason, level? }.
 * Checks, in order: manual lock, real level requirement, access keys.
 * Access keys block only if the player owns none of them (Labs-style);
 * key requirements below accessKeysMinLevel are ignored per the API's
 * own semantics (keys stop being required above that level... inverse:
 * accessKeysMinPlayerLevel is the level FROM which keys are required —
 * data is sparse either way, so keys are a soft note, not a hard lock,
 * unless the map has NO keyless entry and the player owns no key).
 */
export function mapAccessBlock(mapId, profile) {
  const id = canonicalMapId(mapId);
  if ((profile.lockedMaps ?? []).includes(id)) {
    return { reason: "manually marked locked" };
  }
  const m = mapById(id);
  const a = m?.access;
  if (!a) return null; // old data or query failed at import — stay silent
  if (a.minLevel != null && a.minLevel > 0 && (profile.level ?? 1) < a.minLevel) {
    return { reason: `unlocks at level ${a.minLevel}`, level: a.minLevel };
  }
  if (a.accessKeys?.length) {
    const owned = new Set(profile.keysOwned ?? []);
    if (!a.accessKeys.some((k) => owned.has(k.id))) {
      return { reason: `requires ${a.accessKeys.map((k) => k.name).join(" or ")}` };
    }
  }
  return null;
}
