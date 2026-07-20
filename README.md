# Tarkov Buddy

Offline-first Escape From Tarkov companion application.
Vanilla HTML/CSS/JavaScript, ES modules, IndexedDB, JSON-driven. No frameworks, no build step, no internet required after download.

**Current version: v0.9.10** -- v0.9.9's fetch-and-store approach didn't survive contact with a real device: Safari on the hosted site reported "Load failed" on the very first step, confirming RE3MR sends no CORS header on its page HTML, so no script anywhere can read those bytes cross-origin -- a browser security wall, not a bug. The actual fix: an `<img>` tag doesn't need CORS to DISPLAY a cross-origin image, only script-level pixel access does. So the Maps page now hotlinks RE3MR's own image URLs directly instead of downloading and storing a copy -- confirmed maps (Customs, Woods, Interchange, Reserve, Streets of Tarkov) show a "View map" button identical to the file-based ones, just sourced live from reemr.se, with a clear "needs a connection" note and full attribution. Verified end-to-end that the cross-origin image genuinely renders (naturalWidth > 0), not just that no error was thrown. The Termux register_maps.py path is untouched and still the way to get an offline-capable local copy.

**v0.9.7** -- The last gap before 1.0.0 is closed: story chapters and story gates now import IN THE BROWSER too. js/core/wikiImport.js is a faithful port of tools/fetch_storyline.py and tools/fetch_story_gates.py, right down to a hand-written HTML tokenizer that mirrors Python's html.parser event-for-event (chosen specifically so a true parity test is possible without a DOM) -- six HTML fixtures covering nested lists, entity decoding, [edit]-marker stripping, and fuzzy chapter-objective gate matching, run through both implementations, diffed: IDENTICAL. Wired into the one-click importer as its own resilience-guarded step -- if the wiki is unreachable, the rest of the import still completes and Settings offers a retry; nothing about the core dataset depends on it. Verified end-to-end against a copy with no data/ directory and a fully mocked wiki + tarkov.dev API: Storyline page renders real chapters, gates attach correctly to the right quest, manifest lists both datasets. Every dataset the app has is now available with one tap and zero installs -- Tarkov Buddy is feature-complete for public hosting.

**v0.9.6** -- serve.py binds IPv4 and IPv6 on one socket so `localhost` and `127.0.0.1` always reach the same server (a stray process squatting on the other stack was silently answering with stale cached files); a taken port now fails loudly with the command to find the culprit instead of allowing a phantom server.

**v0.9.4-0.9.5** -- Removed the "TC" logo box next to the brand name; brand name and "BUDDY" moved onto one line, both full-size in Bender.

**v0.9.3** -- Rebrand: the app is now **Tarkov Buddy**, wearing the game's own typeface -- Bender Bold by Jovanny Lemonad / Oleg Zhuravlev (the actual EFT UI font, free under the SIL Open Font License), self-hosted as a 23KB woff2 at assets/fonts/ so branding renders offline, leading the display-font stack for the sidebar brand, page titles, and panel titles. Directory, zip, and install command intentionally stay `tarkov-companion` -- renaming the folder would break every existing install path and the sacred unzip command; saves are origin-scoped and unaffected either way.

**v0.9.2** -- Inline +/- count steppers everywhere collectible items appear: Hideout shopping-list rows, each station card's requirement items, and active quests' hand-in items (with FIR badges) -- all backed by the one shared counter component (js/ui/countStepper.js) writing profile.inventory, so ticking a bolt anywhere updates every page at once. Verified round-trip: +2 on the shopping list shows 2/3 on the quest card, +1 there shows 3/x on Needed Items, -1 there flows back. Needed Items' existing stepper now delegates to the same component.

**v0.9.1** -- Update QoL ahead of public hosting: when a new version's service worker takes control, the page auto-reloads itself exactly once (guarded so the first-ever install never reload-loops) -- a single normal reload is now all any update takes, no double-reload dance, no serviceworker-internals. The app also re-checks for updates whenever it regains focus and hourly. Status bar now shows data age ("DATA 9/9 · 12d old"), turning into an "update in Settings" nudge past 30 days, so nobody plans raids on month-old prices.

**v0.9.0** -- Zero-setup: the importer now runs IN THE BROWSER. A faithful JS port of tools/update_data.py (`js/core/importer.js` -- same GraphQL queries, same fallback ladders, same transforms, verified by a parity test that runs identical mocked payloads through both implementations and diffs the JSON: IDENTICAL, including Python banker's-rounding behavior) fetches from api.tarkov.dev directly and stores datasets in IndexedDB. dataLoader loads browser-imported datasets first and file datasets second, per-id (so a file-only dataset like storyline keeps working next to browser data). First run with no data at all shows a one-click "Download game data" screen instead of a fatal error; Settings gains a Game Data panel with an update button and import log. The Python importer remains fully supported for Termux installs. Still file/Python-only until their wiki fetches are ported: storyline.json and storyGates.json.

**v0.8.30** -- AI consolidation: provider config (Anthropic Claude / Google Gemini / local Ollama) moved into Settings as one "AI Assistant" panel backed by a shared DOM-free core module (`js/core/ai.js`). The Coach's free-form chat is the first consumer -- deterministic engine answers first, unmatched questions fall through to whichever provider is configured, with real profile context and a system prompt that forbids invented stats. Keys/endpoints live in the local kv store only, never in save exports. The old Coach-page Ollama setting migrates automatically; the short-lived standalone AI tab (v0.8.28-29) is removed.

**v0.8.29** -- Gemini added as a second cloud provider alongside Claude, each remembering its own key.

**v0.8.28** -- Hideout shopping list now excludes items for blocked upgrades (prereqs not met) by default, which carries into the Loot Advisor and Needed Items automatically since all three consume the same engine call; an "Include blocked upgrades" toggle restores the full picture.

**v0.8.27** -- Trader-standing quest gates: the importer pulls Task.traderRequirements (reputation only; loyalty was already handled) via its own fallback-ladder query, and quests like Fence's negative-rep chains now lock until your standing qualifies. Rep isn't exposed by any API, so rep-gated traders get a manual Standing input on their Traders-page card (default 0 -- the game's starting rep, which correctly locks the chains out of the box). Lock reasons say exactly what's needed and what you have.

**v0.8.26** -- Ship-wrap: extracts importer primary query fixed to current schema (transferItem became a ContainedItem, name at transferItem.item.name; old shape kept as a ladder rung), and Storyline chapters gained a "to here" back-fill button on every unticked objective for one-tap catch-up -- verified to correctly release story gates.

**v0.8.7** -- Added js/core/pathGraph.js: a waypoint-graph router for hand-traced walking paths, built after confirming (again) that no API or automated image analysis can produce real walkable-path data for any map -- an edge-density cost-surface A* attempt literally routed through the black margin outside the map image, since 'visually simple' isn't the same as 'walkable.' The working approach instead: a person traces how they'd actually walk between two real points directly on the calibrated map image (see the route-drawing tool built this session), and pathGraph.js turns one or more traces into a graph -- nodes deduped by coordinate so multiple traces merge where they cross, edges weighted by real distance. routeAlongGraph(start, end) snaps arbitrary points to the nearest traced segment and: rides the real graph the whole way if both ends are within range of a trace; rides the real graph as far as it goes and honestly falls back to a straight line for the rest if only one end is covered; or falls back to a plain straight line if neither end is covered. Every returned segment is flagged real-vs-fallback so a UI can render solid vs dashed rather than blending guesses in silently. THIS MODULE IS NOT YET WIRED INTO THE APP -- it's validated standalone (unit-tested against one real user-traced route: Old Gas Station to Crossroads on Customs, all three coverage cases -- full/partial/none -- confirmed working and visualized) but nothing in js/pages/ imports it yet. Wiring it in, and/or collecting more traced routes to grow graph coverage, is next-session work.

**v0.8.6** -- Two more Route Optimizer fixes after v0.8.5 still showed duplicate stops in the wild. (1) The real duplication source: objectiveMaps() could return the same map id twice when source data repeated it in an objective's maps array, which made mapPlan() push the entire objective (not just its positions) twice -- the v0.8.5 fix only deduped positions within one push, not this. Fixed at objectiveMaps() itself, plus added a final defensive dedup pass over each quest's objectives (by description+positions) as a second safety net. (2) Extract availability: many extracts (not just keyword/switch-gated ones) can simply be closed on a given raid at random, which no API can predict -- so pretending there's one correct extract to suggest was itself the deeper issue, not just the conditional ones. suggestExtract() is replaced by suggestExtracts(), returning a ranked (nearest-first) list of up to 3 options instead of a single pick; the Maps page now shows a "best guess" plus backups, each labeled if it needs a keyword/item/switch, so there's always a fallback if the top pick is closed.

**v0.8.5** -- Two Route Optimizer bugfixes reported after v0.8.4 install. (1) Duplicate route stops: some objective position data lists the same (x,z) coordinate more than once per objective, and orderRoute()/the objective display string were both taking that list at face value -- now deduped once in routeEngine.mapPlan() so it flows correctly everywhere. (2) Hidden/gated extracts (e.g. Smugglers Bunker needing its keyword item, RUAF Roadblock needing its light) could get suggested as if always available -- the importer now captures transferItem/switches per extract (confirmed real schema fields) as a requires note, and suggestExtract() prefers an unconditional extract when one exists, only falling back to a gated one if it's the only option, with the requirement shown in an amber/brass "EXTRACT (CONDITIONAL)" badge instead of the usual green one.

**v0.8.4** -- Customs map calibration overhaul. Replaced the 4-point estimate with a 20-point fit spanning nearly every extract on the map (avg. residual ~1.7% of image width, max ~4%), sourced from a higher-fidelity map render (the original PSD design file from re3mr.com, flattened at 3840x2160) instead of the earlier compressed screenshot. Also added fetch_transits() to the importer (same fallback-ladder pattern as extracts) so map-to-map transit points are now pulled from tarkov.dev -- though transit *positions* turned out to represent an approximate trigger-zone center rather than a precise marker, so they weren't usable as calibration anchors and aren't part of the current fit.

**v0.8.3** — Real map visual for the Route Optimizer (Customs only, as a test): `js/core/mapCalibration.js` loads a hand-fitted affine transform (`assets/maps/mapCalibration.json`) mapping real game (x,z) coordinates to pixel positions on a real Customs map image, calibrated from 4 known extract locations (avg. residual error under 1% of image width). The Maps page's Raid Planner now renders your actual optimized route as numbered dots connected by lines directly on top of the map image, plus a diamond marker for the suggested extraction, whenever a map has calibration data — other maps fall back to the plain text list as before. This lives outside `data/` deliberately, since it's hand-supplied per map (not something the importer can fetch) and needs to survive `unzip -x "data/*"` across future updates.

Map image credit: Customs map by [re3mr.com](https://tarkov.dev), used under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — attribution required, non-commercial use only, share-alike applies to any adaptation. This app is free/non-commercial, but keep that license in mind if you ever add more calibrated maps or redistribute this build.

To calibrate another map yourself: drop an image into `assets/maps/`, pick 3-4 named extracts visible on it, get their real (x,z) from `data/maps.json`, read their pixel positions off the image, and give me both sets — I'll fit and add the transform.

Previous (v0.8.2) — Route Optimizer (spec Layer 6): the importer now fetches map extraction points (`fetch_extracts()`, same 3-step fallback ladder as the geo pass — richest form with faction lock, then position-only, then names-only, total failure just means no suggestion) and stores them per-map in `data/maps.json`. `routeEngine.orderRoute()` runs a nearest-neighbor pass over each map's imported objective coordinates and suggests the nearest usable extraction (faction-preferred, falls back to any if none match). Surfaced on the Maps page's Raid Planner (ordered stop list + distance + extract badge), on each map card (extract list), and in the Dashboard's Recommended Raid card. All of this degrades cleanly to nothing when the data pack has no positions/extracts yet — re-run the importer to populate it, no placeholders are shown in the meantime. Also: mapScores now includes the small raid-log familiarity bonus in its displayed breakdown.

Previous (v0.8.1) — Raid Logger + adaptive player model (spec Layer 4): new Raid Log page to record map/outcome/kills/loot-value per raid (`js/core/raidEngine.js`, DOM-free); survival rate, K/D, avg loot, and a per-map breakdown, all derived live from the log — nothing pre-aggregated, so deleting an entry never leaves stale totals. Maps with 3+ logged raids now personally weight `mapRisk` (survive worse than your average here → risk nudges up, survive better → down) and `mapScores` (a small familiarity bonus for maps you've logged a lot and hold your own on). Dashboard PMC strip gains live Survival Rate / K/D cells, plus a Raid Log summary card; Progress page gains Raid Performance + Favorite Maps panels. Also: PMC level is now editable directly from the dashboard via a −/+ stepper next to your name (writes through `store.update`, same clamp as Settings).

Previous (v0.8.0) — UI overhaul: new dark-tactical visual theme (deeper card elevation, lime-green active accent, brass gold highlights) applied to every page via shared design tokens in `style.css`; redesigned Dashboard with a PMC status strip, a "Recommended raid" hero card (score + reasoning from the route engine), a ranked priorities list (from the advisor engine), active-quest and trader-progress cards, and a hideout requirement checklist for the next buildable upgrade — everything still derived live from your profile and the data pack, nothing hardcoded. No engine or data changes in this release.

Previous (v0.7.0) — offline AI Coach: deterministic decision engine with explained recommendations (Next Best Actions), Session Planner ("I have 2 hours" -> ordered raid plan with derived risk scores + after-raid checklist), natural-language Ask-the-Coach (sell/keep, item sourcing, trader loyalty paths — all computed from your profile, no internet), item knowledge graph fed by new crafts + barters importer datasets, and an optional local-LLM hook (Ollama) that only enhances free-form chat. Previously v0.6.1 — map unlock toggles: mark a map "not yet unlocked in game" and every quest on it drops to Locked across the quest list, Raid Planner, Loot Advisor, and Needed Items (fixes story-gated chains like Icebreaker being suggested too early). Also v0.6.0 — everything from v0.5 plus: route-engine Raid Planner (maps ranked by objectives, Kappa weight, and still-needed handover items, with per-objective map coordinates when imported), per-objective positional data via a failure-tolerant importer extension, and a per-trader Quest Dependency Graph page (SVG chain view, tap for details).\n\nPrevious (v0.5): everything from v0.4 plus: Needed Items page with manual have/needed counters, Progress analytics page (overall + Kappa bars, per-trader progress, hideout build-out, item collection %, recent completions), Kappa-only quest filter with completion timestamps, Loot Advisor have-counts (auto-downgrades KEEP to FLEA/SELL once collected), hideout shopping list have-counts, and a Raid Planner lite panel on the Maps page grouping active objectives by map.

Previous (v0.4): quest tracker, trader loyalty, Loot Advisor (quest + hideout aware), Hideout Planner with combined shopping list, raid map briefings, Ammo Guide with armor-class grading, installable PWA with full offline support, live data importer (tarkov.dev), automated nightly data updates via GitHub Actions, save system, global search, dark UI.

## Try it now — zero install

Visit **[the hosted app]** in any browser (phone or desktop). Tap "Download
game data" once — it pulls quests, items, maps, hideout, ammo, story
chapters, everything, straight from tarkov.dev and the EFT Wiki into your
browser's own local storage. No Termux, no Python, no account. Your
progress lives only on your device; nothing is ever sent anywhere except
that one-time data pull and, if you turn it on, your own AI provider key.

*(Replace the bracketed link above with `https://<your-username>.github.io/<repo-name>/`
once Pages is live — see "Publishing this repo" below.)*

## Running locally


ES modules and `fetch()` are blocked on `file://` URLs, so serve the folder with any static server:

```bash
# Python (preinstalled on most systems)
cd tarkov-companion
python3 tools/serve.py
# then open http://localhost:8080
```

Any other static server (VS Code Live Server, `npx serve`, nginx) works the same way. No install, no build.

## Project structure

```
tarkov-companion/
├── index.html          Application shell (sidebar, topbar, view, status bar, search overlay)
├── style.css           Theme + all component styles (design tokens at the top)
├── app.js              Entry point: boot sequence, status bar, mobile nav
├── js/
│   ├── core/           Framework-free "engine" — no DOM feature code here
│   │   ├── events.js       Pub/sub event bus (module decoupling)
│   │   ├── db.js           IndexedDB wrapper (profiles + kv stores, versioned migrations)
│   │   ├── store.js        Player profile: load/save/migrate/import/export
│   │   ├── dataLoader.js   Manifest-driven JSON dataset loading
│   │   ├── router.js       Hash router + sidebar nav builder
│   │   └── search.js       Global search index (Ctrl+K)
│   ├── ui/
│   │   ├── dom.js          el() element builder, toasts, formatters
│   │   └── icons.js        Inline SVG icon set (offline, zero requests)
│   └── pages/
│       ├── index.js        Page registry — one line to add a page
│       ├── dashboard.js    Live dashboard (profile + dataset driven)
│       └── settings.js     Profile editing, save export/import/reset
├── data/
│   ├── manifest.json   Declares every dataset + data pack version
│   ├── traders.json    8 traders with loyalty level requirements
│   ├── maps.json       10 maps with player counts, durations, bosses
│   ├── quests.json     Seed quests (full DB in v0.2)
│   └── items.json      Seed items (full DB in v0.2)
├── assets/             SVG maps/icons from v0.2 onward
└── saves/              Reserved for file-based save exports
```

## Architecture notes

- **Pages are plugins.** A page is `{ id, title, icon, section, render(container) }` registered in `js/pages/index.js`. The router builds the sidebar from the registry.
- **Data is declarative.** New wipe? Replace JSON files and bump `dataVersion` in `manifest.json`. New dataset? Drop the file in `/data`, add one manifest line, and (optionally) one search adapter.
- **Saves are schema-versioned.** `store.js` migrates old profiles forward, so v0.1 saves survive every future milestone. Export/import as JSON from Settings.
- **Modules talk through events** (`profile:changed`, `data:ready`, `save:status`, `route:changed`) rather than importing each other.

## Roadmap

v0.2 Quest Engine · Trader Engine · Loot Advisor → v0.3 Hideout Planner · Item DB → v0.4 Maps · Route Optimizer · Raid Planner → v0.5 Analytics · Inventory · Kappa → v0.6 AI Assistant


## Publishing this repo (GitHub Pages)

This repo deploys itself — `.github/workflows/pages.yml` publishes the
root on every push to `main`, no build step (there isn't one; see
Architecture notes below). One-time setup after your first push:

1. Repo Settings -> Pages -> Source: **GitHub Actions** (not "Deploy from
   a branch" — the workflow handles it).
2. Push to `main`. Watch the Actions tab; the run finishes in under a
   minute for a no-build static site.
3. Your app is live at `https://<username>.github.io/<repo-name>/`.

`.gitignore` deliberately excludes `data/` (personal, regenerated on
demand) and `assets/maps/reference/` + `reference.json` (the RE3MR
community map renders are CC BY-NC-SA — NonCommercial — and must never be
redistributed via this repo; `tools/register_maps.py` remains each user's
own path to them). Neither exclusion affects the hosted app: it never
reads `data/` at all (see "Try it now" above), and the Maps page degrades
gracefully with no reference overlay until a user runs the registration
tool locally.

## Community

Tarkov Companion is an open, MIT-licensed community project. Host your own
copy in minutes (see PUBLISHING.md), file issues, or send pull requests —
the architecture is deliberately dependency-free vanilla JS so anyone can
contribute with just a text editor. Please keep contributions in that
spirit: no build steps, no frameworks, readable code.

Unofficial fan project. Escape from Tarkov and all game data are
© Battlestate Games. Live data is provided by the community-run
tarkov.dev API — consider supporting them.
