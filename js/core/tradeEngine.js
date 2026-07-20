/**
 * tradeEngine.js — crafts & barters logic (DOM-free).
 *
 * Enriches data/crafts.json and data/barters.json with item names and the
 * price data already present in data/items.json, and computes an *estimated*
 * margin per trade. Honesty notes, because prices are the one soft spot:
 *  - items.avgPrice is the flea 24h average at import time; for flea-banned
 *    items the importer already fell back to best trader sell. We label all
 *    money as "est." and surface the import date, never pretend it's live.
 *  - Input cost = sum of avgPrice (what you'd roughly pay to acquire).
 *  - Output value = traderSell if flea-banned, else max(avgPrice, traderSell)
 *    (you'd sell wherever it's higher; flea fee is NOT modeled — noted in UI).
 * Availability is computed from the real profile: hideout station levels for
 * crafts, trader loyalty levels for barters.
 */
import { get } from "./dataLoader.js";

function itemIndex() {
  const map = new Map();
  for (const i of get("items")?.items ?? []) map.set(i.id, i);
  return map;
}

function lineValue(entries, items, mode) {
  // mode: "cost" (acquiring inputs) | "value" (selling outputs)
  let total = 0;
  let unknown = 0;
  const lines = entries.map((e) => {
    const it = items.get(e.item);
    if (!it) {
      unknown++;
      return { id: e.item, name: e.item, count: e.count, each: 0 };
    }
    const each =
      mode === "cost"
        ? it.avgPrice
        : it.fleaBanned
          ? it.traderSell
          : Math.max(it.avgPrice, it.traderSell);
    total += each * e.count;
    return { id: e.item, name: it.name, count: e.count, each };
  });
  return { lines, total, unknown };
}

/** "3h 20m" style duration. */
export function fmtDuration(seconds) {
  if (!seconds) return "instant";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/**
 * All crafts, enriched. `profile` gates availability via profile.hideout
 * (moduleId -> built level).
 */
export function enrichedCrafts(profile) {
  const items = itemIndex();
  const built = profile?.hideout ?? {};
  return (get("crafts")?.crafts ?? []).map((c) => {
    const requires = lineValue(c.requires, items, "cost");
    const produces = lineValue(c.produces, items, "value");
    return {
      kind: "craft",
      source: c.station,
      sourceLabel: c.station.replace(/-/g, " "),
      level: c.level,
      durationSeconds: c.durationSeconds,
      requires: requires.lines,
      produces: produces.lines,
      cost: requires.total,
      value: produces.total,
      margin: produces.total - requires.total,
      priceGaps: requires.unknown + produces.unknown,
      available: (built[c.station] ?? 0) >= c.level,
    };
  });
}

/**
 * All barters, enriched. `profile` gates availability via
 * profile.traderLevels (traderId -> loyalty level).
 */
export function enrichedBarters(profile) {
  const items = itemIndex();
  const loyalty = profile?.traderLevels ?? {};
  return (get("barters")?.barters ?? []).map((b) => {
    const requires = lineValue(b.requires, items, "cost");
    const produces = lineValue(b.produces, items, "value");
    return {
      kind: "barter",
      source: b.trader,
      sourceLabel: b.trader.replace(/-/g, " "),
      level: b.level,
      durationSeconds: 0,
      requires: requires.lines,
      produces: produces.lines,
      cost: requires.total,
      value: produces.total,
      margin: produces.total - requires.total,
      priceGaps: requires.unknown + produces.unknown,
      available: (loyalty[b.trader] ?? 1) >= b.level,
    };
  });
}

/** The import-date note from whichever dataset is present. */
export function priceDataNote() {
  return get("crafts")?.note || get("barters")?.note || "";
}
