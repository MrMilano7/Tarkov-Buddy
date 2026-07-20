/**
 * router.js — hash-based router.
 *
 * Pages register themselves as { id, title, icon, section, render }.
 * The router builds the sidebar nav from the registry and renders the
 * matching page into #view on hash change. Hash routing works from any
 * static file server with zero configuration — ideal for offline use.
 */
import { emit } from "./events.js";
import { icon } from "../ui/icons.js";

const pages = new Map();
let current = null;
let viewEl = null;
let titleEl = null;
let navEl = null;

export function register(page) {
  pages.set(page.id, page);
}

export function navigate(pageId) {
  location.hash = `#/${pageId}`;
}

export function currentPage() {
  return current;
}

function parseHash() {
  const id = location.hash.replace(/^#\/?/, "").split("?")[0];
  return pages.has(id) ? id : "dashboard";
}

function buildNav() {
  navEl.innerHTML = "";
  let lastSection = null;

  for (const page of pages.values()) {
    if (page.hidden) continue;

    if (page.section && page.section !== lastSection) {
      const heading = document.createElement("li");
      heading.className = "nav__section";
      heading.textContent = page.section;
      navEl.appendChild(heading);
      lastSection = page.section;
    }

    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "nav__link";
    btn.dataset.pageId = page.id;
    btn.innerHTML = `${icon(page.icon)}<span>${page.title}</span>`;
    btn.addEventListener("click", () => navigate(page.id));
    li.appendChild(btn);
    navEl.appendChild(li);
  }
}

function setActiveNav(pageId) {
  navEl.querySelectorAll(".nav__link").forEach((link) => {
    if (link.dataset.pageId === pageId) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
}

async function render() {
  const id = parseHash();
  const page = pages.get(id);
  current = id;

  titleEl.textContent = page.title;
  document.title = `${page.title} — Tarkov Buddy`;
  setActiveNav(id);

  viewEl.innerHTML = "";
  try {
    await page.render(viewEl);
  } catch (err) {
    console.error(`[router] render of "${id}" failed:`, err);
    viewEl.innerHTML = `<div class="panel"><div class="panel__title">Page error</div>
      <p>This page failed to render. Check the console for details.</p></div>`;
  }

  viewEl.scrollTop = 0;
  emit("route:changed", { pageId: id });
}

export function start({ view, title, nav }) {
  viewEl = view;
  titleEl = title;
  navEl = nav;

  buildNav();
  window.addEventListener("hashchange", render);
  if (!location.hash) location.hash = "#/dashboard";
  return render();
}
