/**
 * mapCalibration.js — per-map image calibration (v0.8.3, Route Optimizer
 * visual overlay).
 *
 * Deliberately separate from dataLoader/data/*.json: those files are
 * importer-governed (fetched from tarkov.dev, re-generated on every
 * `update_data.py` run). Calibration is the opposite — it's hand-fitted
 * to a specific user-supplied map image under assets/maps/, and needs to
 * survive `unzip -x "tarkov-companion/data/*"` across app updates, so it
 * lives under assets/ with its own tiny loader instead.
 *
 * The transform for each map is an affine fit (least-squares, computed
 * offline — see refPoints) mapping real game (x,z) to pixel (x,y) on
 * that map's image. Not a physics-accurate projection, just the best
 * linear fit through a handful of known points; see maxResidualPx for
 * how good that fit actually is.
 */
let calibration = null;

export async function loadMapCalibration() {
  try {
    const res = await fetch("assets/maps/mapCalibration.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    calibration = await res.json();
  } catch (e) {
    console.warn("[mapCalibration] not available:", e.message);
    calibration = { maps: {} };
  }
  return calibration;
}

function entry(mapId) {
  return calibration?.maps?.[mapId] ?? null;
}

/** Whether a real image + fitted transform exists for this map. */
export function hasCalibration(mapId) {
  return !!entry(mapId);
}

/** { image, imageWidth, imageHeight, maxResidualPx } or null. */
export function getImageInfo(mapId) {
  const e = entry(mapId);
  if (!e) return null;
  return { image: e.image, width: e.imageWidth, height: e.imageHeight, maxResidualPx: e.maxResidualPx };
}

/** Convert a real game (x,z) coordinate to a pixel (x,y) on the map's image. Null if uncalibrated. */
export function gameToPixel(mapId, point) {
  const e = entry(mapId);
  if (!e || !point) return null;
  const { m11, m12, m21, m22, tx, ty } = e.transform;
  return {
    x: m11 * point.x + m12 * point.z + tx,
    y: m21 * point.x + m22 * point.z + ty,
  };
}
