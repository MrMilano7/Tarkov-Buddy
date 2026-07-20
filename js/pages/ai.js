/**
 * ai.js — AI Advisor (experimental, v0.8.28).
 *
 * Sends a compact snapshot of REAL profile state (level, faction, active
 * quests, next hideout upgrades, recent raid stats) to the Anthropic API
 * and renders the reply. Honesty rules apply: the model only ever sees
 * data the app actually has — no fabricated metrics go in, and the reply
 * is labeled as AI-generated advice, not the app's own calculation.
 *
 * The API key is the player's own, entered below and stored in the local
 * kv store (NOT the profile — save exports never contain it). Requests go
 * directly from the browser to api.anthropic.com; nothing is proxied.
 */
import { el, toast } from "../ui/dom.js";
import { getProfile } from "../core/store.js";
import { kv } from "../core/db.js";
import { get } from "../core/dataLoader.js";
import { questsByState } from "../core/questEngine.js";
import { allStations, nextLevel, prereqsMet } from "../core/hideoutEngine.js";

const PROVIDERS = {
  anthropic: {
    label: "Anthropic (Claude)",
    keyKv: "anthropicApiKey",
    placeholder: "sk-ant-...",
    hint: "Get one at console.anthropic.com",
    model: "claude-sonnet-4-6",
  },
  gemini: {
    label: "Google (Gemini)",
    keyKv: "geminiApiKey",
    placeholder: "AIza...",
    hint: "Get one at aistudio.google.com",
    model: "gemini-2.5-flash",
  },
};
const PROVIDER_KV = "aiProvider";

let lastReply = null; // survives page switches within a session
let busy = false;

/** Compact, real-data-only context for the model. */
function buildContext(profile) {
  const itemNames = new Map((get("items")?.items ?? []).map((i) => [i.id, i.name]));
  const { active } = questsByState(profile);
  const quests = active.slice(0, 15).map((q) =>
    `- ${q.name} (${q.trader}, map: ${q.map}, objectives: ${q.objectives.slice(0, 2).join("; ")})`);

  const upgrades = [];
  for (const st of allStations()) {
    const lv = nextLevel(profile, st);
    if (!lv || !prereqsMet(profile, lv)) continue;
    const items = (lv.items ?? []).slice(0, 4)
      .map((r) => `${itemNames.get(r.item) ?? r.item} x${r.count}`).join(", ");
    upgrades.push(`- ${st.name} -> L${lv.level}${items ? ` (needs: ${items})` : ""}`);
  }

  const raids = (profile.raidLog ?? []).slice(-10);
  const survived = raids.filter((r) => r.survived).length;
  const raidSummary = raids.length
    ? `${raids.length} recent raids logged, ${survived} survived, maps: ${[...new Set(raids.map((r) => r.mapId))].join(", ")}`
    : "no raids logged yet";

  return [
    `Player: level ${profile.level}, faction ${profile.faction}.`,
    `Recent raids: ${raidSummary}.`,
    `Active quests (up to 15):`, ...quests,
    upgrades.length ? `Buildable hideout upgrades:` : `No hideout upgrades currently buildable.`,
    ...upgrades.slice(0, 10),
  ].join("\n");
}

const SYSTEM_PROMPT =
  "You are a raid advisor inside a personal Escape from Tarkov companion app. " +
  "Base advice ONLY on the player state provided; never invent stats, prices, " +
  "or percentages. Be concise and practical: what to prioritise next and why.";

async function askAnthropic(apiKey, question, context) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: PROVIDERS.anthropic.model,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `API error (HTTP ${res.status})`);
  }
  return (data.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n").trim();
}

async function askGemini(apiKey, question, context) {
  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
    PROVIDERS.gemini.model + ":generateContent";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: `${context}\n\nQuestion: ${question}` }] }],
      generationConfig: { maxOutputTokens: 700 },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `API error (HTTP ${res.status})`);
  }
  return ((data.candidates?.[0]?.content?.parts) ?? [])
    .map((p) => p.text ?? "").join("\n").trim() || "(empty reply)";
}

async function ask(provider, apiKey, question, profile) {
  const context = buildContext(profile);
  return provider === "gemini"
    ? askGemini(apiKey, question, context)
    : askAnthropic(apiKey, question, context);
}

export default {
  id: "ai",
  title: "AI Advisor",
  icon: "advisor",
  section: "Intel",
  render(container) {
    const draw = async () => {
      container.innerHTML = "";
      const profile = getProfile();
      const providerId = (await kv.get(PROVIDER_KV)) ?? "anthropic";
      const provider = PROVIDERS[providerId] ?? PROVIDERS.anthropic;
      const savedKey = (await kv.get(provider.keyKv)) ?? "";

      // --- key panel -----------------------------------------------------
      const providerSelect = el("select", {
        style: "background:var(--bg);color:var(--text-bright);border:1px solid var(--border);" +
          "border-radius:4px;padding:7px 10px;font-size:13px",
        onchange: async (e) => {
          await kv.set(PROVIDER_KV, e.target.value);
          draw(); // re-render with that provider's saved key + hints
        },
      }, ...Object.entries(PROVIDERS).map(([id, pr]) =>
        el("option", { value: id, selected: id === providerId ? "" : null }, pr.label)));

      const keyInput = el("input", {
        type: "password", value: savedKey, placeholder: provider.placeholder,
        autocomplete: "off",
        style: "flex:1;min-width:0;background:var(--bg);color:var(--text-bright);" +
          "border:1px solid var(--border);border-radius:4px;padding:7px 10px;font-size:13px",
      });
      const keyPanel = el("div", { class: "panel" },
        el("div", { class: "panel__title" }, "AI provider & API key"),
        el("div", { style: "display:flex;gap:8px;flex-wrap:wrap" },
          providerSelect,
          keyInput,
          el("button", { class: "btn", onclick: async () => {
            await kv.set(provider.keyKv, keyInput.value.trim());
            toast(keyInput.value.trim() ? `${provider.label} key saved on this device.` : "API key cleared.");
          } }, "Save")),
        el("p", { style: "font-size:11px;color:var(--text-muted);margin:8px 0 0" },
          "Keys are stored only in this browser's local database — never in save " +
          "exports. Requests go straight from this device to the provider and are " +
          `billed to your key. ${provider.hint}. Each provider remembers its own key.`));

      // --- ask panel -----------------------------------------------------
      const output = el("div", { style: "white-space:pre-wrap;font-size:13px;color:var(--text);" +
        "margin-top:12px;display:" + (lastReply ? "block" : "none") }, lastReply ?? "");
      const q = el("textarea", {
        rows: "2", placeholder: "e.g. What should I focus on in my next three raids?",
        style: "width:100%;background:var(--bg);color:var(--text-bright);border:1px solid var(--border);" +
          "border-radius:4px;padding:8px 10px;font-size:13px;resize:vertical",
      });
      const askBtn = el("button", { class: "btn", style: "margin-top:8px", onclick: async () => {
        const provId = (await kv.get(PROVIDER_KV)) ?? "anthropic";
        const prov = PROVIDERS[provId] ?? PROVIDERS.anthropic;
        const apiKey = (await kv.get(prov.keyKv) ?? "").trim();
        if (!apiKey) { toast("Save an API key first.", { error: true }); return; }
        const question = q.value.trim() || "What should I prioritise next?";
        if (busy) return;
        busy = true;
        askBtn.textContent = "Thinking\u2026";
        output.style.display = "block";
        output.textContent = "";
        try {
          const reply = await ask(provId, apiKey, question, getProfile());
          lastReply = reply;
          output.textContent = reply;
        } catch (err) {
          output.textContent = `Request failed: ${err.message}`;
        } finally {
          busy = false;
          askBtn.textContent = "Ask";
        }
      } }, "Ask");

      const askPanel = el("div", { class: "panel" },
        el("div", { class: "panel__title" }, "Ask about your progression"),
        el("p", { style: "font-size:12px;color:var(--text-muted);margin:0 0 10px" },
          "Sends your current level, active quests, buildable hideout upgrades, and " +
          "recent raid log summary as context. Replies are AI-generated suggestions, " +
          "not the app's own calculations."),
        q, askBtn, output);

      container.appendChild(keyPanel);
      container.appendChild(askPanel);
    };
    draw();
  },
};
