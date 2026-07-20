/**
 * storyline.js — Story chapter tracker (v0.8.21).
 *
 * Renders data/storyline.json, produced by tools/fetch_storyline.py from
 * the community wiki — the only structured source for the 1.0 story
 * chapters (no game-data API publishes them; verified directly against
 * tarkov.dev). Per-objective checkboxes persist to
 * profile.storylineProgress = { chapterId: [objectiveIndex, ...] }.
 *
 * Wiki content is CC BY-NC-SA: the attribution footer and per-chapter
 * wiki links are a license requirement, not decoration.
 */
import { el, toast } from "../ui/dom.js";
import { get } from "../core/dataLoader.js";
import { getProfile, update } from "../core/store.js";

const openChapters = new Set();

function progressFor(profile, chapterId) {
  return new Set(profile.storylineProgress?.[chapterId] ?? []);
}

export default {
  id: "storyline",
  title: "Storyline",
  icon: "quests",
  section: "Progression",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const data = get("storyline");
      const profile = getProfile();

      if (!data?.chapters?.length) {
        container.appendChild(el("div", { class: "panel" },
          el("p", { style: "color:var(--text-muted)" },
            "The story chapters aren't published by any game-data API — " +
            "they're imported from the community wiki instead. Run:"),
          el("pre", { style: "font-size:12px;color:var(--text-bright)" },
            "python3 tools/fetch_storyline.py"),
          el("p", { style: "font-size:12px;color:var(--text-muted)" },
            "then reload. (Requires internet; separate from the main importer.)")));
        return;
      }

      let doneChapters = 0;
      const cards = data.chapters.map((ch) => {
        const done = progressFor(profile, ch.id);
        const total = ch.objectives.length;
        const complete = total > 0 && done.size >= total;
        if (complete) doneChapters++;
        const open = openChapters.has(ch.id);

        const header = el("div", {
          style: "display:flex;align-items:center;justify-content:space-between;gap:8px;cursor:pointer",
          onclick: () => { open ? openChapters.delete(ch.id) : openChapters.add(ch.id); draw(); },
        },
          el("strong", { style: `color:${complete ? "var(--green)" : "var(--text-bright)"}` },
            `${complete ? "\u2713 " : ""}${ch.name}`),
          el("span", { class: "muted", style: "font-size:12px;white-space:nowrap" },
            total ? `${done.size}/${total}` : "no data", open ? " \u25B4" : " \u25BE"));

        const body = !open ? null : el("div", { style: "margin-top:10px" },
          ...(total ? ch.objectives.map((obj, idx) => el("div", {
            style: "display:flex;align-items:flex-start;gap:6px;padding:4px 0",
          },
            el("label", {
              style: "display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:13px;flex:1",
            },
              el("input", { type: "checkbox", checked: done.has(idx) ? "" : null, style: "margin-top:2px",
                onchange: async (e) => {
                  const on = e.target.checked;
                  await update((p) => {
                    const prog = { ...(p.storylineProgress ?? {}) };
                    const set = new Set(prog[ch.id] ?? []);
                    on ? set.add(idx) : set.delete(idx);
                    prog[ch.id] = [...set];
                    p.storylineProgress = prog;
                  });
                  draw();
                } }),
              el("span", { style: `color:${done.has(idx) ? "var(--text-muted)" : "var(--text-bright)"}` }, obj)),
            // back-fill helper: tick this objective and every one before it
            done.has(idx) ? null : el("button", {
              class: "btn",
              title: "Mark this and all objectives above it as done",
              style: "font-size:10px;padding:2px 6px;white-space:nowrap;flex-shrink:0",
              onclick: async () => {
                await update((p) => {
                  const prog = { ...(p.storylineProgress ?? {}) };
                  const set = new Set(prog[ch.id] ?? []);
                  for (let i = 0; i <= idx; i++) set.add(i);
                  prog[ch.id] = [...set];
                  p.storylineProgress = prog;
                });
                toast(`Marked ${idx + 1} objectives done`);
                draw();
              },
            }, "\u2713 to here")))
          : [el("p", { class: "muted", style: "font-size:12px" },
              ch.note || "No objectives were found for this chapter.")]),
          el("a", { href: ch.wikiUrl, target: "_blank", rel: "noopener",
            style: "font-size:11px;color:var(--brass)" }, "Full walkthrough on the wiki \u2197"));

        return el("section", { class: "panel" }, header, body);
      });

      container.appendChild(el("div", { class: "panel" },
        el("div", { class: "panel__title" },
          `Story chapters \u2014 ${doneChapters}/${data.chapters.length} complete`),
        el("p", { style: "font-size:12px;color:var(--text-muted);margin:6px 0 0" },
          "Tick objectives as you clear them. Chapter completion here is " +
          "your own tracking \u2014 the game doesn't expose story state to any API. " +
          "If a chapter unlocks a map for you, remember to untick that map's " +
          "\u201clocked in game\u201d box on the Maps page.")));
      cards.forEach((c) => container.appendChild(c));

      const attr = data.attribution;
      container.appendChild(el("p", { style: "font-size:11px;color:var(--text-muted)" },
        "Chapter data from the ",
        el("a", { href: attr?.url, target: "_blank", rel: "noopener", style: "color:var(--brass)" },
          attr?.source ?? "Escape from Tarkov Wiki"),
        " \u00B7 ",
        el("a", { href: attr?.licenseUrl, target: "_blank", rel: "noopener", style: "color:var(--text-muted)" },
          attr?.license ?? "CC BY-NC-SA"),
        data.note ? ` \u00B7 ${data.note}` : ""));
    };
    draw();
  },
};
