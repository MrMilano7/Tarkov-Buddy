#!/usr/bin/env python3
"""register_maps.py — register reference map images for the Maps page.

Usage (from the project root, in Termux):
    1. Download a map image into assets/maps/reference/, named after the
       map's id, e.g.:
         cd assets/maps/reference
         curl -L -o interchange.jpg "https://www.re3mr.com/maps/Interchange/re3mrInterchange.jpg"
    2. python3 tools/register_maps.py
    3. Reload the app. The image appears on that map's card.

The script scans assets/maps/reference/ and writes reference.json next to
it. Filenames must match map ids from data/maps.json (the script prints
the valid ids). Attribution is written into the manifest and rendered by
the app under every image — RE3MR's maps are CC BY-NC-SA 4.0, which
requires credit, a license link, and noting changes. Don't strip it.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = ROOT / "assets" / "maps" / "reference"
OUT = ROOT / "assets" / "maps" / "reference.json"
EXTS = {".jpg", ".jpeg", ".png", ".webp"}

ATTRIBUTION = {
    "author": "RE3MR",
    "url": "https://reemr.se",
    "license": "CC BY-NC-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    "note": "3D community maps by RE3MR, used unmodified. "
            "Attribution required — do not remove.",
}


def known_map_ids():
    try:
        data = json.loads((ROOT / "data" / "maps.json").read_text())
        return sorted(m["id"] for m in data.get("maps", []))
    except (OSError, json.JSONDecodeError, KeyError):
        return []


def main():
    REF_DIR.mkdir(parents=True, exist_ok=True)
    ids = known_map_ids()
    found, unknown = {}, []
    for f in sorted(REF_DIR.iterdir()):
        if f.suffix.lower() not in EXTS:
            continue
        map_id = f.stem.lower()
        entry = {"file": f"reference/{f.name}", "sizeMB": round(f.stat().st_size / 1e6, 1)}
        if ids and map_id not in ids:
            unknown.append(f.name)
        found[map_id] = entry

    OUT.write_text(json.dumps(
        {"attribution": ATTRIBUTION, "maps": found}, indent=1))
    print(f"Registered {len(found)} reference map(s) -> {OUT.relative_to(ROOT)}")
    for mid, e in found.items():
        print(f"  {mid}: {e['file']} ({e['sizeMB']} MB)")
    if unknown:
        print("\nWARNING — these filenames don't match any map id, so the app")
        print("won't attach them to a map card:")
        for n in unknown:
            print(f"  {n}")
    if ids:
        print("\nValid map ids:", ", ".join(ids))
    else:
        print("\n(data/maps.json not found — couldn't validate ids)")


if __name__ == "__main__":
    main()
