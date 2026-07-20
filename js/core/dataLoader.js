/**
 * dataLoader.js — the JSON data engine.
 *
 * All game data lives in /data/*.json. A manifest (data/manifest.json)
 * declares which datasets exist, so adding a new dataset after a wipe is:
 *   1. drop the JSON file into /data
 *   2. add one line to the manifest
 * No code changes required.
 *
 * Datasets are fetched in parallel at boot and held in an in-memory
 * registry. get() is synchronous after load, which keeps page renderers
 * simple.
 */
import { emit } from "./events.js";
import { kv } from "./db.js";
import { DATASET_PREFIX, storedManifest } from "./importer.js";

const registry = new Map(); // datasetId -> parsed JSON
let manifest = null;

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Load datasets. Called once at boot. Two sources, merged (v0.9.0):
 *   1. Browser-imported datasets in IndexedDB (from js/core/importer.js)
 *   2. File datasets under /data (the Python importer path)
 * DB datasets win per-id when both exist (they're always at least as fresh
 * as the click that created them); file-only datasets (e.g. storyline
 * until its wiki fetch is ported) still load alongside them. If NEITHER
 * source exists this resolves with loaded=0 — app.js shows the first-run
 * importer screen instead of a fatal error.
 */
export async function loadAll() {
  const dbManifest = await storedManifest();
  let fileManifest = null;
  try { fileManifest = await fetchJSON("data/manifest.json"); } catch { /* no files — fine */ }

  if (!dbManifest && !fileManifest) {
    manifest = null;
    emit("data:ready", { loaded: 0, total: 0, failures: [] });
    return { loaded: 0, total: 0, failures: [], empty: true };
  }

  // merged manifest: DB entries first, then file-only entries
  const dbIds = new Set((dbManifest?.datasets ?? []).map((d) => d.id));
  manifest = {
    ...(fileManifest ?? {}),
    ...(dbManifest ?? {}),
    datasets: [
      ...(dbManifest?.datasets ?? []),
      ...((fileManifest?.datasets ?? []).filter((d) => !dbIds.has(d.id))),
    ],
  };

  const results = await Promise.allSettled(
    manifest.datasets.map(async (entry) => {
      if (dbIds.has(entry.id)) {
        const data = await kv.get(DATASET_PREFIX + entry.id);
        if (data == null) throw new Error(`db dataset "${entry.id}" missing`);
        registry.set(entry.id, data);
      } else {
        registry.set(entry.id, await fetchJSON(`data/${entry.file}`));
      }
      return entry.id;
    })
  );

  const failures = results
    .filter((r) => r.status === "rejected")
    .map((r) => r.reason?.message ?? String(r.reason));
  if (failures.length) {
    console.error("[dataLoader] failed datasets:", failures);
  }

  emit("data:ready", {
    loaded: registry.size,
    total: manifest.datasets.length,
    failures,
  });

  return { loaded: registry.size, total: manifest.datasets.length, failures };
}

/** Synchronous dataset access (after loadAll has resolved). */
export function get(datasetId) {
  if (!registry.has(datasetId)) {
    console.warn(`[dataLoader] dataset "${datasetId}" is not loaded`);
    return null;
  }
  return registry.get(datasetId);
}

export function getManifest() {
  return manifest;
}

export function stats() {
  return {
    loaded: registry.size,
    total: manifest?.datasets.length ?? 0,
    gameVersion: manifest?.gameVersion ?? "unknown",
    dataVersion: manifest?.dataVersion ?? "unknown",
  };
}
