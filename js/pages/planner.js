/**
 * planner.js — Raid Planner as its own page (v0.8.16).
 *
 * The planner panel used to sit at the top of the Maps page; it now lives
 * in the RAIDS section as its own destination. The panel itself is
 * unchanged and stays exported from maps.js so there is exactly one
 * implementation.
 */
import { el } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";
import { getProfile } from "../core/store.js";
import { raidPlannerPanel, HIDDEN_VARIANTS } from "./maps.js";
import { hasAccessData } from "../core/mapAccess.js";

export default {
  id: "planner",
  title: "Raid Planner",
  icon: "maps",
  section: "Raids",
  render(container) {
    container.innerHTML = "";
    const maps = (get("maps")?.maps ?? []).filter((m) => !HIDDEN_VARIANTS.has(m.id));
    if (!maps.length) {
      container.appendChild(el("div", { class: "panel" },
        el("p", { style: "color:var(--text-muted)" },
          "No map data. Run the importer: python tools/update_data.py")));
      return;
    }
    container.appendChild(raidPlannerPanel(getProfile(), maps));
    if (!hasAccessData()) {
      container.appendChild(el("p", { style: "font-size:12px;color:var(--brass)" },
        "Map unlock levels aren't in your imported data yet — re-run " +
        "tools/update_data.py so the planner can auto-exclude maps you " +
        "can't enter. Until then, use each map's \"locked in game\" checkbox."));
    }
  },
};
