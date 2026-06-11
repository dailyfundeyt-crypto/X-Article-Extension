const DEFAULTS = {
  baseFolder: "X to Obsidian",
  imagesSubfolder: "Bilder",
  embedStyle: "wikilink",
  includeFrontmatter: true,
  addTag: "x",
  aiEnabled: false,
  aiProvider: "openai",
  aiModel: "",
  obsidianDirect: false,
  obsidianUrl: "http://127.0.0.1:27123",
  businessContext: "",
  syncEnabled: true,
  shareAiKey: false,
};

const LOCAL_DEFAULTS = {
  aiApiKey: "",
  obsidianKey: "",
  serverUrl: "",
  serverToken: "",
  serverEmail: "",
};

const $ = (id) => document.getElementById(id);

/* ----------------------------------------------------------- Server-API */

async function api(path, opts = {}) {
  const { serverUrl, serverToken } = await chrome.storage.local.get(LOCAL_DEFAULTS);
  const base = ($("serverUrl").value.trim() || serverUrl).replace(/\/+$/, "");
  if (!base) throw new Error("Bitte zuerst die Server-URL eintragen.");
  const res = await fetch(base + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(serverToken ? { Authorization: `Bearer ${serverToken}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server-Fehler ${res.status}`);
  return data;
}

// Für eigene (nicht-lokale) Server-URLs Host-Berechtigung anfragen
async function ensureOriginPermission(url) {
  try {
    const origin = new URL(url).origin + "/*";
    const has = await chrome.permissions.contains({ origins: [origin] });
    if (!has) {
      const granted = await chrome.permissions.request({ origins: [origin] });
      if (!granted) throw new Error("Berechtigung für die Server-URL abgelehnt");
    }
  } catch (e) {
    if (e.message.includes("Berechtigung")) throw e;
    throw new Error("Ungültige Server-URL");
  }
}

function setAccStatus(msg, ok) {
  const el = $("accStatus");
  el.textContent = msg;
  el.className = "acc-status " + (ok ? "ok" : "err");
}

/* -------------------------------------------------------------- Anzeige */

async function refreshAccountView() {
  const { serverToken, serverEmail } = await chrome.storage.local.get(LOCAL_DEFAULTS);
  const loggedIn = Boolean(serverToken);
  $("accLoggedOut").hidden = loggedIn;
  $("accLoggedIn").hidden = !loggedIn;
  if (loggedIn) $("accWho").textContent = serverEmail || "Konto";
}

/* ------------------------------------------------------- Settings lokal */

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const local = await chrome.storage.local.get(LOCAL_DEFAULTS);
  $("baseFolder").value = s.baseFolder;
  $("imagesSubfolder").value = s.imagesSubfolder;
  $("embedStyle").value = s.embedStyle;
  $("includeFrontmatter").checked = !!s.includeFrontmatter;
  $("addTag").value = s.addTag;
  $("aiEnabled").checked = !!s.aiEnabled;
  $("aiProvider").value = s.aiProvider;
  $("aiModel").value = s.aiModel;
  $("aiApiKey").value = local.aiApiKey;
  $("obsidianDirect").checked = !!s.obsidianDirect;
  $("obsidianUrl").value = s.obsidianUrl;
  $("obsidianKey").value = local.obsidianKey;
  $("businessContext").value = s.businessContext;
  $("syncEnabled").checked = !!s.syncEnabled;
  $("shareAiKey").checked = !!s.shareAiKey;
  $("serverUrl").value = local.serverUrl;
  updatePreview();
  refreshAccountView();
}

function collectSyncSettings() {
  return {
    baseFolder: $("baseFolder").value.trim() || DEFAULTS.baseFolder,
    imagesSubfolder: $("imagesSubfolder").value.trim() || DEFAULTS.imagesSubfolder,
    embedStyle: $("embedStyle").value,
    includeFrontmatter: $("includeFrontmatter").checked,
    addTag: $("addTag").value.trim(),
    aiEnabled: $("aiEnabled").checked,
    aiProvider: $("aiProvider").value,
    aiModel: $("aiModel").value.trim(),
    obsidianDirect: $("obsidianDirect").checked,
    obsidianUrl: $("obsidianUrl").value.trim() || DEFAULTS.obsidianUrl,
    businessContext: $("businessContext").value.trim(),
    syncEnabled: $("syncEnabled").checked,
    shareAiKey: $("shareAiKey").checked,
  };
}

async function save() {
  const data = collectSyncSettings();
  await chrome.storage.sync.set(data);
  await chrome.storage.local.set({
    aiApiKey: $("aiApiKey").value.trim(),
    obsidianKey: $("obsidianKey").value.trim(),
    serverUrl: $("serverUrl").value.trim().replace(/\/+$/, ""),
  });

  // Personalisierung dem Konto folgen lassen
  const { serverToken } = await chrome.storage.local.get(LOCAL_DEFAULTS);
  if (serverToken && data.syncEnabled) {
    try {
      const payload = { ...data };
      if (data.shareAiKey) payload.aiApiKey = $("aiApiKey").value.trim();
      await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      setAccStatus("Einstellungen mit Konto synchronisiert ✓", true);
    } catch (e) {
      setAccStatus("Sync fehlgeschlagen: " + e.message, false);
    }
  }

  const saved = $("saved");
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1800);
}

/* ----------------------------------------------------------------- Konto */

async function authAction(path) {
  try {
    const url = $("serverUrl").value.trim();
    if (!url) return setAccStatus("Bitte zuerst die Server-URL eintragen.", false);
    await ensureOriginPermission(url);
    await chrome.storage.local.set({ serverUrl: url.replace(/\/+$/, "") });
    const data = await api(path, {
      method: "POST",
      body: JSON.stringify({
        email: $("accEmail").value.trim(),
        password: $("accPassword").value,
      }),
    });
    await chrome.storage.local.set({ serverToken: data.token, serverEmail: data.email });

    // Beim Anmelden: Konto-Einstellungen übernehmen (Personalisierung folgt dem Konto)
    try {
      const remote = await api("/api/settings");
      if (remote && Object.keys(remote).length) {
        const known = {};
        for (const k of Object.keys(DEFAULTS)) {
          if (remote[k] !== undefined) known[k] = remote[k];
        }
        await chrome.storage.sync.set(known);
        if (remote.aiApiKey) await chrome.storage.local.set({ aiApiKey: remote.aiApiKey });
      }
    } catch (e) {
      /* erstes Login: noch keine Konto-Einstellungen */
    }

    setAccStatus("Angemeldet ✓", true);
    await load();
  } catch (e) {
    setAccStatus(e.message, false);
  }
}

async function logout() {
  await chrome.storage.local.set({ serverToken: "", serverEmail: "" });
  setAccStatus("Abgemeldet.", true);
  refreshAccountView();
}

async function telegramCode() {
  try {
    const d = await api("/api/telegram/link-code", { method: "POST" });
    $("tgCodeOut").textContent = d.code;
    $("tgCodeOut").hidden = false;
    $("tgHint").hidden = false;
  } catch (e) {
    setAccStatus(e.message, false);
  }
}

/* ------------------------------------------------------------------ Rest */

function updatePreview() {
  $("pvBase").textContent = $("baseFolder").value.trim() || DEFAULTS.baseFolder;
  $("pvImg").textContent = $("imagesSubfolder").value.trim() || DEFAULTS.imagesSubfolder;
}

$("save").addEventListener("click", save);
$("baseFolder").addEventListener("input", updatePreview);
$("imagesSubfolder").addEventListener("input", updatePreview);
$("accLogin").addEventListener("click", () => authAction("/api/auth/login"));
$("accRegister").addEventListener("click", () => authAction("/api/auth/register"));
$("accLogout").addEventListener("click", logout);
$("tgCodeBtn").addEventListener("click", telegramCode);

load();
