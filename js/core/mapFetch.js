/**
 * mapFetch.js — hosted RE3MR reference maps via direct hotlink (v0.9.10).
 *
 * v0.9.9 tried to fetch() RE3MR's page HTML and image bytes into this
 * browser's storage. Real-device testing (Safari, hosted on GitHub Pages)
 * showed "Load failed" on the very first step — RE3MR doesn't send the
 * Access-Control-Allow-Origin header a script needs to READ bytes from
 * another origin. That's a browser security wall with no client-side fix;
 * a proxy would be the only way around it, and this app doesn't run one.
 *
 * The actual fix: an <img> tag doesn't need CORS to DISPLAY a cross-origin
 * image — only script-level access to its pixels (fetch/canvas) does. So
 * instead of downloading and storing a copy, the Maps page just points an
 * <img> straight at RE3MR's own image URL. No download, no storage, no
 * CORS problem — and it's honest about being a live hotlink (needs a
 * connection each time you view it), unlike the file-based path from
 * tools/register_maps.py which is a real local copy.
 *
 * URLs below were hand-confirmed from each map's actual page (RE3MR's URL
 * scheme is inconsistent across maps — reemr.se vs www.reemr.se vs
 * maps.reemr.se vs re3mr.com, no formula works). `mobile` is a
 * phone-sized image for the inline viewer; `full` is the full-resolution
 * version, used only as the "open full size" link so a big download only
 * happens if someone actually wants it.
 */
export const KNOWN_MAP_IMAGES = {
  customs: {
    mobile: "https://maps.reemr.se/Customs/re3mrCustoms2MobileJPG.jpg",
    full: "https://maps.reemr.se/Customs/re3mrCustoms2.png",
  },
  woods: {
    mobile: "https://www.reemr.se/maps/Woods/WoodsRe3mrMobilePNG.png",
    full: "https://www.reemr.se/maps/Woods/WoodsRe3mrPNG.png",
  },
  interchange: {
    mobile: "https://www.re3mr.com/maps/Interchange/re3mrInterchangemobile.jpg",
    full: "https://www.re3mr.com/maps/Interchange/re3mrInterchange.jpg",
  },
  reserve: {
    mobile: "https://reemr.se/maps/Reserve/Re3mrReserveMobile.png",
    full: "https://reemr.se/maps/Reserve/Re3mrReserveLossless.png",
  },
  "streets-of-tarkov": {
    mobile: "https://reemr.se/wp-content/uploads/2024/07/re3mrStreetsofTarkovMobile.jpg",
    full: "https://reemr.se/maps/Streets/re3mrStreetsofTarkov.png",
  },
  factory: {
    mobile: "https://www.re3mr.com/maps/Factory/FactorybyRe3mrmobile.jpg",
    full: "https://www.re3mr.com/maps/Factory/FactorybyRe3mr.png",
  },
  "ground-zero": {
    mobile: "https://www.re3mr.com/maps/Groundzero/GroundZeroMobile.png",
    full: "https://www.re3mr.com/maps/Groundzero/GroundZero.png",
  },
  lighthouse: {
    // RE3MR ships this map as two orientations with no single "primary" —
    // vertical is the more commonly linked one, used here as the default.
    mobile: "https://reemr.se/maps/Lighthouse/re3mrLighthouseVERTMobile.jpg",
    full: "https://reemr.se/maps/Lighthouse/re3mrLighthouseVERT.png",
  },
  shoreline: {
    mobile: "https://reemr.se/maps/Shoreline/re3mrShoreline2Mobile.jpg",
    full: "https://reemr.se/maps/Shoreline/re3mrShoreline2.png",
  },
  labyrinth: {
    mobile: "https://www.re3mr.com/maps/Labyrinth/re3mrLabyrinthMobilePNG.png",
    full: "https://www.re3mr.com/maps/Labyrinth/re3mrLabyrinthPNG.png",
  },
  icebreaker: {
    mobile: "https://reemr.se/maps/Icebreaker/re3mrIcebreakerMobile.jpg",
    full: "https://reemr.se/maps/Icebreaker/re3mrIcebreaker.png",
  },
  terminal: {
    // RE3MR's Terminal page has no true 3D render yet ("Not available yet"
    // at time of writing) — this is their 2D wiki-style map instead.
    mobile: "https://reemr.se/maps/Terminal/WikiTerminalMapMobile.jpg",
    full: "https://reemr.se/maps/Terminal/WikiTerminalMap.jpg",
  },
  // labs: intentionally absent — RE3MR has no Lab map at all (not in
  // their own nav). Nothing to hotlink; the Maps card just shows no
  // "View map" section for it, same as any other unmapped id.
};

export const ATTRIBUTION = {
  author: "RE3MR",
  url: "https://reemr.se",
  license: "CC BY-NC-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
  note: "3D community map by RE3MR, hotlinked live from reemr.se and shown "
      + "unmodified. Attribution required — do not remove. This image is "
      + "not stored anywhere by this app; it loads fresh from RE3MR each "
      + "time, so it needs a connection to view.",
};
