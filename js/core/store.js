/**
 * store.js — the player profile store.
 *
 * Owns the in-memory copy of the active profile and persists every
 * mutation to IndexedDB. Feature modules never touch the DB directly;
 * they call store.update() and listen for "profile:changed".
 *
 * The profile schema is intentionally forward-looking: later milestones
 * (quest engine, hideout planner, inventory) extend the same record, so
 * saves survive upgrades. `schemaVersion` + migrate() handle evolution.
 */
import { profiles, kv } from "./db.js";
import { emit } from "./events.js";

const SCHEMA_VERSION = 1;
const ACTIVE_PROFILE_KEY = "activeProfileId";

function defaultProfile() {
  return {
    id: crypto.randomUUID(),
    schemaVersion: SCHEMA_VERSION,
    createdAt: Date.now(),
    updatedAt: Date.now(),

    // Identity
    name: "PMC",
    faction: "USEC",          // USEC | BEAR
    edition: "standard",       // standard | leftBehind | prepareForEscape | edgeOfDarkness | unheard
    level: 1,

    // Progress (consumed by later milestones)
    completedQuests: [],       // quest ids
    hiddenQuests: [],          // quest ids the player chose to hide (event/story chains)
    lockedMaps: [],            // map ids not yet unlocked in game (story gating, v0.6.1)
    questObjectives: {},       // questId -> [objectiveIndex, ...]
    traderLevels: {},          // traderId -> loyalty level
    hideout: {},               // moduleId -> built level
    keysOwned: [],             // item ids
    traderRep: {},             // traderId -> standing (manual, v0.8.27; Fence rep for rep-gated quests)
    achievementsEarned: [],    // achievement ids ticked by the player (v0.8.19)
    storylineProgress: {},     // chapterId -> [objective indexes done] (v0.8.21)
    stash: [],                 // inventory records
    inventory: {},             // itemId -> have count (manual, v0.5)
    questLog: {},              // questId -> completion timestamp ms (v0.5)
    raidLog: [],                // [{id, ts, mapId, survived, kills, lootValue, notes}] (v0.8.1)

    // Preferences
    settings: {
      preferredMaps: [],
      playstyle: "balanced",   // rat | balanced | chad
    },
  };
}

/** Migrate an older profile record up to the current schema. */
function migrate(profile) {
  const fresh = defaultProfile();
  // Shallow-merge unknown/missing fields from the current default so old
  // saves gain new fields automatically. Nested objects merged explicitly.
  const merged = {
    ...fresh,
    ...profile,
    settings: { ...fresh.settings, ...(profile.settings ?? {}) },
    inventory: { ...(profile.inventory ?? {}) },
    questLog: { ...(profile.questLog ?? {}) },
    schemaVersion: SCHEMA_VERSION,
  };
  return merged;
}

let active = null;

/** Load (or create) the active profile. Called once at boot. */
export async function init() {
  const activeId = await kv.get(ACTIVE_PROFILE_KEY);
  if (activeId) {
    const stored = await profiles.get(activeId);
    if (stored) {
      active = migrate(stored);
      if (stored.schemaVersion !== SCHEMA_VERSION) await persist();
      return active;
    }
  }
  // First run — create a profile.
  active = defaultProfile();
  await profiles.put(active);
  await kv.set(ACTIVE_PROFILE_KEY, active.id);
  return active;
}

export function getProfile() {
  return active;
}

/**
 * Mutate the active profile.
 * @param {(profile: object) => void} mutator — receives the profile to edit in place.
 */
export async function update(mutator) {
  if (!active) throw new Error("store.update() called before store.init()");
  emit("save:status", { state: "saving" });
  try {
    mutator(active);
    active.updatedAt = Date.now();
    await persist();
    emit("profile:changed", active);
    emit("save:status", { state: "saved", at: active.updatedAt });
  } catch (err) {
    console.error("[store] save failed:", err);
    emit("save:status", { state: "error", error: err });
    throw err;
  }
}

async function persist() {
  await profiles.put(active);
}

/* ---------- Import / export ---------- */

/** Serialize the active profile for backup / transfer. */
export function exportProfile() {
  return JSON.stringify(
    { app: "tarkov-companion", exportedAt: new Date().toISOString(), profile: active },
    null,
    2
  );
}

/** Replace the active profile with an imported backup. */
export async function importProfile(json) {
  const parsed = JSON.parse(json);
  const profile = parsed?.profile;
  if (!profile || typeof profile !== "object" || !profile.id) {
    throw new Error("Not a valid Tarkov Buddy save file.");
  }
  active = migrate(profile);
  await profiles.put(active);
  await kv.set(ACTIVE_PROFILE_KEY, active.id);
  emit("profile:changed", active);
  emit("save:status", { state: "saved", at: Date.now() });
  return active;
}
