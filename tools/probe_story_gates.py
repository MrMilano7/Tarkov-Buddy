#!/usr/bin/env python3
"""probe_story_gates.py — EXPERIMENT: scrape quest wiki pages for the
story-chapter requirements that tarkov.dev doesn't publish.

Background: the API claims quests like Icebreaker's "Oil Change" have no
prerequisites, but the wiki's Requirements sections state gates like
"progress through the story chapter Falling Skies". This probe fetches
those sections and REPORTS what it finds — it writes nothing, changes
nothing. If the output looks reliable, integration comes as a separate
step.

Usage (from the project root, on the phone, AFTER re-running
update_data.py so quests carry wikiLink):

    python3 tools/probe_story_gates.py                  # icebreaker quests
    python3 tools/probe_story_gates.py --map terminal   # another map
    python3 tools/probe_story_gates.py --all --limit 40 # broad sample

Requests are spaced ~1s apart to be polite to Fandom.
"""
import argparse
import json
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

WIKI_API = "https://escapefromtarkov.fandom.com/api.php"
UA = ("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Mobile Safari/537.36 tarkov-companion-probe/1.0")
ROOT = Path(__file__).resolve().parent.parent

# Chapter names as imported by fetch_storyline.py, if present; else a
# fallback list. Used only to highlight matches in the report.
def chapter_names():
    try:
        data = json.loads((ROOT / "data" / "storyline.json").read_text())
        return [c["name"] for c in data["chapters"]]
    except Exception:  # noqa: BLE001
        return ["Tour", "Falling Skies", "Boreas", "The Unheard",
                "They Are Already Here", "The Ticket", "The Labyrinth",
                "Accidental Witness", "Batya", "Blue Fire"]


class SectionExtractor(HTMLParser):
    """Collect the text lines (<li> and <p>) of the section following a
    given h2 headline, stopping at the next h2."""

    def __init__(self, section):
        super().__init__()
        self.section = section.lower()
        self.in_target = False
        self.done = False
        self.depth = 0
        self.buf = []
        self.lines = []
        self._pending_h2 = False
        self._h2_text = ""

    def handle_starttag(self, tag, attrs):
        if tag == "h2":
            if self.in_target:
                self.done = True
            self._pending_h2 = True
            self._h2_text = ""
        if self.done:
            return
        if self.in_target and tag in ("li", "p"):
            if self.depth == 0:
                self.buf = []
            self.depth += 1

    def handle_endtag(self, tag):
        if tag == "h2" and self._pending_h2:
            self._pending_h2 = False
            if self.section in self._h2_text.lower():
                self.in_target = True
        if self.done:
            return
        if self.in_target and tag in ("li", "p") and self.depth:
            self.depth -= 1
            if self.depth == 0:
                text = re.sub(r"\s+", " ", "".join(self.buf)).strip()
                text = re.sub(r"\[edit.*?\]", "", text).strip()
                if text:
                    self.lines.append(text)

    def handle_data(self, data):
        if self._pending_h2:
            self._h2_text += data
        if self.in_target and self.depth and not self.done:
            self.buf.append(data)


def fetch_section(page_title, section="requirements"):
    params = urllib.parse.urlencode({
        "action": "parse", "page": page_title, "prop": "text",
        "redirects": "1", "format": "json"})
    req = urllib.request.Request(WIKI_API + "?" + params,
                                 headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as res:
        payload = json.load(res)
    if "error" in payload:
        raise RuntimeError(payload["error"].get("info", "wiki error"))
    ex = SectionExtractor(section)
    ex.feed(payload["parse"]["text"]["*"])
    return ex.lines


def title_from_wikilink(url):
    return urllib.parse.unquote(url.rsplit("/wiki/", 1)[-1]).replace("_", " ")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default="icebreaker")
    ap.add_argument("--all", action="store_true", help="ignore --map, sample all quests")
    ap.add_argument("--limit", type=int, default=15)
    args = ap.parse_args()

    quests = json.loads((ROOT / "data" / "quests.json").read_text())["quests"]
    if not args.all:
        quests = [q for q in quests if q.get("map") == args.map]
    quests = quests[: args.limit]
    if not quests:
        print(f"No quests found for map '{args.map}'.")
        return
    missing = [q["name"] for q in quests if not q.get("wikiLink")]
    if missing:
        print(f"NOTE: {len(missing)} quest(s) have no wikiLink — re-run "
              f"tools/update_data.py first. Skipping: {', '.join(missing[:5])}")
    quests = [q for q in quests if q.get("wikiLink")]

    chapters = chapter_names()
    print(f"Probing Requirements sections for {len(quests)} quest(s)...\n")
    gated, ungated, failed = 0, 0, 0
    for q in quests:
        time.sleep(1.0)
        title = title_from_wikilink(q["wikiLink"])
        try:
            lines = fetch_section(title)
        except Exception as e:  # noqa: BLE001
            print(f"[FAIL] {q['name']}: {e}")
            failed += 1
            continue
        hits = [ln for ln in lines
                if "story chapter" in ln.lower()
                or any(c.lower() in ln.lower() for c in chapters)]
        api_prereqs = len(q.get("prerequisites") or [])
        if hits:
            gated += 1
            print(f"[GATE] {q['name']} (API prereqs: {api_prereqs})")
            for h in hits:
                print(f"         wiki: {h}")
        else:
            ungated += 1
            tag = "no Requirements section" if not lines else f"{len(lines)} requirement line(s), no chapter mention"
            print(f"[  ok] {q['name']} (API prereqs: {api_prereqs}; {tag})")

    print(f"\nSummary: {gated} story-gated, {ungated} not, {failed} failed "
          f"— out of {len(quests)} probed.")
    print("Nothing was written. If the [GATE] lines look right, the next "
          "step is folding them into quest lock state.")


if __name__ == "__main__":
    main()
