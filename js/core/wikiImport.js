/**
 * wikiImport.js — in-browser story-chapter + story-gate importer (v0.9.7).
 *
 * A faithful port of tools/fetch_storyline.py and tools/fetch_story_gates.py
 * (which itself reuses tools/probe_story_gates.py's section extractor).
 * Same MediaWiki API calls, same objectives/requirements section parsing,
 * same fuzzy chapter-objective matching, same politeness delay. Verified
 * by a parity test: identical HTML fixtures fed through this tokenizer
 * and through Python's html.parser, diffed — IDENTICAL.
 *
 * Deliberately NOT DOM-based (no DOMParser): a small regex tag tokenizer
 * mirrors Python's html.parser token stream instead, which is what makes
 * a real apples-to-apples parity test possible (both sides walk the same
 * start/end/data event sequence) and keeps this file runnable in a plain
 * Node parity harness with zero browser dependency.
 *
 * Content license: the wiki is CC BY-NC-SA — attribution travels with
 * the stored dataset and is rendered by the Storyline page. Do not strip it.
 * Resilience: one chapter or one quest's page failing never aborts the
 * run — it gets a note field instead (same as the Python tool).
 */
const WIKI_API = "https://escapefromtarkov.fandom.com/api.php";
const CATEGORY = "Category:Story_chapters";

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const ATTRIBUTION = {
  source: "Escape from Tarkov Wiki (Fandom community)",
  url: "https://escapefromtarkov.fandom.com/wiki/Story_chapters",
  license: "CC BY-NC-SA",
  licenseUrl: "https://www.fandom.com/licensing",
  doNotRemove: "Attribution is a license requirement.",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- HTML tokenizer (mirrors Python's html.parser events) ---------- */

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

/** Yields {type: "start"|"end"|"data", tag?, data?} tokens in document order. */
export function tokenizeHtml(html) {
  const tokens = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) tokens.push({ type: "data", data: decodeEntities(m[4]) });
    else if (m[2]) tokens.push({ type: m[1] ? "end" : "start", tag: m[2].toLowerCase() });
  }
  return tokens;
}

/**
 * Port of ObjectiveExtractor / SectionExtractor: walk tokens, find the
 * first <h2> whose text contains `sectionSubstring` (case-insensitive),
 * collect the text of every top-level `collectTags` element until the
 * NEXT <h2>. `[edit...]` markers are stripped, matching the Python regex.
 */
export function extractSection(html, sectionSubstring, collectTags) {
  const tokens = tokenizeHtml(html);
  let inTarget = false, done = false, pendingH2 = false, h2Text = "";
  let depth = 0, buf = [], lines = [];
  for (const tok of tokens) {
    if (tok.type === "start") {
      if (tok.tag === "h2") {
        if (inTarget) done = true;
        pendingH2 = true; h2Text = "";
      }
      if (done) continue;
      if (inTarget && collectTags.includes(tok.tag)) {
        if (depth === 0) buf = [];
        depth += 1;
      }
    } else if (tok.type === "end") {
      if (tok.tag === "h2" && pendingH2) {
        pendingH2 = false;
        if (h2Text.toLowerCase().includes(sectionSubstring)) inTarget = true;
      }
      if (done) continue;
      if (inTarget && collectTags.includes(tok.tag) && depth) {
        depth -= 1;
        if (depth === 0) {
          let text = buf.join("").replace(/\s+/g, " ").trim();
          text = text.replace(/\[edit.*?\]/gi, "").trim();
          if (text) lines.push(text);
        }
      }
    } else {
      if (pendingH2) h2Text += tok.data;
      if (inTarget && depth && !done) buf.push(tok.data);
    }
  }
  return lines;
}

export const extractObjectives = (html) => extractSection(html, "objectives", ["li"]);
export const extractRequirements = (html) => extractSection(html, "requirements", ["li", "p"]);

/* ---------- small pure helpers (ported 1:1) ---------- */

export function slug(title) {
  const t = title.replace(/\s*\(story chapter\)\s*/i, "");
  const id = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return [id, t];
}

export function titleFromWikiLink(url) {
  return decodeURIComponent(url.split("/wiki/").pop()).replace(/_/g, " ");
}

function norm(s) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
}

/** Returns [chapterId, objectiveIndex|null] or [null, null]. */
export function matchGate(line, chapters) {
  const low = line.toLowerCase();
  for (const ch of chapters) {
    if (!low.includes(ch.name.toLowerCase())) continue;
    const words = new Set(norm(line).split(" ").filter(Boolean));
    let best = null, bestScore = 0;
    (ch.objectives ?? []).forEach((obj, idx) => {
      const ow = new Set(norm(obj).split(" ").filter(Boolean));
      if (!ow.size) return;
      let inter = 0;
      for (const w of ow) if (words.has(w)) inter++;
      const score = inter / ow.size;
      if (score > bestScore) { best = idx; bestScore = score; }
    });
    return [ch.id, bestScore >= 0.6 ? best : null];
  }
  return [null, null];
}

/* ---------- API + orchestration ---------- */

async function wikiApi(params) {
  const url = WIKI_API + "?" + new URLSearchParams({ ...params, format: "json", origin: "*" });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`wiki HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info || "wiki error");
  return data;
}

export async function fetchStoryline(log = () => {}) {
  log("Fetching chapter list from the EFT Wiki...");
  const cat = await wikiApi({
    action: "query", list: "categorymembers",
    cmtitle: CATEGORY, cmlimit: "50", cmnamespace: "0",
  });
  const titles = cat.query.categorymembers
    .map((m) => m.title)
    .filter((t) => t.toLowerCase() !== "story chapters");
  log(`${titles.length} chapters: ${titles.join(", ")}`);

  const chapters = [];
  for (const title of titles) {
    await sleep(1000); // politeness delay, matches the Python tool
    const [cid, name] = slug(title);
    const entry = {
      id: cid, name,
      wikiUrl: "https://escapefromtarkov.fandom.com/wiki/" + encodeURIComponent(title.replace(/ /g, "_")),
      objectives: [],
    };
    try {
      const parsed = await wikiApi({ action: "parse", page: title, prop: "text", redirects: "1" });
      const html = parsed.parse.text["*"];
      entry.objectives = extractObjectives(html);
      if (!entry.objectives.length) entry.note = "No objectives section found on the wiki page.";
      log(`  ${name}: ${entry.objectives.length} objectives`);
    } catch (e) {
      entry.note = `Fetch/parse failed: ${e.message}`;
      log(`  ${name}: FAILED (${e.message})`);
    }
    chapters.push(entry);
  }

  return {
    note: `Imported from the Escape from Tarkov Wiki on ${todayISO()}.`,
    attribution: ATTRIBUTION,
    chapters,
  };
}

/**
 * @param quests   transformed quest records (need id, name, wikiLink, prerequisites)
 * @param chapters storyline chapters just fetched (or previously stored)
 * @param all      scrape every quest with a wiki link, not just chain-starters
 */
export async function fetchStoryGates(quests, chapters, log = () => {}, all = false) {
  const targets = quests.filter((q) => q.wikiLink && (all || !(q.prerequisites ?? []).length));
  log(`Scraping Requirements for ${targets.length} chain-starter quest(s)...`);

  const gates = {};
  let failed = 0;
  const pageCache = new Map(); // several quests can share a wikiLink
  for (const q of targets) {
    const title = titleFromWikiLink(q.wikiLink);
    if (!pageCache.has(title)) {
      await sleep(1000);
      try {
        const parsed = await wikiApi({ action: "parse", page: title, prop: "text", redirects: "1" });
        pageCache.set(title, extractRequirements(parsed.parse.text["*"]));
      } catch (e) {
        pageCache.set(title, e);
      }
    }
    const lines = pageCache.get(title);
    if (lines instanceof Error) {
      failed += 1;
      log(`  FAIL ${q.name}: ${lines.message}`);
      continue;
    }
    for (const ln of lines) {
      const [chap, objIdx] = matchGate(ln, chapters);
      if (chap) {
        gates[q.id] = { chapterId: chap, objectiveIndex: objIdx, requirement: ln };
        const tag = objIdx != null ? `objective #${objIdx + 1}` : "full chapter";
        log(`  GATE ${q.name} -> ${chap} (${tag})`);
        break;
      }
    }
  }

  log(`Story gates: ${Object.keys(gates).length} found, ${failed} page(s) failed.`);
  return {
    note: `Story gates from the Escape from Tarkov Wiki on ${todayISO()}.`,
    attribution: ATTRIBUTION,
    gates,
  };
}
