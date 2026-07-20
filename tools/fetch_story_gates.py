#!/usr/bin/env python3
"""fetch_story_gates.py — import story-chapter quest gates from the wiki.

The tarkov.dev API publishes some quests (e.g. Icebreaker's chain
starters) with zero prerequisites, but their wiki Requirements sections
state real story gates like "Hand over the hard drives from compartment
C-1 on Icebreaker to Mechanic in the Boreas story chapter." Validated by
tools/probe_story_gates.py before this tool existed: 4 clean gates, 0
parse failures.

Scope: only quests with ZERO API prerequisites are scraped (chain
starters — descendants inherit the gate through normal prerequisites),
keeping the run to ~1 minute instead of ~9. Use --all to scrape every
quest with a wikiLink.

For each gated quest this writes, when possible, the exact chapter
OBJECTIVE the requirement refers to (fuzzy-matched against
data/storyline.json), so the app can unlock the quest the moment that
objective is ticked on the Storyline page. When no objective matches,
the gate falls back to full-chapter completion.

Usage:  python3 tools/fetch_story_gates.py        (run fetch_storyline.py first)
Writes: data/storyGates.json (+ manifest registration)
"""
import argparse
import json
import re
import time
import urllib.parse
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from probe_story_gates import fetch_section, title_from_wikilink  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "storyGates.json"
MANIFEST = ROOT / "data" / "manifest.json"


def norm(s):
    return re.sub(r"[^a-z0-9 ]", "", s.lower())


def load_chapters():
    try:
        return json.loads((ROOT / "data" / "storyline.json").read_text())["chapters"]
    except Exception:  # noqa: BLE001
        return []


def match_gate(line, chapters):
    """Return (chapterId, objectiveIndex|None) if the line names a chapter."""
    low = line.lower()
    for ch in chapters:
        if ch["name"].lower() in low:
            # fuzzy objective match: best overlap of significant words
            words = set(norm(line).split())
            best, best_score = None, 0.0
            for idx, obj in enumerate(ch.get("objectives", [])):
                ow = set(norm(obj).split())
                if not ow:
                    continue
                score = len(words & ow) / len(ow)
                if score > best_score:
                    best, best_score = idx, score
            return ch["id"], (best if best_score >= 0.6 else None)
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true",
                    help="scrape every quest with a wikiLink (slow, ~9 min)")
    args = ap.parse_args()

    quests = json.loads((ROOT / "data" / "quests.json").read_text())["quests"]
    chapters = load_chapters()
    if not chapters:
        print("WARNING: data/storyline.json missing — run tools/fetch_storyline.py "
              "first for objective-level gates. Falling back to name matching only.")
    targets = [q for q in quests if q.get("wikiLink")
               and (args.all or not (q.get("prerequisites") or []))]
    print(f"Scraping Requirements for {len(targets)} chain-starter quest(s)...")

    gates, failed = {}, 0
    page_cache = {}  # several quests can share one wikiLink; fetch each page once
    for q in targets:
        title = title_from_wikilink(q["wikiLink"])
        if title not in page_cache:
            time.sleep(1.0)
            try:
                page_cache[title] = fetch_section(title)
            except Exception as e:  # noqa: BLE001
                page_cache[title] = e
        lines = page_cache[title]
        if isinstance(lines, Exception):
            failed += 1
            print(f"  FAIL {q['name']}: {lines}")
            continue
        for ln in lines:
            chap, obj_idx = match_gate(ln, chapters)
            if chap:
                gates[q["id"]] = {"chapterId": chap, "objectiveIndex": obj_idx,
                                  "requirement": ln}
                tag = f"objective #{obj_idx + 1}" if obj_idx is not None else "full chapter"
                print(f"  GATE {q['name']} -> {chap} ({tag})")
                break

    from datetime import date
    OUT.write_text(json.dumps({
        "note": f"Story gates from the Escape from Tarkov Wiki on {date.today()}.",
        "attribution": {
            "source": "Escape from Tarkov Wiki (Fandom community)",
            "url": "https://escapefromtarkov.fandom.com/wiki/Story_chapters",
            "license": "CC BY-NC-SA",
            "licenseUrl": "https://www.fandom.com/licensing",
        },
        "gates": gates,
    }, indent=1))
    print(f"\nWrote {OUT.relative_to(ROOT)}: {len(gates)} gate(s), {failed} failed.")

    manifest = json.loads(MANIFEST.read_text())
    if not any(d["id"] == "storyGates" for d in manifest["datasets"]):
        manifest["datasets"].append({"id": "storyGates", "file": "storyGates.json"})
        MANIFEST.write_text(json.dumps(manifest, indent=1))
        print("Registered 'storyGates' dataset in manifest.json")
    print("Done — reload the app.")


if __name__ == "__main__":
    main()
