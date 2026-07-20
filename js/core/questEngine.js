/**
 * questEngine.js — pure quest logic, no DOM.
 *
 * Quest states:
 *   "completed" — id is in profile.completedQuests
 *   "active"    — level requirement met and all prerequisites completed
 *   "locked"    — level too low or prerequisites outstanding
 *
 * Kept free of UI so the same logic later powers the Loot Advisor,
 * dashboard suggestions, dependency graph, and AI recommendations.
 */
import { get } from "./dataLoader.js";
import { canonicalMapId, mapAccessBlock } from "./mapAccess.js";

/** Wiki-sourced story gate for a quest, or null. Unlocks when the exact
 * chapter objective is ticked on the Storyline page (or, when no
 * objective was matched at import, when the whole chapter is done). */
export function storyGateBlock(quest, profile) {
  const gate = get("storyGates")?.gates?.[quest.id];
  if (!gate) return null;
  const done = new Set(profile.storylineProgress?.[gate.chapterId] ?? []);
  if (gate.objectiveIndex != null) {
    return done.has(gate.objectiveIndex) ? null : gate;
  }
  const chapter = (get("storyline")?.chapters ?? []).find((c) => c.id === gate.chapterId);
  const total = chapter?.objectives?.length ?? 0;
  return total > 0 && done.size >= total ? null : gate;
}

/** First unmet trader-standing requirement for a quest, or null.
 * Rep isn't exposed by any API — the player maintains it on the Traders
 * page (defaults to 0, the game's starting Fence rep). Quests data
 * imported before v0.8.27 has no traderRequirements field, so older
 * imports simply never rep-gate (graceful degradation). */
export function repGateBlock(quest, profile) {
  for (const req of quest.traderRequirements ?? []) {
    if (req.type !== "reputation") continue;
    const rep = Number(profile.traderRep?.[req.trader] ?? 0);
    const v = req.value;
    const ok =
      req.compare === "<" ? rep < v :
      req.compare === "<=" ? rep <= v :
      req.compare === ">" ? rep > v :
      req.compare === "=" || req.compare === "==" ? rep === v :
      rep >= v; // default ">="
    if (!ok) return req;
  }
  return null;
}

export function allQuests() {
  return get("quests")?.quests ?? [];
}

export function questById(id) {
  return allQuests().find((q) => q.id === id) ?? null;
}

/**
 * A quest is relevant if it matches the player's faction and hasn't been
 * manually hidden. Story/event chains (e.g. Boreas/Icebreaker) unlock via
 * in-game triggers the API can't express, so the player can hide them.
 */
export function isRelevant(quest, profile) {
  const faction = quest.faction ?? "Any";
  if (faction !== "Any" && faction !== profile.faction) return false;
  if ((profile.hiddenQuests ?? []).includes(quest.id)) return false;
  return true;
}

/** All quests relevant to this profile. */
export function relevantQuests(profile) {
  return allQuests().filter((q) => isRelevant(q, profile));
}

/** True when the quest's map hasn't been unlocked in game (story gating). */
export function mapLocked(quest, profile) {
  if (quest.map === "any") return false;
  return mapAccessBlock(canonicalMapId(quest.map), profile) != null;
}

/** Human-readable blocker for a quest's map, or null. */
export function mapLockReason(quest, profile) {
  if (quest.map === "any") return null;
  return mapAccessBlock(canonicalMapId(quest.map), profile)?.reason ?? null;
}

export function questState(quest, profile) {
  if (profile.completedQuests.includes(quest.id)) return "completed";
  if (mapLocked(quest, profile)) return "locked";
  if (storyGateBlock(quest, profile)) return "locked";
  if (repGateBlock(quest, profile)) return "locked";
  const levelOk = profile.level >= quest.minLevel;
  const prereqsOk = quest.prerequisites.every((id) =>
    profile.completedQuests.includes(id)
  );
  return levelOk && prereqsOk ? "active" : "locked";
}

/** Human-readable reasons a quest is locked. */
export function lockReasons(quest, profile) {
  const reasons = [];
  if (mapLocked(quest, profile)) {
    reasons.push("Map not unlocked in game yet (toggle on the Maps page)");
  }
  const gate = storyGateBlock(quest, profile);
  if (gate) {
    reasons.push(`Story: ${gate.requirement} (track it on the Storyline page)`);
  }
  const rep = repGateBlock(quest, profile);
  if (rep) {
    const traderName = rep.trader.charAt(0).toUpperCase() + rep.trader.slice(1);
    reasons.push(`Requires ${traderName} rep ${rep.compare} ${rep.value} ` +
      `(yours: ${Number(profile.traderRep?.[rep.trader] ?? 0)} — set it on the Traders page)`);
  }
  if (profile.level < quest.minLevel) {
    reasons.push(`Requires level ${quest.minLevel}`);
  }
  for (const id of quest.prerequisites) {
    if (!profile.completedQuests.includes(id)) {
      reasons.push(`Complete "${questById(id)?.name ?? id}" first`);
    }
  }
  return reasons;
}

/** All quests grouped by state for the current profile. */
export function questsByState(profile) {
  const groups = { active: [], locked: [], completed: [] };
  for (const quest of relevantQuests(profile)) {
    groups[questState(quest, profile)].push(quest);
  }
  return groups;
}

/**
 * Map of itemId -> [{ quest, count, foundInRaid }] for every item that a
 * currently active (or locked-but-upcoming) quest still needs.
 * Used by the Loot Advisor's keep/sell verdicts.
 */
export function questNeededItems(profile, { includeLocked = false, levelWindow = 10 } = {}) {
  const needs = new Map();
  for (const quest of relevantQuests(profile)) {
    const state = questState(quest, profile);
    if (state === "completed") continue;
    if (state === "locked") {
      if (!includeLocked) continue;
      if (mapLocked(quest, profile)) continue; // story-gated: look-ahead doesn't apply
      // Only look ahead a level window — hoarding for level-40 quests at
      // level 8 is exactly the overwhelm this page should prevent.
      if (quest.minLevel > profile.level + levelWindow) continue;
    }
    for (const req of quest.requiredItems ?? []) {
      if (!needs.has(req.item)) needs.set(req.item, []);
      needs.get(req.item).push({
        quest,
        count: req.count,
        foundInRaid: !!req.foundInRaid,
        upcoming: state === "locked",
      });
    }
  }
  return needs;
}

/** Progress summary for dashboard/analytics. */
export function progress(profile) {
  const quests = relevantQuests(profile);
  const completed = profile.completedQuests.filter((id) =>
    quests.some((q) => q.id === id)
  ).length;
  const kappaTotal = quests.filter((q) => q.kappa).length;
  const kappaDone = quests.filter(
    (q) => q.kappa && profile.completedQuests.includes(q.id)
  ).length;
  return { completed, total: quests.length, kappaDone, kappaTotal };
}

/**
 * Per-trader quest completion (v0.5, Progress page).
 * Returns [{ trader, name, done, total, pct }] for every trader that gives
 * at least one relevant quest, sorted by trader data order.
 */
export function traderProgress(profile) {
  const traders = get("traders")?.traders ?? [];
  const quests = relevantQuests(profile);
  const rows = [];
  for (const trader of traders) {
    const own = quests.filter((q) => q.trader === trader.id);
    if (!own.length) continue;
    const done = own.filter((q) => profile.completedQuests.includes(q.id)).length;
    rows.push({ trader: trader.id, name: trader.name, done, total: own.length, pct: (done / own.length) * 100 });
  }
  return rows;
}
