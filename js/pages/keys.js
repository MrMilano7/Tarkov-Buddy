/**
 * keys.js — Key tracker (v0.8.8).
 *
 * Keys are just items whose category names them as keys/keycards, so the
 * list works from the existing items.json with no importer change.
 * Ownership toggles persist to profile.keysOwned (schema field existed
 * since v0.1, finally used).
 *
 * Quest linkage: quests.json gains an optional `neededKeys` array
 * (importer addition in v0.8.8). If the user's data predates that, the
 * page degrades gracefully and says so rather than pretending there are
 * no key-gated quests.
 */
import { el, roubles, toast } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";
import { getProfile, update } from "../core/store.js";

let textFilter = "";
let view = "all"; // all | owned | needed

function isKeyItem(i) {
  return /key/i.test(i.category || "");
}

/** Map of keyItemId -> [quest names still to do that need it]. */
function questNeeds(profile) {
  const done = new Set(profile.completedQuests ?? []);
  const hidden = new Set(profile.hiddenQuests ?? []);
  const needs = new Map();
  let linked = false;
  for (const q of get("quests")?.quests ?? []) {
    if (q.neededKeys) linked = true;
    if (done.has(q.id) || hidden.has(q.id)) continue;
    for (const k of q.neededKeys ?? []) {
      if (!needs.has(k)) needs.set(k, []);
      needs.get(k).push(q.name);
    }
  }
  return { needs, linked };
}

export default {
  id: "keys",
  title: "Keys",
  icon: "inventory",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      const owned = new Set(profile.keysOwned ?? []);
      const { needs, linked } = questNeeds(profile);

      let keys = (get("items")?.items ?? []).filter(isKeyItem);
      if (view === "owned") keys = keys.filter((k) => owned.has(k.id));
      if (view === "needed") keys = keys.filter((k) => needs.has(k.id));
      if (textFilter) {
        const q = textFilter.toLowerCase();
        keys = keys.filter((k) => k.name.toLowerCase().includes(q));
      }
      keys.sort((a, b) => {
        const na = needs.has(a.id) ? 0 : 1;
        const nb = needs.has(b.id) ? 0 : 1;
        return na - nb || a.name.localeCompare(b.name);
      });

      const viewBtn = (id, label) => el("button", {
        class: `btn ${view === id ? "" : "btn--ghost"}`,
        onclick: () => { view = id; draw(); },
      }, label);

      container.appendChild(el("div", { class: "panel" },
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap;align-items:center" },
          viewBtn("all", "All"),
          viewBtn("owned", `Owned (${owned.size})`),
          viewBtn("needed", "Quest-needed"),
          el("input", {
            type: "search", placeholder: "Filter keys…", value: textFilter,
            style: "flex:1;min-width:150px",
            oninput: (e) => { textFilter = e.target.value; draw(); },
          })),
        !linked ? el("p", { style: "font-size:12px;color:var(--brass);margin:10px 0 0" },
          "Your quest data predates key-linkage. Re-run tools/update_data.py " +
          "to see which quests need which keys.") : null));

      const list = el("ul", { class: "datalist" });
      for (const k of keys.slice(0, 200)) {
        const have = owned.has(k.id);
        const questList = needs.get(k.id);
        const checkbox = el("input", {
          type: "checkbox", checked: have ? "" : null, style: "margin-top:3px",
          onchange: async (e) => {
            const on = e.target.checked;
            await update((p) => {
              const set = new Set(p.keysOwned ?? []);
              on ? set.add(k.id) : set.delete(k.id);
              p.keysOwned = [...set];
            });
            toast(`${k.name} ${on ? "marked owned" : "removed"}.`);
            draw();
          },
        });
        const nameBlock = el("span", {},
          el("span", { style: `color:${have ? "var(--olive)" : "var(--text-bright)"}` }, k.name),
          questList
            ? el("div", { style: `font-size:11px;color:${have ? "var(--text-muted)" : "var(--alert)"}` },
                `needed: ${questList.join(", ")}`)
            : null);
        const label = el("label",
          { style: "display:flex;align-items:flex-start;gap:10px;cursor:pointer" },
          checkbox, nameBlock);
        const price = el("span",
          { class: "muted", style: "text-align:right;font-size:12px;white-space:nowrap" },
          k.avgPrice ? `~${roubles(k.avgPrice)}` : "");
        list.appendChild(el("li", {}, el("span", {}, label), price));
      }
      if (!keys.length) {
        list.appendChild(el("li", {}, el("span", { class: "muted" },
          view === "needed" && linked
            ? "No unfinished quests need keys you can track. Nice."
            : "No keys match.")));
      }
      container.appendChild(el("div", { class: "panel" }, list));
      if (keys.length > 200) {
        container.appendChild(el("p", { class: "muted", style: "font-size:12px" },
          `Showing 200 of ${keys.length} — narrow with the filter.`));
      }
    };
    draw();
  },
};
