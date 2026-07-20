/**
 * ai.js — shared AI backend (v0.8.30).
 *
 * ONE configuration (Settings page), ANY consumer: the Coach chat uses it
 * today; any future feature can `import { askAI, aiConfigured }` and get
 * the same provider the player picked. Providers:
 *   anthropic — Claude via api.anthropic.com (player's own key)
 *   gemini    — Gemini via generativelanguage.googleapis.com (player's key)
 *   ollama    — a local model, e.g. Ollama in Termux (URL + model name);
 *               absorbs the old profile.settings.llmUrl option
 *
 * Keys/config live in the kv store, NOT the profile — save exports never
 * contain them. Honesty rules ride in the system prompt: the model is told
 * to use ONLY the provided context and never invent stats or prices.
 */
import { kv } from "./db.js";
import { get } from "./dataLoader.js";
import { questsByState } from "./questEngine.js";
import { allStations, nextLevel, prereqsMet } from "./hideoutEngine.js";

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", model: "claude-sonnet-4-6",
    keyKv: "anthropicApiKey", placeholder: "sk-ant-...", hint: "Get a key at console.anthropic.com" },
  gemini: { label: "Google (Gemini)", model: "gemini-2.5-flash",
    keyKv: "geminiApiKey", placeholder: "AIza...", hint: "Get a key at aistudio.google.com" },
  ollama: { label: "Local model (Ollama)", model: null,
    keyKv: null, placeholder: "", hint: "Termux: pkg install ollama; OLLAMA_ORIGINS=\"*\" ollama serve" },
};

const SYSTEM_PROMPT =
  "You are a concise Escape from Tarkov progression coach inside a personal " +
  "companion app. Base advice ONLY on the player state provided — your training " +
  "data about post-1.0 Tarkov is unreliable, and you must never invent stats, " +
  "prices, or percentages. If the context doesn't cover the question, say so. " +
  "Be practical: what to prioritise next and why, in a few sentences.";

/* ---------- config ---------- */

export async function getAIConfig() {
  const provider = (await kv.get("aiProvider")) ?? "anthropic";
  return {
    provider,
    anthropicKey: (await kv.get("anthropicApiKey")) ?? "",
    geminiKey: (await kv.get("geminiApiKey")) ?? "",
    ollamaUrl: (await kv.get("ollamaUrl")) ?? "",
    ollamaModel: (await kv.get("ollamaModel")) ?? "",
  };
}

export async function setAIConfig(patch) {
  const map = { provider: "aiProvider", anthropicKey: "anthropicApiKey",
    geminiKey: "geminiApiKey", ollamaUrl: "ollamaUrl", ollamaModel: "ollamaModel" };
  for (const [k, kvKey] of Object.entries(map)) {
    if (patch[k] !== undefined) await kv.set(kvKey, patch[k]);
  }
}

/** True when the selected provider has what it needs to answer. */
export async function aiConfigured() {
  const c = await getAIConfig();
  if (c.provider === "anthropic") return !!c.anthropicKey.trim();
  if (c.provider === "gemini") return !!c.geminiKey.trim();
  if (c.provider === "ollama") return !!c.ollamaUrl.trim();
  return false;
}

/** One-time migration from the old Coach page setting (profile.settings.llmUrl). */
export async function migrateLegacyLLM(profile) {
  const existing = await kv.get("ollamaUrl");
  if (existing || !profile?.settings?.llmUrl) return;
  await setAIConfig({
    provider: "ollama",
    ollamaUrl: profile.settings.llmUrl,
    ollamaModel: profile.settings.llmModel || "llama3.2",
  });
}

/* ---------- context (real data only) ---------- */

export function buildProfileContext(profile) {
  const itemNames = new Map((get("items")?.items ?? []).map((i) => [i.id, i.name]));
  const { active } = questsByState(profile);
  const quests = active.slice(0, 15).map((q) =>
    `- ${q.name} (${q.trader}, map: ${q.map})`);

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
    ? `${raids.length} recent raids, ${survived} survived, maps: ${[...new Set(raids.map((r) => r.mapId))].join(", ")}`
    : "no raids logged yet";

  return [
    `Player: level ${profile.level}, faction ${profile.faction}.`,
    `Recent raids: ${raidSummary}.`,
    quests.length ? "Active quests (up to 15):" : "No active quests.",
    ...quests,
    upgrades.length ? "Buildable hideout upgrades:" : "No hideout upgrades currently buildable.",
    ...upgrades.slice(0, 10),
  ].join("\n");
}

/* ---------- backends ---------- */

async function askAnthropic(key, prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: PROVIDERS.anthropic.model, max_tokens: 700,
      system: SYSTEM_PROMPT, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `API error (HTTP ${res.status})`);
  return (data.content ?? []).map((c) => (c.type === "text" ? c.text : "")).join("\n").trim();
}

async function askGemini(key, prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${PROVIDERS.gemini.model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 700 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `API error (HTTP ${res.status})`);
  return ((data.candidates?.[0]?.content?.parts) ?? [])
    .map((p) => p.text ?? "").join("\n").trim() || "(empty reply)";
}

async function askOllama(url, model, prompt) {
  const res = await fetch(url.replace(/\/$/, "") + "/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: model || "llama3.2",
      prompt: `${SYSTEM_PROMPT}\n\n${prompt}`, stream: false }),
  });
  if (!res.ok) throw new Error(`LLM endpoint HTTP ${res.status}`);
  const data = await res.json();
  return data.response ?? "(empty response)";
}

/**
 * Ask the configured provider. `context` defaults to the standard profile
 * snapshot; pass your own string to give a feature-specific context.
 */
export async function askAI(question, profile, { context = null } = {}) {
  const c = await getAIConfig();
  const prompt = `Context:\n${context ?? buildProfileContext(profile)}\n\nQuestion: ${question}`;
  if (c.provider === "gemini") return askGemini(c.geminiKey.trim(), prompt);
  if (c.provider === "ollama") return askOllama(c.ollamaUrl.trim(), c.ollamaModel.trim(), prompt);
  return askAnthropic(c.anthropicKey.trim(), prompt);
}

/** Short label for the active provider, for UI hints. */
export async function aiProviderLabel() {
  const c = await getAIConfig();
  return PROVIDERS[c.provider]?.label ?? c.provider;
}
