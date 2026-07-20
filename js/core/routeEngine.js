/**
 * routeEngine.js — pure raid-routing logic, no DOM (v0.6).
 *
 * The honest version of a "route optimizer": without a nav mesh the app
 * can't pathfind, but it CAN answer the two questions that matter before
 * hitting Ready:
 *   1. Which map advances my account the most right now?  -> mapScores()
 *   2. Once I'm there, what am I doing and where?          -> mapPlan()
 *
 * Objective locations come from quests.json objectiveDetails (importer
 * v0.6+): per-objective `maps` and optional `positions` ({map,x,z} game
 * coordinates). Old data packs without objectiveDetails degrade cleanly to
 * the quest-level `map` field.
 */
import { get } from "./dataLoader.js";
import { canonicalMapId, mapAccessBlock } from "./mapAccess.js";
import { relevantQuests, questState } from "./questEngine.js";
import { haveCount } from "./inventoryEngine.js";
import { favoriteBonus } from "./raidEngine.js";

// Scoring weights — tune to taste. Kappa quests count extra because they
// gate the Collector; item handovers you still need count because raids
// where a needed quest item spawns do double duty.
const W_OBJECTIVE = 1;
const W_KAPPA_BONUS = 2;   // per kappa quest touchable on the map
const W_ITEM_PICKUP = 1;   // per still-needed handover item for that quest

/** Which maps an objective can be done on. [] = quest-level map applies. */
function objectiveMaps(quest, detail) {
  const maps = detail?.maps?.length ? detail.maps : (quest.map && quest.map !== "any" ? [quest.map] : ["any"]);
  // Source data occasionally repeats the same map id for one objective --
  // dedupe here, since the caller iterates this list and would otherwise
  // push the entire objective (description + positions) once per repeat.
  return [...new Set(maps)];
}

/** [{quest, objectives:[{description,type,positions:[{x,z}]}]}] per map. */
export function mapPlan(profile) {
  const active = relevantQuests(profile).filter((q) => questState(q, profile) === "active");
  const plans = new Map(); // mapId -> Map(questId -> {quest, objectives})

  for (const quest of active) {
    const details = quest.objectiveDetails?.length
      ? quest.objectiveDetails
      : quest.objectives.map((description) => ({ description, type: "" }));
    for (const detail of details) {
      for (const rawMapId of objectiveMaps(quest, detail)) {
        const mapId = rawMapId === "any" ? "any" : canonicalMapId(rawMapId);
        if (!plans.has(mapId)) plans.set(mapId, new Map());
        const byQuest = plans.get(mapId);
        if (!byQuest.has(quest.id)) byQuest.set(quest.id, { quest, objectives: [] });
        const positions = (detail.positions ?? [])
          .filter((p) => canonicalMapId(p.map) === mapId);
        // Some source data lists the same (x,z) more than once per objective
        // (e.g. a multi-trigger zone reported as separate entries) — dedupe
        // here so it flows correctly into both the display string and the
        // route builder, rather than fixing it in two separate places.
        const seen = new Set();
        const deduped = positions.filter((p) => {
          const key = `${p.x},${p.z}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        byQuest.get(quest.id).objectives.push({
          description: detail.description,
          type: detail.type ?? "",
          positions: deduped,
        });
      }
    }
  }

  const out = new Map();
  for (const [mapId, byQuest] of plans) {
    const entries = [...byQuest.values()].map((entry) => {
      // Final defensive pass: collapse any objectives that are still exact
      // duplicates (same description + same position set) regardless of
      // which upstream step produced them. Two legitimately different
      // objectives that happen to share wording would also share positions
      // only by coincidence, so this key is safe.
      const seen = new Set();
      const objectives = entry.objectives.filter((o) => {
        const key = `${o.description}|${o.positions.map((p) => `${p.x},${p.z}`).join(";")}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ...entry, objectives };
    });
    out.set(mapId, entries);
  }
  return out;
}

/**
 * Ranked raid suggestions: [{ mapId, name, score, quests, objectives,
 * kappaQuests, itemPickups }] best first. "any" objectives are excluded
 * from ranking (they advance on every map) but exposed separately.
 */
export function mapScores(profile) {
  const plan = mapPlan(profile);
  const maps = get("maps")?.maps ?? [];
  const mapName = (id) => maps.find((m) => m.id === id)?.name ?? id;

  const remainingHandover = (quest) =>
    (quest.requiredItems ?? []).reduce((sum, r) =>
      sum + Math.max(0, r.count - haveCount(profile, r.item)), 0);

  const rows = [];
  for (const [mapId, entries] of plan) {
    if (mapId === "any") continue;
    if (mapAccessBlock(mapId, profile)) continue; // can't enter -> don't recommend
    let objectives = 0;
    let kappaQuests = 0;
    let itemPickups = 0;
    for (const e of entries) {
      objectives += e.objectives.length;
      if (e.quest.kappa) kappaQuests++;
      itemPickups += remainingHandover(e.quest);
    }
    const familiarity = favoriteBonus(profile, mapId); // v0.8.1, 0 if not enough raid history
    rows.push({
      mapId,
      name: mapName(mapId),
      quests: entries.length,
      objectives,
      kappaQuests,
      itemPickups,
      familiarity,
      score: objectives * W_OBJECTIVE + kappaQuests * W_KAPPA_BONUS + itemPickups * W_ITEM_PICKUP + familiarity,
    });
  }
  rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return rows;
}

/* ---------- route optimizer (v0.8.2, spec Layer 6) ---------- */

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Order this map's pickup points via greedy nearest-neighbor routing, then
 * suggest the nearest usable extract from the last stop. Deterministic —
 * no pathfinding/nav mesh, just straight-line distance between imported
 * coordinates, which is honest about what the data actually supports.
 *
 * `entries` is what mapPlan().get(mapId) returns: [{quest, objectives}].
 * Returns { stops: [{x,z,description,questName}], totalDistance, extract }.
 * Empty/missing position data degrades to an empty route with no ranked
 * stops — the caller falls back to the plain per-quest objective list.
 */
export function orderRoute(mapId, entries, profile) {
  const points = [];
  for (const e of entries ?? []) {
    for (const o of e.objectives) {
      for (const p of o.positions ?? []) {
        points.push({ x: p.x, z: p.z, description: o.description, questName: e.quest.name });
      }
    }
  }
  if (!points.length) {
    return { stops: [], totalDistance: 0, extractOptions: suggestExtracts(mapId, null, profile) };
  }

  // Greedy nearest-neighbor. The API doesn't expose spawn points, so there's
  // no principled "start" — we start from the first imported point, which
  // keeps results stable/reproducible rather than picking one at random.
  const remaining = [...points];
  const ordered = [remaining.shift()];
  while (remaining.length) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0;
    let bestDist = Infinity;
    remaining.forEach((p, i) => {
      const d = dist(last, p);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }

  let totalDistance = 0;
  for (let i = 1; i < ordered.length; i++) totalDistance += dist(ordered[i - 1], ordered[i]);

  return {
    stops: ordered,
    totalDistance: Math.round(totalDistance),
    extractOptions: suggestExtracts(mapId, ordered[ordered.length - 1], profile),
  };
}

/**
 * Nearest usable extract to a point (or just the first usable one if no
 * point is given). Prefers extracts matching the player's faction, but
 * falls back to any extract if none are faction-matched — a shared/co-op
 * extract is still useful information. Returns null if the data pack has
 * no extracts imported for this map yet.
 */
/**
 * Ranked extract options near a point (or from the start, if no point),
 * nearest first. Returns up to `limit` entries. Extracts are never
 * guaranteed open in a given raid -- some are randomized, some need a
 * keyword/item/switch -- so this deliberately returns options rather than
 * one "correct" answer, letting the player pick a backup if their first
 * choice turns out to be closed. Unconditional extracts are listed ahead of
 * conditional ones at the same rough distance, since they're a safer bet.
 */
export function suggestExtracts(mapId, point, profile, limit = 3) {
  const maps = get("maps")?.maps ?? [];
  const extracts = maps.find((m) => m.id === mapId)?.extracts ?? [];
  if (!extracts.length) return [];

  const faction = profile?.faction;
  const matching = faction ? extracts.filter((ex) => ex.faction === "Any" || ex.faction === faction) : extracts;
  const pool = matching.length ? matching : extracts;

  const ranked = [...pool].sort((a, b) => {
    if (point) {
      const da = dist(point, a), db = dist(point, b);
      if (Math.abs(da - db) > 1e-6) return da - db;
    }
    return (a.requires ? 1 : 0) - (b.requires ? 1 : 0);
  });
  return ranked.slice(0, limit);
}

/**
 * Back-compat single-extract wrapper around suggestExtracts() -- prefers an
 * unconditional extract, only returning a gated one if it's the only option.
 */
export function suggestExtract(mapId, point, profile) {
  return suggestExtracts(mapId, point, profile, 1)[0] ?? null;
}

/* ---------- quest dependency graph (v0.6) ---------- */

/**
 * Layered DAG for one trader's quest chain.
 * Returns { nodes: [{quest, state, depth, row}], edges: [{from, to}] }.
 * depth = longest prerequisite chain (computed over ALL quests, so
 * cross-trader prerequisites still push a quest right), edges only include
 * pairs where both ends belong to the selected trader.
 */
export function traderGraph(profile, traderId) {
  const all = relevantQuests(profile);
  const byId = new Map(all.map((q) => [q.id, q]));

  const depthMemo = new Map();
  const depth = (id, seen = new Set()) => {
    if (depthMemo.has(id)) return depthMemo.get(id);
    if (seen.has(id)) return 0; // defensive: cycles in bad data
    seen.add(id);
    const quest = byId.get(id);
    const d = quest && quest.prerequisites.length
      ? 1 + Math.max(...quest.prerequisites.map((p) => depth(p, seen)))
      : 0;
    depthMemo.set(id, d);
    return d;
  };

  const own = all.filter((q) => q.trader === traderId);
  const ownIds = new Set(own.map((q) => q.id));

  const nodes = own.map((quest) => ({
    quest,
    state: questState(quest, profile),
    depth: depth(quest.id),
    row: 0,
  }));
  // rows: stable order within each column, by minLevel then name
  const cols = new Map();
  for (const n of nodes) {
    if (!cols.has(n.depth)) cols.set(n.depth, []);
    cols.get(n.depth).push(n);
  }
  for (const col of cols.values()) {
    col.sort((a, b) => a.quest.minLevel - b.quest.minLevel || a.quest.name.localeCompare(b.quest.name));
    col.forEach((n, i) => { n.row = i; });
  }

  const edges = [];
  for (const quest of own) {
    for (const pre of quest.prerequisites) {
      if (ownIds.has(pre)) edges.push({ from: pre, to: quest.id });
    }
  }
  return { nodes, edges };
}
