/**
 * app.js — application entry point.
 *
 * Boot sequence:
 *   1. Open IndexedDB, load or create the player profile   (store)
 *   2. Fetch every JSON dataset declared in the manifest    (dataLoader)
 *   3. Register pages, build navigation, render first route (router)
 *   4. Initialize global search and status bar
 */
import * as store from "./js/core/store.js";
import * as dataLoader from "./js/core/dataLoader.js";
import * as mapCalibration from "./js/core/mapCalibration.js";
import * as router from "./js/core/router.js";
import * as search from "./js/core/search.js";
import { on } from "./js/core/events.js";
import { toast } from "./js/ui/dom.js";
import { allPages } from "./js/pages/index.js";

const APP_VERSION = "0.9.11";

/* ---------- status bar ---------- */
function initStatusBar() {
  const profileEl = document.getElementById("status-profile");
  const dataEl = document.getElementById("status-data");
  const saveEl = document.getElementById("status-save");

  const renderProfile = (p) => {
    profileEl.textContent = `${p.name} · ${p.faction} · LVL ${p.level}`;
  };
  renderProfile(store.getProfile());
  on("profile:changed", renderProfile);

  on("data:ready", ({ loaded, total, failures }) => {
    // v0.9.1: show data age so nobody plans raids on month-old prices.
    // updatedAt comes from either importer path; absent on very old packs.
    const updatedAt = dataLoader.getManifest()?.updatedAt;
    let ageNote = "";
    if (updatedAt) {
      const days = Math.floor((Date.now() - new Date(updatedAt + "T00:00:00")) / 86400000);
      if (days > 30) ageNote = ` \u00b7 ${days}d old \u2014 update in Settings`;
      else if (days > 7) ageNote = ` \u00b7 ${days}d old`;
    }
    dataEl.textContent = `DATA ${loaded}/${total}${ageNote}`;
    dataEl.classList.toggle("statusbar__ok", failures.length === 0 && !ageNote.includes("update"));
  });

  on("save:status", ({ state, at }) => {
    if (state === "saving") saveEl.textContent = "SAVING…";
    else if (state === "saved") {
      saveEl.textContent = `SAVED ${new Date(at).toLocaleTimeString()}`;
      saveEl.classList.add("statusbar__ok");
    } else {
      saveEl.textContent = "SAVE ERROR";
      saveEl.classList.remove("statusbar__ok");
    }
  });
  saveEl.textContent = "SAVED";
  saveEl.classList.add("statusbar__ok");
}

/* ---------- mobile sidebar ---------- */
function initMobileNav() {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("menu-toggle");

  toggle.addEventListener("click", () => {
    const open = sidebar.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  // Close the drawer after navigating on small screens.
  on("route:changed", () => {
    sidebar.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  });
}

/* ---------- boot ---------- */
async function boot() {
  document.getElementById("app-version").textContent = `v${APP_VERSION}`;

  await store.init();
  initStatusBar();
  initMobileNav();

  const [dataResult] = await Promise.all([
    dataLoader.loadAll(),
    mapCalibration.loadMapCalibration(),
  ]);
  if (dataResult.empty) {
    // Zero-setup path (v0.9.0): no data files, no browser-imported data.
    // Offer the one-click import instead of a fatal error.
    const view = document.getElementById("view");
    const log = document.createElement("pre");
    log.style.cssText = "font-size:11px;color:var(--text-muted);white-space:pre-wrap;margin-top:10px;max-height:200px;overflow-y:auto";
    const btn = document.createElement("button");
    btn.className = "btn";
    btn.textContent = "Download game data";
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "Downloading\u2026";
      try {
        const { runImport } = await import("./js/core/importer.js");
        await runImport((m) => { log.textContent += m + "\n"; log.scrollTop = log.scrollHeight; });
        location.reload();
      } catch (err) {
        log.textContent += `Import failed: ${err.message}\nCheck your connection and tap the button to retry.\n`;
        btn.disabled = false;
        btn.textContent = "Retry download";
      }
    };
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `<div class="panel__title">Welcome to Tarkov Buddy</div>
      <p style="margin-bottom:12px">One-time setup: download the current game data
      (quests, items, maps, hideout\u2026) from tarkov.dev. It's stored in this browser
      and you can refresh it any time from Settings. Your progress always stays on
      this device.</p>`;
    panel.appendChild(btn);
    panel.appendChild(log);
    view.appendChild(panel);
    return; // no pages until data exists
  }
  if (dataResult.failures.length) {
    toast(`${dataResult.failures.length} dataset(s) failed to load — see console.`, { error: true });
  }

  allPages.forEach(router.register);
  search.init();

  // Re-render the current page whenever the profile changes elsewhere,
  // so dashboard stats stay live without page-level wiring.
  on("profile:changed", () => {
    if (router.currentPage() === "dashboard") {
      const view = document.getElementById("view");
      view.innerHTML = "";
      allPages.find((p) => p.id === "dashboard").render(view);
    }
  });

  await router.start({
    view: document.getElementById("view"),
    title: document.getElementById("page-title"),
    nav: document.getElementById("nav-list"),
  });
}

boot().catch((err) => {
  console.error("[boot] fatal:", err);
  document.getElementById("view").innerHTML = `
    <div class="panel">
      <div class="panel__title">Startup failed</div>
      <p>Tarkov Buddy could not start. If you opened index.html directly
      from the file system, run a local server instead (see README).</p>
      <p style="margin-top:8px;font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">${err.message}</p>
    </div>`;
});

// ===== PWA: offline support via service worker (v0.4) =====
// Registered on secure origins only (https / localhost). The worker is
// network-first, so development against tools/serve.py stays fresh.
// v0.9.1: one-tap-free updates — the page reloads itself exactly once when
// a new worker takes control (skipWaiting is already in sw.js), so a single
// normal reload is all it ever takes to get a new version. We also ask the
// browser to re-check sw.js when the app regains focus, which is when
// phone users actually come back to a PWA.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").then((reg) => {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((err) => {
      console.warn("[pwa] service worker registration failed:", err);
    });

    // controllerchange also fires on the very first claim of an
    // uncontrolled page — only auto-reload on a genuine version takeover.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloaded = false; // guard: exactly one auto-reload per takeover
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || reloaded) return;
      reloaded = true;
      location.reload();
    });
  });
}
