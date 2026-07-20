/**
 * advisor.js — the Coach page (v0.7).
 *
 * Three panels, all powered by the deterministic advisorEngine:
 *   1. Next Best Actions — scored, explained recommendations
 *   2. Session Planner — "I have N minutes" -> ordered raid plan + checklist
 *   3. Ask the Coach — natural-language Q&A via the intent matcher
 *
 * Optional AI fallback (v0.8.30): if an AI assistant is configured in
 * Settings (Claude, Gemini, or a local Ollama model — see js/core/ai.js),
 * free-form questions the matcher can't answer are sent there WITH real
 * profile context, and the model is instructed to reason only from that
 * context. The app is 100% functional without it.
 */
import { el } from "../ui/dom.js";
import { askAI, aiConfigured, aiProviderLabel, buildProfileContext } from "../core/ai.js";
import { getProfile, update } from "../core/store.js";
import { navigate } from "../core/router.js";
import { recommendations, planSession, ask } from "../core/advisorEngine.js";
import { progress } from "../core/questEngine.js";
import { hideoutProgress } from "../core/hideoutEngine.js";

let sessionMinutes = 120;
let chatLog = []; // [{who: "you"|"coach", text}] — session only, not persisted

const KIND_BADGE = { build: "BUILD", raid: "RAID", level: "LEVEL UP", kappa: "KAPPA" };

function recsPanel(profile) {
  const recs = recommendations(profile);
  const list = el("ul", { class: "datalist" });
  for (const r of recs) {
    list.appendChild(el("li", {},
      el("span", { style: "flex:1" },
        el("span", { class: "badge badge--ok", style: "margin-right:10px" }, KIND_BADGE[r.kind] ?? "DO"),
        el("span", { style: "color:var(--text-bright)" }, r.title),
        el("div", { class: "muted", style: "font-size:12px;margin-top:2px" }, r.why)),
      r.page ? el("button", { class: "btn btn--ghost", onclick: () => navigate(r.page) }, "Open") : null));
  }
  if (!recs.length) {
    list.appendChild(el("li", {}, el("span", { class: "muted" },
      "Nothing actionable — set your level in Settings and browse the Quests page.")));
  }
  return el("div", { class: "panel" },
    el("div", { class: "panel__title" }, "Next Best Actions"),
    el("p", { style: "color:var(--text-muted);font-size:12px;margin-bottom:10px" },
      "Scored from your live profile. Every recommendation says why."),
    list);
}

function sessionPanel(profile, rerender) {
  const session = planSession(profile, { minutes: sessionMinutes });
  const body = [];
  session.raids.forEach((r, i) => {
    body.push(el("div", { style: "margin-bottom:10px" },
      el("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
        el("span", { class: "badge badge--brass" }, `RAID ${i + 1}`),
        el("strong", { style: "color:var(--text-bright)" }, r.name),
        el("span", { class: "muted", style: "font-size:11px" }, `~${r.estMinutes} min · risk ${r.risk}/5`),
        r.expectedLoot ? el("span", {
          class: "badge badge--ok",
          title: `Your own average across ${r.expectedLoot.raids} logged raids here — not a prediction`,
        }, `~\u20BD${Math.round(r.expectedLoot.avgLoot).toLocaleString("en-US")} your avg`) : null),
      el("div", { class: "muted", style: "font-size:12px;margin:2px 0 0 2px" }, r.why),
      el("ul", { style: "margin:4px 0 0 16px;font-size:12px;color:var(--text)" },
        ...r.quests.slice(0, 4).map((q) =>
          el("li", {}, `${q.name}${q.kappa ? " ★" : ""}: ${q.objectives.slice(0, 2).join(" · ")}`)))));
  });
  if (session.buildable.length || session.pickups.length) {
    const after = [];
    for (const b of session.buildable) {
      after.push(el("li", {}, b.itemsMissing === 0
        ? `Build ${b.station} L${b.level} — everything collected`
        : `${b.station} L${b.level} — ${b.itemsMissing} item${b.itemsMissing > 1 ? "s" : ""} short`));
    }
    for (const p of session.pickups.slice(0, 3)) {
      after.push(el("li", {}, `Still hunting: ${p.item.name} (${p.have}/${p.needed})`));
    }
    body.push(el("div", {},
      el("strong", { style: "color:var(--text-bright);font-size:13px" }, "After raiding"),
      el("ul", { style: "margin:4px 0 0 16px;font-size:12px;color:var(--text)" }, ...after)));
  }
  if (!body.length) {
    body.push(el("p", { style: "color:var(--text-muted);font-size:13px" }, "No active quests to plan around."));
  }

  return el("div", { class: "panel" },
    el("div", { class: "panel__title" }, "Session Planner"),
    el("div", { style: "display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap" },
      el("span", { class: "muted", style: "font-size:12px" }, "I have"),
      ...[60, 120, 180, 240].map((min) =>
        el("button", {
          class: `btn ${sessionMinutes === min ? "" : "btn--ghost"}`,
          onclick: () => { sessionMinutes = min; rerender(); },
        }, min < 120 ? `${min} min` : `${min / 60} hrs`))),
    ...body);
}

/* ---------- optional local LLM (Layer 8) ---------- */

function coachContext(profile) {
  const p = progress(profile);
  const h = hideoutProgress(profile);
  const session = planSession(profile, { minutes: 120 });
  return [
    `Player: level ${profile.level} ${profile.faction}. Quests ${p.completed}/${p.total}, Kappa ${p.kappaDone}/${p.kappaTotal}. Hideout ${h.built}/${h.total} levels.`,
    `Best raids now: ${session.raids.slice(0, 3).map((r) => `${r.name} (${r.why})`).join("; ") || "none"}.`,
    `Buildable: ${session.buildable.map((b) => `${b.station} L${b.level} (${b.itemsMissing} items short)`).join("; ") || "none"}.`,
  ].join("\n");
}

function chatPanel(profile, rerender) {
  const log = el("div", { style: "max-height:280px;overflow-y:auto;margin-bottom:10px" });
  const renderLog = () => {
    log.innerHTML = "";
    for (const m of chatLog) {
      log.appendChild(el("div", { style: `margin:6px 0;font-size:13px;${m.who === "you" ? "text-align:right" : ""}` },
        el("span", {
          style: m.who === "you"
            ? "display:inline-block;padding:6px 10px;border-radius:8px;background:rgba(170,140,70,.2);color:var(--text-bright)"
            : "display:inline-block;padding:6px 10px;border-radius:8px;background:rgba(255,255,255,.06);color:var(--text);white-space:pre-wrap;text-align:left",
        }, m.text)));
    }
    log.scrollTop = log.scrollHeight;
  };
  renderLog();

  const send = async (question) => {
    if (!question.trim()) return;
    chatLog.push({ who: "you", text: question });
    renderLog();
    const answer = ask(question);
    const isFallback = answer.text.startsWith("I can answer:");
    if (isFallback && await aiConfigured()) {
      const label = await aiProviderLabel();
      chatLog.push({ who: "coach", text: `\u2026thinking (${label})\u2026` });
      renderLog();
      try {
        const llmText = await askAI(question, profile, { context: buildProfileContext(profile) });
        chatLog[chatLog.length - 1] = { who: "coach", text: llmText + `\n(${label})` };
      } catch (err) {
        chatLog[chatLog.length - 1] = { who: "coach",
          text: `${answer.text}\n(AI unreachable: ${err.message})` };
      }
    } else {
      chatLog.push({ who: "coach", text: answer.text });
    }
    renderLog();
  };

  const input = el("input", { type: "text", placeholder: "Ask the coach…", style: "flex:1",
    onkeydown: (e) => { if (e.key === "Enter") { send(e.target.value); e.target.value = ""; } } });

  const presets = ["What should I do tonight?", "Should I sell graphics card?", "How do I reach Mechanic level 3?"];

  return el("div", { class: "panel" },
    el("div", { class: "panel__title" }, "Ask the Coach"),
    el("div", { style: "display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px" },
      ...presets.map((p) => el("button", { class: "btn btn--ghost", style: "font-size:11px",
        onclick: () => send(p) }, p))),
    log,
    el("div", { style: "display:flex;gap:8px" },
      input,
      el("button", { class: "btn", onclick: () => { send(input.value); input.value = ""; } }, "Ask")),
    el("p", { style: "color:var(--text-muted);font-size:11px;margin-top:8px" },
      "Deterministic engine first; unmatched questions go to the AI assistant " +
      "configured in Settings (Claude, Gemini, or a local model). Without one, " +
      "everything above still works fully offline."));
}

export default {
  id: "advisor",
  title: "Coach",
  icon: "coach",
  section: "Overview",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      container.appendChild(el("div", { class: "grid" },
        el("div", { class: "span-2" }, recsPanel(profile)),
        sessionPanel(profile, draw),
        chatPanel(profile, draw)));
    };
    draw();
  },
};
