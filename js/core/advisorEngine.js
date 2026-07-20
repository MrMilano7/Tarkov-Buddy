/**
 * advisorEngine.js — the deterministic decision engine, no DOM (v0.7,
 * spec Layers 3, 4, 6, 7-backend).
 *
 * Everything here is explainable: every recommendation carries `why` built
 * from the same numbers that produced its score. No randomness, no cloud.
 * The adaptive part (spec Layer 4) is that every score is a function of the
 * live profile — level, completions, hideout, inventory, locked maps — so
 * recommendations change because the player changed.
 */
import { get } from "./dataLoader.js";
import { getProfile } from "./store.js";
import { relevantQuests, questState, lockReasons, progress } from "./questEngine.js";
import { allStations, nextLevel, prereqsMet, builtLevel } from "./hideoutEngine.js";
import { mapScores, mapPlan } from "./routeEngine.js";
import { neededItems, haveCount } from "./inventoryEngine.js";
import { findItems, totalStillNeeded, itemUsage } from "./knowledge.js";
import { personalRiskAdjustment, personalExpectedLoot } from "./raidEngine.js";

/* ---------- risk model (derived, not hardcoded per-map) ---------- */

/**
 * 1 (chill) .. 5 (sweaty), derived from PMC count and boss presence.
 * When a profile is passed and the raid log has enough samples on this
 * map (v0.8.1), the base risk is nudged by how you've actually fared
 * there relative to your overall survival rate.
 */
export function mapRisk(mapRecord, profile) {
  const players = parseInt(String(mapRecord.players).split("-").pop(), 10) || 8;
  const bosses = (mapRecord.summary?.match(/Boss:/) ? 1 : 0);
  let risk = 1 + Math.min(3, Math.floor(players / 4)) + bosses;
  if (profile) risk += personalRiskAdjustment(profile, mapRecord.id);
  return Math.min(5, Math.max(1, risk));
}

/* ---------- session planner (spec: Mission Planner) ---------- */

const RAID_OVERHEAD_MIN = 12; // queue + stash time per raid, rough

/**
 * Plan a play session: given minutes available, pick the best raids in
 * order, plus an after-raid checklist. Deterministic and explained.
 */
export function planSession(profile, { minutes = 120 } = {}) {
  const maps = get("maps")?.maps ?? [];
  const byId = new Map(maps.map((m) => [m.id, m]));
  const scores = mapScores(profile);
  const plan = mapPlan(profile);

  const raids = [];
  let budget = minutes;
  for (const row of scores) {
    const m = byId.get(row.mapId);
    const raidMin = (m?.duration || 35) * 0.7 + RAID_OVERHEAD_MIN; // most raids end early
    if (raids.length && budget < raidMin) break;
    budget -= raidMin;
    const entries = plan.get(row.mapId) ?? [];
    raids.push({
      mapId: row.mapId,
      name: row.name,
      estMinutes: Math.round(raidMin),
      // Personal history only — null until MIN_SAMPLE logged raids on the map.
      expectedLoot: personalExpectedLoot(profile, row.mapId),
      risk: m ? mapRisk(m, profile) : 3,
      score: row.score,
      quests: entries.map((e) => ({
        name: e.quest.name,
        kappa: e.quest.kappa,
        objectives: e.objectives.map((o) => o.description),
      })),
      why: sessionWhy(row, m, profile),
    });
    if (raids.length >= 4) break;
  }

  // After-raid checklist: hideout upgrades that are buildable, and top pickups.
  const buildable = [];
  for (const s of allStations()) {
    const next = nextLevel(profile, s);
    if (!next || !prereqsMet(profile, next)) continue;
    const missing = (next.items ?? []).reduce((sum, r) =>
      sum + Math.max(0, r.count - haveCount(profile, r.item)), 0);
    buildable.push({ station: s.name, level: next.level, itemsMissing: missing });
  }
  buildable.sort((a, b) => a.itemsMissing - b.itemsMissing);

  const pickups = neededItems(profile).filter((r) => r.remaining > 0).slice(0, 5);

  return { raids, buildable: buildable.slice(0, 5), pickups, minutes };
}

function sessionWhy(row, m, profile) {
  const bits = [];
  if (row.objectives) bits.push(`${row.objectives} active objective${row.objectives !== 1 ? "s" : ""}`);
  if (row.kappaQuests) bits.push(`${row.kappaQuests} Kappa quest${row.kappaQuests !== 1 ? "s" : ""}`);
  if (row.itemPickups) bits.push(`${row.itemPickups} needed handover item${row.itemPickups !== 1 ? "s" : ""}`);
  if (m) bits.push(`risk ${mapRisk(m, profile)}/5`);
  return bits.join(", ");
}

/* ---------- next best actions (spec Layer 3) ---------- */

/** Top-level recommendations, scored + explained, best first. */
export function recommendations(profile) {
  const recs = [];

  // 1. Buildable hideout upgrades with everything collected = free progress.
  for (const s of allStations()) {
    const next = nextLevel(profile, s);
    if (!next || !prereqsMet(profile, next)) continue;
    const missing = (next.items ?? []).reduce((sum, r) =>
      sum + Math.max(0, r.count - haveCount(profile, r.item)), 0);
    if (missing === 0) {
      recs.push({
        kind: "build", score: 100,
        title: `Build ${s.name} level ${next.level}`,
        why: "Prerequisites met and every required item is collected — this costs you nothing but a tap.",
        page: "hideout",
      });
    }
  }

  // 2. Best raid right now.
  const [best] = mapScores(profile);
  if (best) {
    const m = (get("maps")?.maps ?? []).find((x) => x.id === best.mapId);
    recs.push({
      kind: "raid", score: 50 + best.score,
      title: `Run ${best.name}`,
      why: `Highest progression value: ${sessionWhy(best, m)}.`,
      page: "maps",
    });
  }

  // 3. Quests one step from unlocking (all prereqs done, level short by <=2).
  for (const q of relevantQuests(profile)) {
    if (questState(q, profile) !== "locked") continue;
    const reasons = lockReasons(q, profile);
    const onlyLevel = reasons.length === 1 && reasons[0].startsWith("Requires level");
    const gap = q.minLevel - profile.level;
    if (onlyLevel && gap > 0 && gap <= 2) {
      recs.push({
        kind: "level", score: 40 - gap,
        title: `${q.name} unlocks at level ${q.minLevel}`,
        why: `You're ${gap} level${gap > 1 ? "s" : ""} away and every prerequisite is done${q.kappa ? " — and it's Kappa-required" : ""}.`,
        page: "quests",
      });
    }
  }

  // 4. Kappa nudge.
  const p = progress(profile);
  if (p.kappaTotal && p.kappaDone < p.kappaTotal) {
    const active = relevantQuests(profile)
      .filter((q) => q.kappa && questState(q, profile) === "active");
    if (active.length) {
      recs.push({
        kind: "kappa", score: 30 + active.length,
        title: `${active.length} Kappa quest${active.length > 1 ? "s" : ""} doable right now`,
        why: `${p.kappaTotal - p.kappaDone} Kappa quests remain; clearing the doable ones keeps the Collector chain moving.`,
        page: "quests",
      });
    }
  }

  recs.sort((a, b) => b.score - a.score);
  return recs.slice(0, 6);
}

/* ---------- natural language interface (spec Layer 7) ---------- */

function traderByName(name) {
  const q = name.trim().toLowerCase();
  return (get("traders")?.traders ?? []).find(
    (t) => t.name.toLowerCase() === q || t.id === q || t.name.toLowerCase().startsWith(q));
}

function answerSellKeep(itemTerm) {
  const profile = getProfile();
  const matches = findItems(itemTerm, 3);
  if (!matches.length) return { text: `I don't have an item matching "${itemTerm}" in the data pack. Try the exact in-game name.` };
  const { item, usage } = matches[0];
  const stillNeeded = totalStillNeeded(profile, item.id);
  const have = haveCount(profile, item.id);
  const lines = [];
  if (stillNeeded > 0) {
    const remaining = Math.max(0, stillNeeded - have);
    lines.push(remaining > 0
      ? `KEEP. You still need ${remaining} more ${item.name} (${have}/${stillNeeded} collected).`
      : `You've collected all ${stillNeeded} needed — extras are safe to sell.`);
    const qs = usage.quests.filter((q) => !profile.completedQuests.includes(q.questId));
    if (qs.length) lines.push(`Quests: ${qs.map((q) => `${q.name} ×${q.count}${q.fir ? " (FIR)" : ""}${q.kappa ? " ★Kappa" : ""}`).join("; ")}.`);
    const hs = usage.hideout.filter((h) => (profile.hideout?.[h.station] ?? 0) < h.level);
    if (hs.length) lines.push(`Hideout: ${hs.map((h) => `${h.stationName} L${h.level} ×${h.count}`).join("; ")}.`);
  } else {
    lines.push(`No uncompleted quest or pending hideout upgrade needs ${item.name}.`);
    const perSlot = Math.round(item.avgPrice / item.slots);
    lines.push(!item.fleaBanned && perSlot >= 15000
      ? `Worth fleaing at ~₽${perSlot.toLocaleString()}/slot.`
      : `Sell it to a trader (~₽${item.traderSell.toLocaleString()}).`);
  }
  if (usage.crafts.length) lines.push(`Also a craft input at ${usage.crafts.length} station recipe${usage.crafts.length > 1 ? "s" : ""} — check Crafts before dumping extras.`);
  if (usage.barters.length) lines.push(`Used in ${usage.barters.length} trader barter${usage.barters.length > 1 ? "s" : ""}.`);
  return { text: lines.join(" "), page: "loot" };
}

function answerWhereFind(itemTerm) {
  const profile = getProfile();
  const matches = findItems(itemTerm, 3);
  if (!matches.length) return { text: `No item matching "${itemTerm}" in the data pack.` };
  const { item, usage } = matches[0];
  const lines = [`${item.name}:`];
  const qs = usage.quests.filter((q) => !profile.completedQuests.includes(q.questId));
  if (qs.length) lines.push(`needed by ${qs.map((q) => q.name).join(", ")}.`);
  const crafts = (get("crafts")?.crafts ?? []).filter((c) => (c.produces ?? []).some((p) => p.item === item.id));
  if (crafts.length) lines.push(`Craftable at ${crafts.map((c) => `${c.station} L${c.level}`).join(", ")}.`);
  const barters = (get("barters")?.barters ?? []).filter((b) => (b.produces ?? []).some((p) => p.item === item.id));
  if (barters.length) lines.push(`Available as a barter from ${barters.map((b) => `${b.trader} LL${b.level}`).join(", ")}.`);
  if (!item.fleaBanned) lines.push(`Buyable on the flea (~₽${item.avgPrice.toLocaleString()}).`);
  else lines.push("Flea-banned — raid, craft, or barter only.");
  lines.push("Spawn-location data isn't in the data pack; check objective coordinates on the Raid Planner or the wiki for exact spots.");
  return { text: lines.join(" ") };
}

function answerTraderPath(name, targetLevel) {
  const profile = getProfile();
  const t = traderByName(name);
  if (!t) return { text: `I don't know a trader called "${name}".` };
  const current = profile.traderLevels?.[t.id] ?? 1;
  const target = targetLevel || Math.min(current + 1, t.loyaltyLevels);
  if (current >= target) return { text: `You're already LL${current} with ${t.name}.` };
  const req = (t.requirements ?? []).find((r) => r.level === target);
  if (!req) return { text: `${t.name} LL${target}: no requirement data in the pack.` };
  const lines = [`${t.name} LL${target} needs:`];
  if (req.playerLevel) lines.push(`player level ${req.playerLevel}${profile.level >= req.playerLevel ? " ✓" : ` (you're ${profile.level})`},`);
  if (req.reputation != null) lines.push(`${req.reputation} rep — earned by completing ${t.name}'s quests,`);
  if (req.spend != null) lines.push(`and ${Number(req.spend).toLocaleString()} spent with them.`);
  lines.push(`Fastest path: clear ${t.name}'s active quests (each gives rep) — see the Quest Graph page for the chain.`);
  return { text: lines.join(" "), page: "questgraph" };
}

function answerWhatToDo(minutesMatch) {
  const profile = getProfile();
  const minutes = minutesMatch ? parseInt(minutesMatch, 10) * (/hour|hr/.test(minutesMatch) ? 60 : 1) : 120;
  const session = planSession(profile, { minutes: Math.max(30, minutes) });
  if (!session.raids.length) {
    return { text: "No active quests to plan around — check the Quests page for what's locked and why.", page: "quests" };
  }
  const lines = session.raids.slice(0, 3).map((r, i) =>
    `${i + 1}. ${r.name} (~${r.estMinutes} min, risk ${r.risk}/5): ${r.why}`);
  if (session.buildable.length) {
    lines.push(`After raiding: ${session.buildable.filter((b) => b.itemsMissing === 0).map((b) => `build ${b.station} L${b.level}`).join(", ") || "collect for " + session.buildable[0].station}.`);
  }
  return { text: lines.join("\n"), page: "maps" };
}

/**
 * The intent matcher: natural language in, structured engine answer out.
 * Deterministic — same question, same profile, same answer.
 */
export function ask(question) {
  const q = question.trim().toLowerCase();
  let m;
  if ((m = q.match(/(?:should i|do i) (?:sell|keep)(?: my| the| an?| this)?\s+(.+?)\??$/))) return answerSellKeep(m[1]);
  if ((m = q.match(/(?:where|how) (?:do i |can i )?(?:find|get|farm)(?: an?| the| some)?\s+(.+?)\??$/))) return answerWhereFind(m[1]);
  if ((m = q.match(/how (?:do i|to) (?:reach|get|hit|unlock)\s+(\w+)(?:\s+(?:level|ll|lvl)?\s*(\d))?/))) return answerTraderPath(m[1], m[2] ? parseInt(m[2], 10) : 0);
  if ((m = q.match(/(\d+\s*(?:hours?|hrs?|minutes?|mins?))/)) && /what|plan|do|play/.test(q)) return answerWhatToDo(m[1]);
  if (/what (?:should i do|map|now|tonight)|plan my|best raid|where should i go/.test(q)) return answerWhatToDo(null);
  if (/kappa/.test(q)) {
    const p = progress(getProfile());
    return { text: `Kappa: ${p.kappaDone}/${p.kappaTotal} done, ${p.kappaTotal - p.kappaDone} to go. The Progress page has per-trader breakdowns; the Quests page has a Kappa-only filter.`, page: "progress" };
  }
  return {
    text: "I can answer: \"should I sell <item>?\", \"where do I find <item>?\", \"how do I reach <trader> level <n>?\", \"what should I do tonight?\", or \"plan 2 hours\". Everything is computed from your profile and the data pack — offline and deterministic.",
  };
}
