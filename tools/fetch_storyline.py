#!/usr/bin/env python3
"""fetch_storyline.py — import the 1.0 story chapters from the EFT Wiki.

The story chapters (Tour, Falling Skies, ...) exist in NO game-data API —
confirmed directly against tarkov.dev (tasks and achievements probed).
The community wiki is the only structured source, and it exposes the
standard MediaWiki API, so this stays a programmatic, re-runnable import
rather than hand-authored data.

Usage (from the project root, on the phone):
    python3 tools/fetch_storyline.py

Writes data/storyline.json and registers it in data/manifest.json.
Content license: the wiki is CC BY-NC-SA — attribution is written into
the dataset and rendered by the app. Do not strip it.

Resilience: any single chapter page failing to parse produces a chapter
entry with empty objectives and a note, never a crashed import. Requests
are spaced ~1s apart to be polite to Fandom.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

WIKI_API = "https://escapefromtarkov.fandom.com/api.php"
CATEGORY = "Category:Story_chapters"
UA = ("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Mobile Safari/537.36 tarkov-companion-storyline/1.0")
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "storyline.json"
MANIFEST = ROOT / "data" / "manifest.json"


def api(params):
    params = dict(params, format="json")
    url = WIKI_API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.load(res)


class ObjectiveExtractor(HTMLParser):
    """Pull the <li> texts of the section that follows the 'Objectives'
    heading in rendered wiki HTML, stopping at the next h2."""

    def __init__(self):
        super().__init__()
        self.in_target = False
        self.done = False
        self.in_li = 0
        self.buf = []
        self.objectives = []
        self._pending_heading = False
        self._heading_text = ""

    def handle_starttag(self, tag, attrs):
        if tag == "h2":
            if self.in_target:
                self.done = True
            self._pending_heading = True
            self._heading_text = ""
        if self.done:
            return
        if self.in_target and tag == "li":
            if self.in_li == 0:
                self.buf = []
            self.in_li += 1

    def handle_endtag(self, tag):
        if tag == "h2" and self._pending_heading:
            self._pending_heading = False
            if "objectives" in self._heading_text.lower():
                self.in_target = True
        if self.done:
            return
        if self.in_target and tag == "li" and self.in_li:
            self.in_li -= 1
            if self.in_li == 0:
                text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
                text = re.sub(r"\[edit.*?\]", "", text).strip()
                if text:
                    self.objectives.append(text)

    def handle_data(self, data):
        if self._pending_heading:
            self._heading_text += data
        if self.in_target and self.in_li and not self.done:
            self.buf.append(data)


def slug(title):
    t = re.sub(r"\s*\(story chapter\)\s*", "", title, flags=re.I)
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-"), t


def main():
    print("Fetching chapter list from the EFT Wiki...")
    members = api({
        "action": "query", "list": "categorymembers",
        "cmtitle": CATEGORY, "cmlimit": "50", "cmnamespace": "0",
    })["query"]["categorymembers"]
    titles = [m["title"] for m in members
              if m["title"].lower() != "story chapters"]  # the category's own index page
    print(f"  {len(titles)} chapters: {', '.join(titles)}")

    chapters = []
    for title in titles:
        time.sleep(1.0)
        cid, name = slug(title)
        entry = {
            "id": cid, "name": name,
            "wikiUrl": "https://escapefromtarkov.fandom.com/wiki/"
                       + urllib.parse.quote(title.replace(" ", "_")),
            "objectives": [],
        }
        try:
            html = api({"action": "parse", "page": title,
                        "prop": "text", "redirects": "1"})["parse"]["text"]["*"]
            ex = ObjectiveExtractor()
            ex.feed(html)
            entry["objectives"] = ex.objectives
            if not ex.objectives:
                entry["note"] = "No objectives section found on the wiki page."
            print(f"  {name}: {len(ex.objectives)} objectives")
        except Exception as e:  # noqa: BLE001 — one bad page never kills the run
            entry["note"] = f"Fetch/parse failed: {e}"
            print(f"  {name}: FAILED ({e})")
        chapters.append(entry)

    from datetime import date
    OUT.write_text(json.dumps({
        "note": f"Imported from the Escape from Tarkov Wiki on {date.today()}.",
        "attribution": {
            "source": "Escape from Tarkov Wiki (Fandom community)",
            "url": "https://escapefromtarkov.fandom.com/wiki/Story_chapters",
            "license": "CC BY-NC-SA",
            "licenseUrl": "https://www.fandom.com/licensing",
            "doNotRemove": "Attribution is a license requirement.",
        },
        "chapters": chapters,
    }, indent=1))
    print(f"\nWrote {OUT.relative_to(ROOT)}")

    manifest = json.loads(MANIFEST.read_text())
    if not any(d["id"] == "storyline" for d in manifest["datasets"]):
        manifest["datasets"].append({"id": "storyline", "file": "storyline.json"})
        MANIFEST.write_text(json.dumps(manifest, indent=1))
        print("Registered 'storyline' dataset in manifest.json")
    print("Done — reload the app.")


if __name__ == "__main__":
    main()
