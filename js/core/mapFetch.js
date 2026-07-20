/**
 * mapFetch.js — in-browser reference map fetcher (v0.9.9).
 *
 * The Termux path (tools/register_maps.py) still works and is still the
 * primary documented path: you download an image, run the script, it
 * writes assets/maps/reference.json. This module gives hosted-site
 * visitors an equivalent one-click path that respects the same license
 * terms — RE3MR's maps are CC BY-NC-SA 4.0 (NonCommercial), which is
 * exactly why we never bundle them in the repo. Each visitor's own
 * browser fetches its own copy, stored only in that browser's IndexedDB,
 * same as every other piece of data in this app. Nothing is redistributed
 * by us; we never touch reemr.se's bytes ourselves.
 *
 * How it works: RE3MR's page URLs don't follow one predictable pattern
 * (confirmed the hard way — see README/handoff history), so each map's
 * page HTML is fetched fresh and its `og:image` meta tag is read to find
 * the actual image URL, then the image itself is fetched and stored as a
 * base64 data URL in the kv store.
 *
 * CORS is the one thing that can't be verified from here: reemr.se may or
 * may not send Access-Control-Allow-Origin on its image host, and that
 * can only be known by an actual browser trying it. If a fetch is blocked
 * by CORS, this fails cleanly (never partial/corrupt data) and the caller
 * gets a clear error plus a manual fallback link to open the map directly.
 */
import { kv } from "./db.js";

export const REF_PREFIX = "refmap:";
const MANIFEST_KEY = REF_PREFIX + "manifest";

export const ATTRIBUTION = {
  author: "RE3MR",
  url: "https://reemr.se",
  license: "CC BY-NC-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  note: "3D community maps by RE3MR, used unmodified. Attribution required — do not remove.",
};

/**
 * Known page URLs, keyed by this app's map id. RE3MR's URL scheme is
 * genuinely inconsistent across maps (reemr.se/<name>/ vs
 * reemr.se/maps/<Name>/), so this is a curated list, not a formula.
 * Extend it as more maps are confirmed; an id missing here just means
 * "not fetchable yet," handled gracefully by the UI.
 */
export const KNOWN_MAP_PAGES = {
  customs: "https://reemr.se/customs/",
  woods: "https://reemr.se/woods/",
  interchange: "https://reemr.se/Interchange/",
  reserve: "https://reemr.se/reserve/",
  "streets-of-tarkov": "https://reemr.se/streetsoftarkov/",
};

/** Pull the og:image URL out of a page's HTML. Pure function, easy to test. */
export function extractOgImage(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m ? m[1] : null;
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function storedReferenceManifest() {
  return (await kv.get(MANIFEST_KEY)) ?? { attribution: ATTRIBUTION, maps: {} };
}

/**
 * Fetch one map's reference image end-to-end and store it. Throws with a
 * clear message on any failure (network, CORS, no og:image found) — never
 * writes partial data.
 */
export async function fetchReferenceMap(mapId, log = () => {}) {
  const pageUrl = KNOWN_MAP_PAGES[mapId];
  if (!pageUrl) throw new Error(`No known RE3MR page for "${mapId}" yet.`);

  log(`Fetching ${pageUrl} ...`);
  const pageRes = await fetch(pageUrl);
  if (!pageRes.ok) throw new Error(`Page fetch failed (HTTP ${pageRes.status})`);
  const html = await pageRes.text();

  const imageUrl = extractOgImage(html);
  if (!imageUrl) throw new Error("Couldn't find the map image on that page (no og:image tag).");

  log(`Found image: ${imageUrl}`);
  let imgRes;
  try {
    imgRes = await fetch(imageUrl);
  } catch (e) {
    throw new Error(`Image fetch blocked (likely CORS) — open it manually instead: ${imageUrl}`);
  }
  if (!imgRes.ok) throw new Error(`Image fetch failed (HTTP ${imgRes.status})`);
  const blob = await imgRes.blob();
  const sizeMB = Math.round((blob.size / 1e6) * 10) / 10;
  log(`Downloaded ${sizeMB} MB, storing...`);

  const dataUrl = await blobToDataURL(blob);
  await kv.set(REF_PREFIX + mapId, dataUrl);

  const manifest = await storedReferenceManifest();
  manifest.maps[mapId] = { sizeMB, sourceUrl: imageUrl, pageUrl, fetchedAt: new Date().toISOString() };
  await kv.set(MANIFEST_KEY, manifest);
  log(`Stored reference map for "${mapId}".`);
  return manifest.maps[mapId];
}

export async function deleteReferenceMap(mapId) {
  await kv.delete(REF_PREFIX + mapId);
  const manifest = await storedReferenceManifest();
  delete manifest.maps[mapId];
  await kv.set(MANIFEST_KEY, manifest);
}
