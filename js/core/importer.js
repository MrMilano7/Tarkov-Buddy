/**
 * importer.js — in-browser game-data importer (v0.9.0).
 *
 * A faithful port of tools/update_data.py: same GraphQL queries, same
 * fallback ladders, same transforms — verified by a parity test that runs
 * identical mocked payloads through both implementations and diffs the
 * JSON. This is what makes zero-setup hosting possible: instead of Python
 * writing data/*.json, the browser fetches from api.tarkov.dev directly
 * and stores datasets in IndexedDB (kv store, `dataset:<id>` keys), which
 * dataLoader reads first at boot.
 *
 * The Python importer remains fully supported — file datasets still load,
 * and any dataset present ONLY as a file (e.g. storyline until its wiki
 * fetch is ported) keeps working alongside browser-imported ones.
 *
 * Ladder discipline (house rule): risky fields live in separate queries
 * that degrade on schema rejection; total failure of a side query never
 * blocks the core import.
 */
import { kv } from "./db.js";
import { fetchStoryline, fetchStoryGates } from "./wikiImport.js";

const API = "https://api.tarkov.dev/graphql";

/* ---------- python-compat helpers ---------- */

/** Python round(): banker's rounding (half to even), no decimals. */
function pyRound(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** Local date as YYYY-MM-DD (python date.today().isoformat()). */
function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- queries (verbatim from update_data.py) ---------- */

const QUERY = `
{
  tasks {
    id name minPlayerLevel kappaRequired experience factionName
    trader { normalizedName }
    map { normalizedName }
    taskRequirements { task { id } }
    wikiLink
    neededKeys { keys { id } }
    objectives {
      id description type
      ... on TaskObjectiveItem { items { id } count foundInRaid }
    }
  }
  traders {
    normalizedName name currency { shortName }
    levels { level requiredPlayerLevel requiredReputation requiredCommerce }
  }
  maps {
    normalizedName name players raidDuration
    description
    bosses { boss { name } }
  }
  items {
    id name width height avg24hPrice changeLast48hPercent
    category { name }
    types
    sellFor { priceRUB vendor { normalizedName } }
  }
  hideoutStations {
    id name normalizedName
    levels {
      level constructionTime
      itemRequirements { item { id } count }
      stationLevelRequirements { station { normalizedName } level }
      traderRequirements { trader { normalizedName } level }
      skillRequirements { name level }
    }
  }
  crafts {
    station { normalizedName } level duration
    requiredItems { item { id } count }
    rewardItems { item { id } count }
  }
  barters {
    trader { normalizedName } level
    requiredItems { item { id } count }
    rewardItems { item { id } count }
  }
  ammo {
    item { id name shortName }
    caliber ammoType tracer projectileCount
    damage armorDamage penetrationPower fragmentationChance initialSpeed
  }
}`;

const GEO_QUERIES = [
  `{ tasks { id objectives { id maps { normalizedName }
    ... on TaskObjectiveBasic { zones { map { normalizedName } position { x y z } } }
    ... on TaskObjectiveQuestItem { possibleLocations { map { normalizedName } positions { x y z } } }
  } } }`,
  `{ tasks { id objectives { id maps { normalizedName }
    ... on TaskObjectiveQuestItem { possibleLocations { map { normalizedName } positions { x y z } } }
  } } }`,
  `{ tasks { id objectives { id maps { normalizedName } } } }`,
];

const EXTRACTS_QUERIES = [
  `{ maps { normalizedName extracts { name faction position { x y z }
    transferItem { item { name } } switches { name } } } }`,
  `{ maps { normalizedName extracts { name faction position { x y z } transferItem { name } } } }`,
  `{ maps { normalizedName extracts { name position { x y z } } } }`,
  `{ maps { normalizedName extracts { name } } }`,
];

const TRANSITS_QUERIES = [
  `{ maps { normalizedName transits { description position { x y z } map { normalizedName } } } }`,
  `{ maps { normalizedName transits { description map { normalizedName } } } }`,
  `{ maps { normalizedName transits { map { normalizedName } } } }`,
];

const ACCESS_QUERY = `
{ maps { normalizedName minPlayerLevel maxPlayerLevel accessKeysMinPlayerLevel
  accessKeys { id name } } }`;

const ACHIEVEMENTS_QUERY = `
{ achievements { id name description hidden side rarity playersCompletedPercent } }`;

// v0.9.12: prestige levels. Risky new fields (transferSettings is a union
// added recently), so it gets its own ladder per house rules.
const PRESTIGE_QUERIES = [
  `{ prestige {
    id name prestigeLevel imageLink
    conditions { id type description }
    rewards {
      items { item { id name } count }
      skillLevelReward { name level }
      customization { id name }
    }
    transferSettings {
      ... on PrestigeTransferSettingsStash { gridWidth gridHeight }
      ... on PrestigeTransferSettingsSkill { name skillType transferRate }
    }
  } }`,
  `{ prestige { id name prestigeLevel conditions { id type description } } }`,
  `{ prestige { id name prestigeLevel } }`,
];

const TRADER_REQ_QUERIES = [
  `{ tasks { id traderRequirements { trader { normalizedName } requirementType compareMethod value } } }`,
  `{ tasks { id traderRequirements { trader { normalizedName } level } } }`,
];

/* ---------- fetch plumbing ---------- */

async function gql(query) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const payload = await res.json();
  if (payload.errors) {
    const err = new Error(payload.errors[0]?.message ?? "GraphQL error");
    err.graphql = true;
    throw err;
  }
  return payload.data;
}

/** Ladder runner: first query that succeeds wins; null on total failure. */
async function ladder(queries, log, label) {
  for (const q of queries) {
    try {
      return await gql(q);
    } catch (e) {
      log(`${label} query rejected (${String(e.message).slice(0, 80)}), trying simpler form...`);
    }
  }
  log(`no ${label} data available`);
  return null;
}

/* ---------- side-data parsers (ports of the pure _parse_* functions) ---------- */

export function parseGeo(tasks) {
  const out = {};
  for (const t of tasks ?? []) {
    const objs = {};
    for (const o of t.objectives ?? []) {
      const maps = (o.maps ?? []).filter(Boolean).map((m) => m.normalizedName);
      const positions = [];
      for (const z of o.zones ?? []) {
        const pos = z.position ?? {};
        if (z.map) positions.push({ map: z.map.normalizedName, x: pyRound(pos.x ?? 0), z: pyRound(pos.z ?? 0) });
      }
      for (const loc of o.possibleLocations ?? []) {
        const mp = loc.map?.normalizedName;
        for (const pos of (loc.positions ?? []).slice(0, 3)) {
          if (mp) positions.push({ map: mp, x: pyRound(pos.x ?? 0), z: pyRound(pos.z ?? 0) });
        }
      }
      if (maps.length || positions.length) objs[o.id] = { maps, positions };
    }
    if (Object.keys(objs).length) out[t.id] = objs;
  }
  return out;
}

export function parseExtracts(mapsData) {
  const out = {};
  for (const m of mapsData ?? []) {
    const mid = m.normalizedName;
    if (!mid) continue;
    const exs = [];
    for (const ex of m.extracts ?? []) {
      const pos = ex.position ?? {};
      let faction = (ex.faction ?? "Any").toUpperCase();
      if (faction !== "BEAR" && faction !== "USEC") faction = "Any";
      const entry = { name: ex.name ?? "?", faction, x: pyRound(pos.x ?? 0), z: pyRound(pos.z ?? 0) };
      const reqs = [];
      const ti = ex.transferItem;
      const tname = (ti?.item ?? {}).name ?? ti?.name;
      if (tname) reqs.push(`needs ${tname}`);
      for (const sw of ex.switches ?? []) if (sw.name) reqs.push(`requires ${sw.name}`);
      if (reqs.length) entry.requires = reqs.join("; ");
      exs.push(entry);
    }
    if (exs.length) out[mid] = exs;
  }
  return out;
}

export function parseTransits(mapsData) {
  const out = {};
  for (const m of mapsData ?? []) {
    const mid = m.normalizedName;
    if (!mid) continue;
    const trs = [];
    for (const tr of m.transits ?? []) {
      const target = tr.map?.normalizedName ?? "?";
      const entry = { name: tr.description || `Transit to ${target}`, targetMap: target };
      if (tr.position) {
        entry.x = pyRound(tr.position.x ?? 0);
        entry.z = pyRound(tr.position.z ?? 0);
      }
      trs.push(entry);
    }
    if (trs.length) out[mid] = trs;
  }
  return out;
}

export function parseAchievements(achievements) {
  return (achievements ?? []).map((a) => ({
    id: a.id, name: a.name,
    description: a.description ?? "",
    hidden: Boolean(a.hidden),
    side: a.side ?? "All",
    rarity: a.rarity ?? "Common",
    completedPct: a.playersCompletedPercent ?? null,
  }));
}

export function parsePrestige(prestige) {
  return (prestige ?? [])
    .map((p) => ({
      id: p.id,
      name: p.name ?? `Prestige ${p.prestigeLevel ?? "?"}`,
      level: p.prestigeLevel ?? 0,
      imageLink: p.imageLink ?? null,
      conditions: (p.conditions ?? []).filter(Boolean).map((c) => ({
        id: c.id, type: c.type ?? "", description: c.description ?? "",
      })),
      rewards: {
        items: (p.rewards?.items ?? []).filter((r) => r.item)
          .map((r) => ({ item: r.item.id, name: r.item.name, count: r.count || 1 })),
        skills: (p.rewards?.skillLevelReward ?? [])
          .map((s) => ({ name: s.name ?? "?", level: s.level ?? 0 })),
        customization: (p.rewards?.customization ?? []).filter(Boolean)
          .map((c) => ({ id: c.id, name: c.name ?? "?" })),
      },
      // union: stash entries have gridWidth, skill entries have transferRate
      transfer: (p.transferSettings ?? []).filter(Boolean).map((t) =>
        t.gridWidth != null
          ? { kind: "stash", gridWidth: t.gridWidth, gridHeight: t.gridHeight ?? null }
          : { kind: "skill", name: t.name ?? "?", skillType: t.skillType ?? "", rate: t.transferRate ?? null }),
    }))
    .sort((a, b) => a.level - b.level);
}

export function parseMapAccess(mapsData) {
  const out = {};
  for (const m of mapsData ?? []) {
    out[m.normalizedName] = {
      minLevel: m.minPlayerLevel ?? null,
      maxLevel: m.maxPlayerLevel ?? null,
      accessKeys: (m.accessKeys ?? []).map((k) => ({ id: k.id, name: k.name })),
      accessKeysMinLevel: m.accessKeysMinPlayerLevel ?? null,
    };
  }
  return out;
}

export function parseTraderReqs(tasksData) {
  const out = {};
  for (const t of tasksData ?? []) {
    const reqs = [];
    for (const r of t.traderRequirements ?? []) {
      const rtype = r.requirementType ?? "loyaltyLevel";
      if (rtype !== "reputation" && rtype !== "standing") continue;
      reqs.push({
        trader: r.trader?.normalizedName ?? "?",
        type: "reputation",
        compare: r.compareMethod ?? ">=",
        value: r.value ?? 0,
      });
    }
    if (reqs.length) out[t.id] = reqs;
  }
  return out;
}

/* ---------- transforms (ports of transform_*) ---------- */

export function transformQuests(tasks, geo = {}, traderReqs = {}) {
  const quests = [];
  for (const t of tasks) {
    const required = [];
    const objectives = [];
    const details = [];
    const taskGeo = geo[t.id] ?? {};
    for (const o of t.objectives) {
      if (o.description) objectives.push(o.description);
      const og = taskGeo[o.id] ?? {};
      const detail = { description: o.description ?? "", type: o.type ?? "" };
      if (og.maps?.length) detail.maps = og.maps;
      if (og.positions?.length) detail.positions = og.positions;
      details.push(detail);
      if (o.type === "giveItem" && o.items?.length) {
        required.push({
          item: o.items[0].id,
          count: o.count ?? 1,
          foundInRaid: Boolean(o.foundInRaid),
        });
      }
    }
    const q = {
      id: t.id,
      name: t.name,
      trader: t.trader.normalizedName,
      map: t.map ? t.map.normalizedName : "any",
      minLevel: t.minPlayerLevel || 1,
      kappa: Boolean(t.kappaRequired),
      faction: t.factionName || "Any",
      prerequisites: (t.taskRequirements ?? []).filter((r) => r.task).map((r) => r.task.id),
      objectives,
      objectiveDetails: details,
      requiredItems: required,
      wikiLink: t.wikiLink ?? null,
      neededKeys: [...new Set((t.neededKeys ?? []).flatMap((nk) => (nk.keys ?? []).map((k) => k.id)))].sort(),
      rewards: { exp: t.experience || 0 },
    };
    if (traderReqs[t.id]) q.traderRequirements = traderReqs[t.id];
    quests.push(q);
  }
  return { note: `Imported from tarkov.dev on ${todayISO()}.`, quests };
}

export function transformTraders(traders) {
  return {
    traders: traders.map((t) => ({
      id: t.normalizedName,
      name: t.name,
      currency: t.currency?.shortName || "RUB",
      loyaltyLevels: Math.max(1, ...(t.levels ?? []).map((lv) => lv.level)),
      specialty: "",
      requirements: (t.levels ?? []).filter((lv) => lv.level > 1).map((lv) => ({
        level: lv.level, playerLevel: lv.requiredPlayerLevel,
        reputation: lv.requiredReputation, spend: lv.requiredCommerce,
      })),
    })),
  };
}

export function transformMaps(maps, extracts = {}, transits = {}, access = {}) {
  return {
    maps: maps.map((m) => {
      const bosses = [...new Set((m.bosses ?? []).filter((b) => b.boss).map((b) => b.boss.name))].sort();
      let summary = (m.description ?? "").trim();
      if (bosses.length) summary = (summary ? summary + " " : "") + "Boss: " + bosses.join(", ") + ".";
      const mid = m.normalizedName;
      return {
        id: mid,
        name: m.name,
        players: m.players || "?",
        duration: m.raidDuration || 0,
        levelRange: "any",
        beginnerFriendly: ["ground-zero", "customs", "woods"].includes(mid),
        summary,
        extracts: extracts[mid] ?? [],
        transits: transits[mid] ?? [],
        access: access[mid] ?? null,
      };
    }),
  };
}

export function transformItems(items) {
  const out = [];
  for (const i of items) {
    const types = i.types ?? [];
    if (types.includes("preset")) continue;
    const traderSell = Math.max(0, ...(i.sellFor ?? [])
      .filter((s) => s.vendor?.normalizedName !== "flea-market" && s.priceRUB)
      .map((s) => s.priceRUB));
    const avg = i.avg24hPrice || 0;
    out.push({
      id: i.id,
      name: i.name,
      category: i.category?.name || "Misc",
      slots: Math.max(1, (i.width || 1) * (i.height || 1)),
      avgPrice: avg || traderSell,
      fleaAvg: avg,
      change48h: i.changeLast48hPercent ?? null,
      traderSell,
      fleaBanned: types.includes("noFlea"),
    });
  }
  return { note: `Imported from tarkov.dev on ${todayISO()}.`, items: out };
}

export function transformHideout(stations) {
  const out = stations.map((s) => {
    const levels = [...(s.levels ?? [])].sort((a, b) => a.level - b.level).map((lv) => ({
      level: lv.level,
      buildTimeSeconds: lv.constructionTime || 0,
      items: (lv.itemRequirements ?? []).filter((r) => r.item)
        .map((r) => ({ item: r.item.id, count: r.count || 1 })),
      stations: (lv.stationLevelRequirements ?? []).filter((r) => r.station)
        .map((r) => ({ station: r.station.normalizedName, level: r.level })),
      traders: (lv.traderRequirements ?? []).filter((r) => r.trader)
        .map((r) => ({ trader: r.trader.normalizedName, level: r.level })),
      skills: (lv.skillRequirements ?? [])
        .map((r) => ({ name: r.name ?? "?", level: r.level ?? 0 })),
    }));
    return {
      id: s.normalizedName,
      name: s.name,
      maxLevel: Math.max(0, ...levels.map((lv) => lv.level)),
      levels,
    };
  });
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { note: `Imported from tarkov.dev on ${todayISO()}.`, stations: out };
}

export function transformCrafts(crafts) {
  return {
    note: `Imported from tarkov.dev on ${todayISO()}.`,
    crafts: crafts.filter((c) => c.station).map((c) => ({
      station: c.station.normalizedName,
      level: c.level || 1,
      durationSeconds: c.duration || 0,
      requires: (c.requiredItems ?? []).filter((r) => r.item).map((r) => ({ item: r.item.id, count: r.count || 1 })),
      produces: (c.rewardItems ?? []).filter((r) => r.item).map((r) => ({ item: r.item.id, count: r.count || 1 })),
    })),
  };
}

export function transformBarters(barters) {
  return {
    note: `Imported from tarkov.dev on ${todayISO()}.`,
    barters: barters.filter((b) => b.trader).map((b) => ({
      trader: b.trader.normalizedName,
      level: b.level || 1,
      requires: (b.requiredItems ?? []).filter((r) => r.item).map((r) => ({ item: r.item.id, count: r.count || 1 })),
      produces: (b.rewardItems ?? []).filter((r) => r.item).map((r) => ({ item: r.item.id, count: r.count || 1 })),
    })),
  };
}

export function prettyCaliber(raw) {
  if (!raw) return "Other";
  const c = raw.startsWith("Caliber") ? raw.slice("Caliber".length) : raw;
  let m = c.match(/^(\d+)x(\d+)(.*)$/);
  if (m) {
    let [, bore, kase, suffix] = m;
    if (bore.length === 4) bore = `${bore.slice(0, 2)}.${bore.slice(2)}`;
    else if (bore.length === 3) bore = bore[0] === "1" ? `${bore.slice(0, 2)}.${bore[2]}` : `${bore[0]}.${bore.slice(1)}`;
    else if (bore.length === 2 && ["46", "57", "68", "86"].includes(bore)) bore = `${bore[0]}.${bore[1]}`;
    suffix = suffix.replace(/(?<=[a-z])(?=[A-Z])/g, " ").trim();
    return `${bore}x${kase}${suffix ? " " + suffix : ""}`;
  }
  m = c.match(/^(\d+)g$/);
  if (m) return `${m[1]} Gauge`;
  return c;
}

export function transformAmmo(ammo) {
  const rounds = [];
  for (const a of ammo) {
    const item = a.item ?? {};
    if (!item.id) continue;
    rounds.push({
      id: item.id,
      name: item.shortName || item.name || "?",
      fullName: item.name || "?",
      caliber: prettyCaliber(a.caliber),
      type: a.ammoType || "bullet",
      damage: a.damage || 0,
      pen: a.penetrationPower || 0,
      armorDamage: a.armorDamage || 0,
      frag: pyRound((a.fragmentationChance || 0) * 100),
      velocity: pyRound(a.initialSpeed || 0),
      projectiles: a.projectileCount || 1,
      tracer: Boolean(a.tracer),
    });
  }
  rounds.sort((a, b) => (a.caliber < b.caliber ? -1 : a.caliber > b.caliber ? 1 : b.pen - a.pen));
  return { note: `Imported from tarkov.dev on ${todayISO()}.`, rounds };
}

/* ---------- storage + orchestration ---------- */

export const DATASET_PREFIX = "dataset:";

export async function storedManifest() {
  return (await kv.get(DATASET_PREFIX + "manifest")) ?? null;
}

/**
 * Run the full import: fetch everything, transform, store in IndexedDB.
 * `onProgress(message)` receives the same log lines the Python importer
 * prints. Returns the stored manifest. Core fetch failure throws; side
 * queries degrade exactly like the Python ladders.
 */
export async function runImport(onProgress = () => {}) {
  const log = onProgress;
  log("Fetching from api.tarkov.dev (this can take ~30s)...");
  const data = await gql(QUERY); // core — throws on failure, nothing stored

  const geoRaw = await ladder(GEO_QUERIES, log, "geo");
  const geo = geoRaw ? parseGeo(geoRaw.tasks) : {};
  if (geoRaw) log(`geo data: ${Object.keys(geo).length} tasks with per-objective map/position info`);

  const exRaw = await ladder(EXTRACTS_QUERIES, log, "extracts");
  const extracts = exRaw ? parseExtracts(exRaw.maps) : {};
  if (exRaw) log(`extracts data: ${Object.values(extracts).reduce((n, v) => n + v.length, 0)} extracts across ${Object.keys(extracts).length} maps`);

  const trRaw = await ladder(TRANSITS_QUERIES, log, "transits");
  const transits = trRaw ? parseTransits(trRaw.maps) : {};

  let access = {};
  try { access = parseMapAccess((await gql(ACCESS_QUERY)).maps); }
  catch (e) { log(`map access query failed (${String(e.message).slice(0, 80)}) — skipping access data`); }

  let achievements = [];
  try { achievements = parseAchievements((await gql(ACHIEVEMENTS_QUERY)).achievements); }
  catch (e) { log(`achievements query failed (${String(e.message).slice(0, 80)}) — skipping`); }

  const reqRaw = await ladder(TRADER_REQ_QUERIES, log, "trader-req");
  const traderReqs = reqRaw ? parseTraderReqs(reqRaw.tasks) : {};
  if (reqRaw) log(`trader standing requirements: ${Object.keys(traderReqs).length} quests gated`);

  const prRaw = await ladder(PRESTIGE_QUERIES, log, "prestige");
  const prestige = prRaw ? parsePrestige(prRaw.prestige) : [];
  if (prRaw) log(`prestige data: ${prestige.length} levels`);

  const outputs = {
    quests: transformQuests(data.tasks, geo, traderReqs),
    traders: transformTraders(data.traders),
    maps: transformMaps(data.maps, extracts, transits, access),
    items: transformItems(data.items),
    hideout: transformHideout(data.hideoutStations),
    ammo: transformAmmo(data.ammo),
    crafts: transformCrafts(data.crafts ?? []),
    barters: transformBarters(data.barters ?? []),
    achievements: { achievements },
    prestige: { note: `Imported from tarkov.dev on ${todayISO()}.`, prestige },
  };

  for (const [id, content] of Object.entries(outputs)) {
    await kv.set(DATASET_PREFIX + id, content);
    const count = Object.values(content).find(Array.isArray)?.length ?? 0;
    log(`stored ${id} (${count} records)`);
  }

  // ---- v0.9.7: story chapters + story gates -------------------------------
  // Different source (the wiki, not tarkov.dev), so it's fully independent
  // of everything above: a total failure here still leaves a complete,
  // working core import. Same reasoning as every other ladder in this file
  // — degrade a feature, never abort the run.
  let storylineOk = false;
  try {
    log("Fetching story chapters from the EFT Wiki (this takes ~15-30s)...");
    const storyline = await fetchStoryline(log);
    await kv.set(DATASET_PREFIX + "storyline", storyline);
    log(`stored storyline (${storyline.chapters.length} chapters)`);
    storylineOk = true;
  } catch (e) {
    log(`Story chapters unavailable (${e.message}) — Storyline page will be empty until you retry from Settings.`);
  }
  if (storylineOk) {
    try {
      const storyline = await kv.get(DATASET_PREFIX + "storyline");
      const storyGates = await fetchStoryGates(outputs.quests.quests, storyline.chapters, log);
      await kv.set(DATASET_PREFIX + "storyGates", storyGates);
      log(`stored storyGates (${Object.keys(storyGates.gates).length} gates)`);
    } catch (e) {
      log(`Story gates unavailable (${e.message}) — quests will show without wiki-only story gating.`);
    }
  }

  const manifestDatasets = Object.keys(outputs).map((id) => ({ id, file: `${id}.json` }));
  if (storylineOk) {
    manifestDatasets.push({ id: "storyline", file: "storyline.json" });
    if (await kv.get(DATASET_PREFIX + "storyGates")) manifestDatasets.push({ id: "storyGates", file: "storyGates.json" });
  }
  const manifest = {
    datasets: manifestDatasets,
    dataVersion: todayISO().replaceAll("-", "."),
    gameVersion: "live (tarkov.dev)",
    updatedAt: todayISO(),
    source: "browser",
  };
  await kv.set(DATASET_PREFIX + "manifest", manifest);
  log("Done. Datasets stored in this browser.");
  return manifest;
}
