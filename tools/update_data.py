#!/usr/bin/env python3
"""
update_data.py — regenerate data/*.json from the tarkov.dev GraphQL API.

Usage (from the project root, with internet):
    python tools/update_data.py

Writes: data/quests.json, data/items.json, data/traders.json,
        data/maps.json, and bumps data/manifest.json.
Existing files are backed up to data/backup/ first.

tarkov.dev is the community API that powers TarkovTracker, EFT Kappa,
and tarkov.dev itself, so this keeps the app current with every patch.
The app remains fully offline after the import completes.
"""
import json
import re
import shutil
import sys
import urllib.request
from datetime import date
from pathlib import Path

API = "https://api.tarkov.dev/graphql"

QUERY = """
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
}
"""
# Schema note: if the API ever returns GRAPHQL_VALIDATION_FAILED for a
# hideout field, the error names the exact field. Known alternates in the
# tarkov.dev schema: RequirementSkill also exposes `skill { name }`, and
# RequirementTrader also exposes `value` (same meaning as `level`).


def fetch():
    body = json.dumps({"query": QUERY}).encode()
    req = urllib.request.Request(
        API,
        data=body,
        headers={"Content-Type": "application/json",
                 "User-Agent": "tarkov-companion-importer/1.0"},
    )
    print("Fetching from api.tarkov.dev (this can take ~30s)...")
    with urllib.request.urlopen(req, timeout=120) as res:
        payload = json.load(res)
    if "errors" in payload:
        raise SystemExit(f"API returned errors: {payload['errors'][:2]}")
    return payload["data"]


# ---- v0.6: positional objective data (route optimizer) -------------------
# Fetched as a SEPARATE query with a fallback ladder: if the schema rejects
# the richest form, we retry simpler ones. Worst case the app just gets no
# coordinates — the core import above never depends on this.
GEO_QUERIES = [
    # richest: per-objective maps + zone positions
    """
    { tasks { id objectives { id maps { normalizedName }
      ... on TaskObjectiveBasic { zones { map { normalizedName } position { x y z } } }
      ... on TaskObjectiveQuestItem { possibleLocations { map { normalizedName } positions { x y z } } }
    } } }
    """,
    # middle: maps + QuestItem locations only
    """
    { tasks { id objectives { id maps { normalizedName }
      ... on TaskObjectiveQuestItem { possibleLocations { map { normalizedName } positions { x y z } } }
    } } }
    """,
    # minimal: per-objective maps only
    """
    { tasks { id objectives { id maps { normalizedName } } } }
    """,
]


def fetch_geo():
    """Return {taskId: {objectiveId: {maps: [...], positions: [...]}}} or {} on total failure."""
    for query in GEO_QUERIES:
        try:
            body = json.dumps({"query": query}).encode()
            req = urllib.request.Request(
                API, data=body,
                headers={"Content-Type": "application/json",
                         "User-Agent": "tarkov-companion-importer/1.0"})
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = json.load(res)
            if "errors" in payload:
                print(f"  geo query rejected ({payload['errors'][0].get('message', '?')[:80]}), trying simpler form...")
                continue
            out = {}
            for t in payload["data"]["tasks"]:
                objs = {}
                for o in t.get("objectives") or []:
                    maps = [m["normalizedName"] for m in (o.get("maps") or []) if m]
                    positions = []
                    for z in (o.get("zones") or []):
                        pos = z.get("position") or {}
                        if z.get("map"):
                            positions.append({"map": z["map"]["normalizedName"],
                                              "x": round(pos.get("x") or 0), "z": round(pos.get("z") or 0)})
                    for loc in (o.get("possibleLocations") or []):
                        mp = (loc.get("map") or {}).get("normalizedName")
                        for pos in (loc.get("positions") or [])[:3]:  # cap: some items have dozens of spawns
                            if mp:
                                positions.append({"map": mp, "x": round(pos.get("x") or 0), "z": round(pos.get("z") or 0)})
                    if maps or positions:
                        objs[o["id"]] = {"maps": maps, "positions": positions}
                if objs:
                    out[t["id"]] = objs
            print(f"  geo data: {len(out)} tasks with per-objective map/position info")
            return out
        except Exception as e:  # noqa: BLE001 — geo is best-effort by design
            print(f"  geo fetch failed ({e}), trying simpler form...")
    print("  no geo data available — Raid Planner falls back to quest-level maps")
    return {}


# ---- v0.8.2: extraction points (route optimizer) --------------------------
# Same fallback-ladder discipline as GEO_QUERIES: try richest, degrade on
# schema rejection, total failure just means no suggested extraction.
EXTRACTS_QUERIES = [
    # richest: name + faction lock + position + requirement info (confirmed
    # real fields via schema introspection: transferItem = the item you need
    # to carry to use this extract, e.g. ZB-1012's keyword item; switches =
    # in-world conditions like RUAF Roadblock's light)
    """
    { maps { normalizedName extracts { name faction position { x y z }
      transferItem { item { name } } switches { name } } } }
    """,
    # older schema shape: transferItem was a plain item with a name field
    """
    { maps { normalizedName extracts { name faction position { x y z } transferItem { name } } } }
    """,
    # drop faction + requirement info entirely
    """
    { maps { normalizedName extracts { name position { x y z } } } }
    """,
    # minimal: names only, no coordinates — still enough to list options
    """
    { maps { normalizedName extracts { name } } }
    """,
]


def _parse_extracts_payload(maps_data):
    """Pure parser, split out from fetch_extracts so it can be unit-tested
    against a mocked payload without a network call.
    Returns {mapNormalizedName: [{name, faction, x, z, requires?}]}.
    `requires` (a short human-readable string) is only present when the
    schema version exposed transferItem/switches AND this extract actually
    needs one -- most extracts have neither and stay unconditional.
    """
    out = {}
    for m in maps_data or []:
        mid = m.get("normalizedName")
        if not mid:
            continue
        exs = []
        for ex in (m.get("extracts") or []):
            pos = ex.get("position") or {}
            faction = (ex.get("faction") or "Any").upper()
            if faction not in ("BEAR", "USEC"):
                faction = "Any"
            entry = {
                "name": ex.get("name") or "?",
                "faction": faction,
                "x": round(pos.get("x") or 0),
                "z": round(pos.get("z") or 0),
            }
            reqs = []
            ti = ex.get("transferItem")
            # current schema: ContainedItem -> {item: {name}}; older: {name}
            tname = ((ti or {}).get("item") or {}).get("name") or (ti or {}).get("name")
            if tname:
                reqs.append(f"needs {tname}")
            for sw in (ex.get("switches") or []):
                if sw.get("name"):
                    reqs.append(f"requires {sw['name']}")
            if reqs:
                entry["requires"] = "; ".join(reqs)
            exs.append(entry)
        if exs:
            out[mid] = exs
    return out


def fetch_extracts():
    """Return {mapId: [{name, faction, x, z}]} or {} on total failure."""
    for query in EXTRACTS_QUERIES:
        try:
            body = json.dumps({"query": query}).encode()
            req = urllib.request.Request(
                API, data=body,
                headers={"Content-Type": "application/json",
                         "User-Agent": "tarkov-companion-importer/1.0"})
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = json.load(res)
            if "errors" in payload:
                print(f"  extracts query rejected ({payload['errors'][0].get('message', '?')[:80]}), trying simpler form...")
                continue
            out = _parse_extracts_payload(payload["data"]["maps"])
            print(f"  extracts data: {sum(len(v) for v in out.values())} extracts across {len(out)} maps")
            return out
        except Exception as e:  # noqa: BLE001 — extracts are best-effort by design
            print(f"  extracts fetch failed ({e}), trying simpler form...")
    print("  no extract data available — Route Optimizer will suggest no specific extraction")
    return {}


# Transits are a separate field from extracts on the tarkov.dev schema -- they
# represent map-to-map raid transitions (e.g. Customs -> Interchange) rather
# than a simple pickup point. It's unconfirmed whether this schema version
# exposes a position for them at all, so the ladder degrades from "hope they
# have coordinates" down to "just get the names/links," same discipline as
# EXTRACTS_QUERIES. Total failure just means those 4-5 markers stay unplaced.
TRANSITS_QUERIES = [
    # richest guess: position on the transit itself
    """
    { maps { normalizedName transits { description position { x y z } map { normalizedName } } } }
    """,
    # middle: no position, just description + target map
    """
    { maps { normalizedName transits { description map { normalizedName } } } }
    """,
    # minimal: target map only
    """
    { maps { normalizedName transits { map { normalizedName } } } }
    """,
]


def _parse_transits_payload(maps_data):
    """Pure parser, split out from fetch_transits so it can be unit-tested
    against a mocked payload without a network call.
    Returns {mapNormalizedName: [{name, targetMap, x, z}]} where x/z are
    omitted if the schema version didn't expose a position.
    """
    out = {}
    for m in maps_data or []:
        mid = m.get("normalizedName")
        if not mid:
            continue
        trs = []
        for tr in (m.get("transits") or []):
            target = (tr.get("map") or {}).get("normalizedName") or "?"
            pos = tr.get("position")
            entry = {
                "name": tr.get("description") or f"Transit to {target}",
                "targetMap": target,
            }
            if pos:
                entry["x"] = round(pos.get("x") or 0)
                entry["z"] = round(pos.get("z") or 0)
            trs.append(entry)
        if trs:
            out[mid] = trs
    return out


ACCESS_QUERY = """
{ maps { normalizedName minPlayerLevel maxPlayerLevel accessKeysMinPlayerLevel
  accessKeys { id name } } }
"""


ACHIEVEMENTS_QUERY = """
{ achievements { id name description hidden side rarity playersCompletedPercent } }
"""


def fetch_achievements():
    """Return [{id, name, description, hidden, side, rarity, completedPct}]
    or [] on any failure — never blocks the core import."""
    try:
        body = json.dumps({"query": ACHIEVEMENTS_QUERY}).encode()
        req = urllib.request.Request(
            API, data=body,
            headers={"Content-Type": "application/json",
                     "User-Agent": "tarkov-companion-importer/1.0"})
        with urllib.request.urlopen(req, timeout=120) as res:
            payload = json.load(res)
        if "errors" in payload:
            print(f"  achievements query rejected ({payload['errors'][0].get('message', '?')[:80]}) — skipping")
            return []
        return [{
            "id": a["id"],
            "name": a["name"],
            "description": a.get("description") or "",
            "hidden": bool(a.get("hidden")),
            "side": a.get("side") or "All",
            "rarity": a.get("rarity") or "Common",
            "completedPct": a.get("playersCompletedPercent"),
        } for a in payload["data"]["achievements"]]
    except Exception as e:  # noqa: BLE001
        print(f"  achievements fetch failed ({e}) — skipping")
        return []


# v0.9.12: prestige levels. New-ish fields (transferSettings union), so a
# fallback ladder like every other risky side query.
PRESTIGE_QUERIES = [
    """{ prestige {
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
    } }""",
    """{ prestige { id name prestigeLevel conditions { id type description } } }""",
    """{ prestige { id name prestigeLevel } }""",
]


def _parse_prestige(prestige):
    out = []
    for p in prestige or []:
        rewards = p.get("rewards") or {}
        out.append({
            "id": p["id"],
            "name": p.get("name") or f"Prestige {p.get('prestigeLevel', '?')}",
            "level": p.get("prestigeLevel") or 0,
            "imageLink": p.get("imageLink"),
            "conditions": [{
                "id": c.get("id"), "type": c.get("type") or "",
                "description": c.get("description") or "",
            } for c in (p.get("conditions") or []) if c],
            "rewards": {
                "items": [{"item": r["item"]["id"], "name": r["item"]["name"],
                           "count": r.get("count") or 1}
                          for r in (rewards.get("items") or []) if r.get("item")],
                "skills": [{"name": s.get("name") or "?", "level": s.get("level") or 0}
                           for s in (rewards.get("skillLevelReward") or [])],
                "customization": [{"id": c["id"], "name": c.get("name") or "?"}
                                  for c in (rewards.get("customization") or []) if c],
            },
            "transfer": [
                ({"kind": "stash", "gridWidth": t["gridWidth"],
                  "gridHeight": t.get("gridHeight")}
                 if t.get("gridWidth") is not None else
                 {"kind": "skill", "name": t.get("name") or "?",
                  "skillType": t.get("skillType") or "",
                  "rate": t.get("transferRate")})
                for t in (p.get("transferSettings") or []) if t],
        })
    out.sort(key=lambda x: x["level"])
    return out


def fetch_prestige():
    """Return the parsed prestige level list or [] — never blocks the core."""
    for query in PRESTIGE_QUERIES:
        try:
            body = json.dumps({"query": query}).encode()
            req = urllib.request.Request(
                API, data=body,
                headers={"Content-Type": "application/json",
                         "User-Agent": "tarkov-companion-importer/1.0"})
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = json.load(res)
            if "errors" in payload:
                print(f"  prestige query rejected ({payload['errors'][0].get('message', '?')[:80]}), trying simpler form...")
                continue
            return _parse_prestige(payload["data"]["prestige"])
        except Exception as e:  # noqa: BLE001
            print(f"  prestige fetch failed ({e}), trying simpler form...")
    print("  no prestige data available")
    return []


def fetch_map_access():
    """Return {mapId: {minLevel, maxLevel, accessKeys, accessKeysMinLevel}}
    or {} on any failure — core map import must never depend on this."""
    try:
        body = json.dumps({"query": ACCESS_QUERY}).encode()
        req = urllib.request.Request(
            API, data=body,
            headers={"Content-Type": "application/json",
                     "User-Agent": "tarkov-companion-importer/1.0"})
        with urllib.request.urlopen(req, timeout=120) as res:
            payload = json.load(res)
        if "errors" in payload:
            print(f"  map access query rejected ({payload['errors'][0].get('message', '?')[:80]}) — skipping access data")
            return {}
        out = {}
        for m in payload["data"]["maps"]:
            out[m["normalizedName"]] = {
                "minLevel": m.get("minPlayerLevel"),
                "maxLevel": m.get("maxPlayerLevel"),
                "accessKeys": [{"id": k["id"], "name": k["name"]}
                               for k in (m.get("accessKeys") or [])],
                "accessKeysMinLevel": m.get("accessKeysMinPlayerLevel"),
            }
        return out
    except Exception as e:  # noqa: BLE001 — resilience over precision here
        print(f"  map access fetch failed ({e}) — skipping access data")
        return {}


def fetch_transits():
    """Return {mapId: [{name, targetMap, x?, z?}]} or {} on total failure."""
    for query in TRANSITS_QUERIES:
        try:
            body = json.dumps({"query": query}).encode()
            req = urllib.request.Request(
                API, data=body,
                headers={"Content-Type": "application/json",
                         "User-Agent": "tarkov-companion-importer/1.0"})
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = json.load(res)
            if "errors" in payload:
                print(f"  transits query rejected ({payload['errors'][0].get('message', '?')[:80]}), trying simpler form...")
                continue
            out = _parse_transits_payload(payload["data"]["maps"])
            with_pos = sum(1 for v in out.values() for t in v if "x" in t)
            total = sum(len(v) for v in out.values())
            print(f"  transits data: {total} transits across {len(out)} maps ({with_pos} with position)")
            return out
        except Exception as e:  # noqa: BLE001 - transits are best-effort by design
            print(f"  transits fetch failed ({e}), trying simpler form...")
    print("  no transit data available - transit points will not appear in Route Optimizer")
    return {}


# ---- v0.8.27: per-quest trader standing requirements ----------------------
# Fence's quest chains gate on reputation (e.g. rep < 0), which lives on
# Task.traderRequirements. Separate query + ladder: core import never breaks.
TRADER_REQ_QUERIES = [
    """
    { tasks { id traderRequirements { trader { normalizedName } requirementType compareMethod value } } }
    """,
    # older schema: only deprecated level field
    """
    { tasks { id traderRequirements { trader { normalizedName } level } } }
    """,
]


def _parse_trader_reqs_payload(tasks_data):
    """Pure parser. Returns {taskId: [{trader, type, compare, value}]}.
    Only reputation/standing requirements are kept — loyaltyLevel gating is
    already covered by the trader loyalty UI, and keeping it here would
    double-lock quests. Unknown requirementType (older schema's bare
    `level`) is treated as loyaltyLevel and skipped."""
    out = {}
    for t in tasks_data or []:
        reqs = []
        for r in (t.get("traderRequirements") or []):
            rtype = r.get("requirementType") or "loyaltyLevel"
            if rtype not in ("reputation", "standing"):
                continue
            reqs.append({
                "trader": ((r.get("trader") or {}).get("normalizedName")) or "?",
                "type": "reputation",
                "compare": r.get("compareMethod") or ">=",
                "value": r.get("value") if r.get("value") is not None else 0,
            })
        if reqs:
            out[t["id"]] = reqs
    return out


def fetch_trader_reqs():
    """Return {taskId: [requirements]} or {} on total failure."""
    for query in TRADER_REQ_QUERIES:
        try:
            body = json.dumps({"query": query}).encode()
            req = urllib.request.Request(
                API, data=body,
                headers={"Content-Type": "application/json",
                         "User-Agent": "tarkov-companion-importer/1.0"})
            with urllib.request.urlopen(req, timeout=120) as res:
                payload = json.load(res)
            if "errors" in payload:
                print(f"  trader-req query rejected ({payload['errors'][0].get('message', '?')[:80]}), trying simpler form...")
                continue
            out = _parse_trader_reqs_payload(payload["data"]["tasks"])
            print(f"  trader standing requirements: {len(out)} quests gated")
            return out
        except Exception as e:  # noqa: BLE001 — best-effort by design
            print(f"  trader-req fetch failed ({e}), trying simpler form...")
    print("  no trader standing data — rep-gated quests (e.g. Fence chains) will show as normal")
    return {}


def transform_quests(tasks, geo=None, trader_reqs=None):
    geo = geo or {}
    trader_reqs = trader_reqs or {}
    quests = []
    for t in tasks:
        required = []
        objectives = []
        details = []
        task_geo = geo.get(t["id"], {})
        for o in t["objectives"]:
            if o.get("description"):
                objectives.append(o["description"])
            og = task_geo.get(o.get("id"), {})
            detail = {"description": o.get("description") or "", "type": o.get("type") or ""}
            if og.get("maps"):
                detail["maps"] = og["maps"]
            if og.get("positions"):
                detail["positions"] = og["positions"]
            details.append(detail)
            if o["type"] == "giveItem" and o.get("items"):
                required.append({
                    "item": o["items"][0]["id"],
                    "count": o.get("count", 1),
                    "foundInRaid": bool(o.get("foundInRaid")),
                })
        quests.append({
            "id": t["id"],
            "name": t["name"],
            "trader": t["trader"]["normalizedName"],
            "map": t["map"]["normalizedName"] if t.get("map") else "any",
            "minLevel": t.get("minPlayerLevel") or 1,
            "kappa": bool(t.get("kappaRequired")),
            "faction": t.get("factionName") or "Any",
            "prerequisites": [r["task"]["id"] for r in t.get("taskRequirements", []) if r.get("task")],
            "objectives": objectives,
            "objectiveDetails": details,
            "requiredItems": required,
            "wikiLink": t.get("wikiLink"),
            "neededKeys": sorted({k["id"] for nk in (t.get("neededKeys") or []) for k in (nk.get("keys") or [])}),
            "rewards": {"exp": t.get("experience") or 0},
        })
        if trader_reqs.get(t["id"]):
            quests[-1]["traderRequirements"] = trader_reqs[t["id"]]
    return {"note": f"Imported from tarkov.dev on {date.today().isoformat()}.", "quests": quests}


def transform_traders(traders):
    out = []
    for t in traders:
        reqs = [
            {"level": lv["level"], "playerLevel": lv["requiredPlayerLevel"],
             "reputation": lv["requiredReputation"], "spend": lv["requiredCommerce"]}
            for lv in t.get("levels", []) if lv["level"] > 1
        ]
        out.append({
            "id": t["normalizedName"],
            "name": t["name"],
            "currency": (t.get("currency") or {}).get("shortName") or "RUB",
            "loyaltyLevels": max((lv["level"] for lv in t.get("levels", [])), default=1),
            "specialty": "",
            "requirements": reqs,
        })
    return {"traders": out}


def transform_maps(maps, extracts=None, transits=None, access=None):
    extracts = extracts or {}
    transits = transits or {}
    access = access or {}
    out = []
    for m in maps:
        bosses = sorted({b["boss"]["name"] for b in m.get("bosses", []) if b.get("boss")})
        summary = (m.get("description") or "").strip()
        if bosses:
            summary = (summary + " " if summary else "") + "Boss: " + ", ".join(bosses) + "."
        mid = m["normalizedName"]
        out.append({
            "id": mid,
            "name": m["name"],
            "players": m.get("players") or "?",
            "duration": m.get("raidDuration") or 0,
            "levelRange": "any",
            "beginnerFriendly": mid in ("ground-zero", "customs", "woods"),
            "summary": summary,
            "extracts": extracts.get(mid, []),
            "transits": transits.get(mid, []),
            "access": access.get(mid),  # null when the access query failed
        })
    return {"maps": out}


def transform_items(items):
    out = []
    for i in items:
        types = i.get("types") or []
        if "preset" in types:  # skip weapon presets; base items are enough
            continue
        trader_sell = max(
            (s["priceRUB"] for s in i.get("sellFor", [])
             if s.get("vendor", {}).get("normalizedName") != "flea-market" and s.get("priceRUB")),
            default=0,
        )
        avg = i.get("avg24hPrice") or 0
        out.append({
            "id": i["id"],
            "name": i["name"],
            "category": (i.get("category") or {}).get("name") or "Misc",
            "slots": max(1, (i.get("width") or 1) * (i.get("height") or 1)),
            "avgPrice": avg if avg else trader_sell,
            "fleaAvg": avg,  # 0 = no flea data; NOT trader fallback (unlike avgPrice)
            "change48h": i.get("changeLast48hPercent"),
            "traderSell": trader_sell,
            "fleaBanned": "noFlea" in types,
        })
    return {"note": f"Imported from tarkov.dev on {date.today().isoformat()}.", "items": out}


def transform_hideout(stations):
    """Shape tarkov.dev hideoutStations into data/hideout.json.

    Station ids are normalizedName (stable, human-readable) — these are the
    keys stored in profile.hideout, so they must never change format.
    """
    out = []
    for s in stations:
        levels = []
        for lv in sorted(s.get("levels", []), key=lambda x: x["level"]):
            levels.append({
                "level": lv["level"],
                "buildTimeSeconds": lv.get("constructionTime") or 0,
                "items": [
                    {"item": r["item"]["id"], "count": r.get("count") or 1}
                    for r in lv.get("itemRequirements", []) if r.get("item")
                ],
                "stations": [
                    {"station": r["station"]["normalizedName"], "level": r["level"]}
                    for r in lv.get("stationLevelRequirements", []) if r.get("station")
                ],
                "traders": [
                    {"trader": r["trader"]["normalizedName"], "level": r["level"]}
                    for r in lv.get("traderRequirements", []) if r.get("trader")
                ],
                "skills": [
                    {"name": r.get("name") or "?", "level": r.get("level") or 0}
                    for r in lv.get("skillRequirements", [])
                ],
            })
        out.append({
            "id": s["normalizedName"],
            "name": s["name"],
            "maxLevel": max((lv["level"] for lv in levels), default=0),
            "levels": levels,
        })
    out.sort(key=lambda s: s["name"])
    return {"note": f"Imported from tarkov.dev on {date.today().isoformat()}.", "stations": out}


def transform_crafts(crafts):
    out = []
    for c in crafts:
        if not c.get("station"):
            continue
        out.append({
            "station": c["station"]["normalizedName"],
            "level": c.get("level") or 1,
            "durationSeconds": c.get("duration") or 0,
            "requires": [{"item": r["item"]["id"], "count": r.get("count") or 1}
                         for r in c.get("requiredItems", []) if r.get("item")],
            "produces": [{"item": r["item"]["id"], "count": r.get("count") or 1}
                         for r in c.get("rewardItems", []) if r.get("item")],
        })
    return {"note": f"Imported from tarkov.dev on {date.today().isoformat()}.", "crafts": out}


def transform_barters(barters):
    out = []
    for b in barters:
        if not b.get("trader"):
            continue
        out.append({
            "trader": b["trader"]["normalizedName"],
            "level": b.get("level") or 1,
            "requires": [{"item": r["item"]["id"], "count": r.get("count") or 1}
                         for r in b.get("requiredItems", []) if r.get("item")],
            "produces": [{"item": r["item"]["id"], "count": r.get("count") or 1}
                         for r in b.get("rewardItems", []) if r.get("item")],
        })
    return {"note": f"Imported from tarkov.dev on {date.today().isoformat()}.", "barters": out}


def pretty_caliber(raw):
    """'Caliber556x45NATO' -> '5.56x45 NATO', 'Caliber12g' -> '12 Gauge'."""
    if not raw:
        return "Other"
    c = raw.removeprefix("Caliber")
    m = re.match(r"^(\d+)x(\d+)(.*)$", c)
    if m:
        bore, case, suffix = m.groups()
        if len(bore) == 4:
            bore = f"{bore[:2]}.{bore[2:]}"       # 1143 -> 11.43
        elif len(bore) == 3:
            # 127 -> 12.7 but 556 -> 5.56: bores over ~10mm start with 1
            bore = f"{bore[:2]}.{bore[2]}" if bore[0] == "1" else f"{bore[0]}.{bore[1:]}"
        elif len(bore) == 2 and bore in ("46", "57", "68", "86"):
            bore = f"{bore[0]}.{bore[1]}"         # 4.6, 5.7, 6.8, 8.6mm cartridges; 23x75 etc stay
        suffix = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", suffix).strip()
        return f"{bore}x{case}{' ' + suffix if suffix else ''}"
    m = re.match(r"^(\d+)g$", c)
    if m:
        return f"{m.group(1)} Gauge"
    return c


def transform_ammo(ammo):
    """Shape tarkov.dev ammo into data/ammo.json, grouped-ready by caliber."""
    rounds = []
    for a in ammo:
        item = a.get("item") or {}
        if not item.get("id"):
            continue
        rounds.append({
            "id": item["id"],
            "name": item.get("shortName") or item.get("name") or "?",
            "fullName": item.get("name") or "?",
            "caliber": pretty_caliber(a.get("caliber")),
            "type": a.get("ammoType") or "bullet",
            "damage": a.get("damage") or 0,
            "pen": a.get("penetrationPower") or 0,
            "armorDamage": a.get("armorDamage") or 0,
            "frag": round((a.get("fragmentationChance") or 0) * 100),
            "velocity": round(a.get("initialSpeed") or 0),
            "projectiles": a.get("projectileCount") or 1,
            "tracer": bool(a.get("tracer")),
        })
    rounds.sort(key=lambda r: (r["caliber"], -r["pen"]))
    return {"note": f"Imported from tarkov.dev on {date.today().isoformat()}.", "rounds": rounds}


def main():
    root = Path(__file__).resolve().parent.parent
    data_dir = root / "data"
    if not data_dir.is_dir():
        raise SystemExit("Run this from the project (data/ folder not found).")

    data = fetch()
    geo = fetch_geo()
    extracts = fetch_extracts()
    transits = fetch_transits()
    map_access = fetch_map_access()
    achievements = fetch_achievements()
    prestige = fetch_prestige()
    trader_reqs = fetch_trader_reqs()

    backup = data_dir / "backup"
    backup.mkdir(exist_ok=True)
    for name in ("quests.json", "items.json", "traders.json", "maps.json", "hideout.json", "ammo.json", "crafts.json", "barters.json", "achievements.json", "prestige.json", "storyline.json", "storyGates.json", "manifest.json"):
        src = data_dir / name
        if src.exists():
            shutil.copy2(src, backup / name)

    outputs = {
        "quests.json": transform_quests(data["tasks"], geo, trader_reqs),
        "traders.json": transform_traders(data["traders"]),
        "maps.json": transform_maps(data["maps"], extracts, transits, map_access),
        "items.json": transform_items(data["items"]),
        "hideout.json": transform_hideout(data["hideoutStations"]),
        "ammo.json": transform_ammo(data["ammo"]),
        "crafts.json": transform_crafts(data.get("crafts") or []),
        "barters.json": transform_barters(data.get("barters") or []),
        "achievements.json": {"achievements": achievements},
        "prestige.json": {"note": f"Imported from tarkov.dev on {date.today().isoformat()}.", "prestige": prestige},
    }
    for name, content in outputs.items():
        (data_dir / name).write_text(json.dumps(content, indent=1, ensure_ascii=False))
        count = len(next(v for v in content.values() if isinstance(v, list)))
        print(f"  wrote data/{name} ({count} records)")

    manifest = json.loads((data_dir / "manifest.json").read_text())
    # Defensive: users sometimes keep an older data/ folder. Make sure every
    # dataset we just wrote is declared, or the app will never load it.
    declared = {d["id"] for d in manifest["datasets"]}
    for ds_id, ds_file in ((n.rsplit(".", 1)[0], n) for n in outputs):
        if ds_id not in declared:
            manifest["datasets"].append({"id": ds_id, "file": ds_file})
            print(f"  added \"{ds_id}\" to manifest datasets")
    manifest["dataVersion"] = date.today().strftime("%Y.%m.%d")
    manifest["gameVersion"] = "live (tarkov.dev)"
    manifest["updatedAt"] = date.today().isoformat()
    (data_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("  bumped data/manifest.json")
    print("\nDone. Restart the server / refresh the app. Old files are in data/backup/.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as e:
        sys.exit(f"Network error reaching api.tarkov.dev: {e}\nCheck your connection and retry.")
