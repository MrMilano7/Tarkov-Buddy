/**
 * settings.js — profile editing + save management.
 * This page is the visible face of the save system: edit the PMC,
 * export the save as JSON, import a backup, or wipe everything.
 */
import { el, toast } from "../ui/dom.js";
import { getProfile, update, exportProfile, importProfile } from "../core/store.js";
import { destroy } from "../core/db.js";
import { PROVIDERS, getAIConfig, setAIConfig, migrateLegacyLLM } from "../core/ai.js";
import { runImport, storedManifest } from "../core/importer.js";
import { getManifest } from "../core/dataLoader.js";

function panel(title, ...children) {
  return el("section", { class: "panel" },
    el("div", { class: "panel__title" }, title), ...children);
}

function field(labelText, inputEl) {
  return el("div", { class: "field" }, el("label", {}, labelText), inputEl);
}

function profilePanel(profile) {
  const nameInput = el("input", { type: "text", value: profile.name, maxlength: "24" });
  const levelInput = el("input", { type: "number", min: "1", max: "79", value: String(profile.level) });

  const factionSelect = el("select", {},
    ...["USEC", "BEAR"].map((f) =>
      el("option", { value: f, selected: profile.faction === f ? "" : null }, f))
  );

  const editions = [
    ["standard", "Standard"],
    ["leftBehind", "Left Behind"],
    ["prepareForEscape", "Prepare for Escape"],
    ["edgeOfDarkness", "Edge of Darkness"],
    ["unheard", "The Unheard"],
  ];
  const editionSelect = el("select", {},
    ...editions.map(([value, label]) =>
      el("option", { value, selected: profile.edition === value ? "" : null }, label))
  );

  const saveBtn = el("button", {
    class: "btn",
    onclick: async () => {
      const level = Math.min(79, Math.max(1, parseInt(levelInput.value, 10) || 1));
      await update((p) => {
        p.name = nameInput.value.trim() || "PMC";
        p.level = level;
        p.faction = factionSelect.value;
        p.edition = editionSelect.value;
      });
      toast("Profile saved.");
    },
  }, "Save Profile");

  return panel("PMC Profile",
    field("Nickname", nameInput),
    field("Level", levelInput),
    field("Faction", factionSelect),
    field("Game edition", editionSelect),
    saveBtn
  );
}

function savePanel() {
  const exportBtn = el("button", {
    class: "btn",
    onclick: () => {
      const blob = new Blob([exportProfile()], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = el("a", { href: url, download: `tarkov-companion-save-${Date.now()}.json` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("Save exported.");
    },
  }, "Export Save");

  const fileInput = el("input", { type: "file", accept: "application/json", style: "display:none" });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      await importProfile(await file.text());
      toast("Save imported.");
      location.hash = "#/dashboard";
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      fileInput.value = "";
    }
  });
  const importBtn = el("button", { class: "btn btn--ghost", onclick: () => fileInput.click() }, "Import Save");

  const resetBtn = el("button", {
    class: "btn btn--danger",
    onclick: async () => {
      if (!confirm("Delete ALL local data? This cannot be undone. Export a backup first if unsure.")) return;
      await destroy();
      location.reload();
    },
  }, "Reset All Data");

  return panel("Save Data",
    el("p", { style: "margin-bottom:12px;color:var(--text-muted)" },
      "Your progress is stored locally in your browser (IndexedDB). Export a JSON backup before a wipe, reinstall, or browser cleanup."),
    el("div", { style: "display:flex;gap:10px;flex-wrap:wrap" }, exportBtn, importBtn, fileInput, resetBtn)
  );
}

function gameDataPanel() {
  const host = el("section", { class: "panel" },
    el("div", { class: "panel__title" }, "Game Data"));
  (async () => {
    const db = await storedManifest();
    const active = getManifest();
    const status = db
      ? `Browser-imported data from ${db.updatedAt}.`
      : active
        ? `Using data files imported with the Python tool (${active.updatedAt ?? "date unknown"}). Updating here switches to browser-stored data.`
        : "No game data loaded yet.";
    const log = el("pre", { style: "font-size:11px;color:var(--text-muted);white-space:pre-wrap;margin-top:10px;max-height:180px;overflow-y:auto;display:none" });
    const btn = el("button", { class: "btn", onclick: async () => {
      btn.disabled = true; btn.textContent = "Downloading\u2026";
      log.style.display = "block"; log.textContent = "";
      try {
        await runImport((m) => { log.textContent += m + "\n"; log.scrollTop = log.scrollHeight; });
        toast("Game data updated. Reloading\u2026");
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        log.textContent += `Import failed: ${err.message}\n`;
        btn.disabled = false; btn.textContent = "Retry update";
        toast("Game data update failed.", { error: true });
      }
    } }, db || !active ? "Download / update game data" : "Update via browser");
    host.appendChild(el("p", { style: "margin-bottom:12px;color:var(--text-muted)" }, status));
    host.appendChild(btn);
    host.appendChild(log);
    host.appendChild(el("p", { style: "font-size:11px;color:var(--text-muted);margin-top:10px" },
      "Fetches current quests, items, maps, hideout, ammo, crafts, barters, achievements, " +
      "and (from the EFT Wiki, ~30-60s more) story chapters and their quest gates \u2014 " +
      "straight into this browser, no Termux or Python needed. If the wiki step fails, " +
      "everything else still completes; retry any time. Your progress is separate and " +
      "is never touched by a data update."));
  })();
  return host;
}

function aiPanel(profile, rerender) {
  const host = el("section", { class: "panel" },
    el("div", { class: "panel__title" }, "AI Assistant"));
  (async () => {
    await migrateLegacyLLM(profile);
    const cfg = await getAIConfig();
    const provider = PROVIDERS[cfg.provider] ?? PROVIDERS.anthropic;

    const providerSelect = el("select", {
      onchange: async (e) => { await setAIConfig({ provider: e.target.value }); rerender(); },
    }, ...Object.entries(PROVIDERS).map(([id, pr]) =>
      el("option", { value: id, selected: id === cfg.provider ? "" : null }, pr.label)));

    const rows = [field("Provider", providerSelect)];
    let saveFn;
    if (cfg.provider === "ollama") {
      const urlInput = el("input", { type: "text", value: cfg.ollamaUrl, placeholder: "http://localhost:11434" });
      const modelInput = el("input", { type: "text", value: cfg.ollamaModel, placeholder: "llama3.2" });
      rows.push(field("Endpoint URL", urlInput), field("Model", modelInput));
      saveFn = async () => setAIConfig({ ollamaUrl: urlInput.value.trim(), ollamaModel: modelInput.value.trim() });
    } else {
      const keyName = cfg.provider === "gemini" ? "geminiKey" : "anthropicKey";
      const keyInput = el("input", { type: "password", value: cfg[keyName], placeholder: provider.placeholder, autocomplete: "off" });
      rows.push(field("API key", keyInput));
      saveFn = async () => setAIConfig({ [keyName]: keyInput.value.trim() });
    }
    rows.push(
      el("button", { class: "btn", onclick: async () => { await saveFn(); toast("AI settings saved."); } }, "Save AI Settings"),
      el("p", { style: "font-size:11px;color:var(--text-muted);margin-top:10px" },
        "Used by the Coach's free-form chat (and any future AI features) with your real " +
        "progression data as context. Keys and endpoints are stored only in this browser's " +
        "local database — never in save exports. Cloud requests go straight from this " +
        `device to the provider, billed to your key. ${provider.hint}.`));
    for (const r of rows) host.appendChild(r);
  })();
  return host;
}

export default {
  id: "settings",
  title: "Settings",
  icon: "settings",
  section: "System",
  render(container) {
    const draw = () => {
      container.innerHTML = "";
      const profile = getProfile();
      container.appendChild(el("div", { class: "grid" },
        profilePanel(profile),
        savePanel(),
        gameDataPanel(),
        aiPanel(profile, draw)
      ));
    };
    draw();
  },
};
