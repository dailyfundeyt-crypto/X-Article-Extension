/*
 * X to Obsidian – Background Service Worker
 *
 * Packt einen X-Beitrag als EINE ZIP-Datei (nur ein Download):
 *
 *   <Basisordner>/<Artikel>.zip
 *      └─ <Artikel>/
 *         ├─ <Artikel>.md
 *         └─ <Bilder-Unterordner>/<bild-01.jpg> …
 *
 * Im Markdown sind die Bilder wie in Obsidian eingebettet (![[bild-01.jpg]]).
 * ZIP entpacken, Ordner in den Vault kopieren – fertig.
 */

const DEFAULTS = {
  baseFolder: "X to Obsidian",
  imagesSubfolder: "Bilder",
  embedStyle: "wikilink", // "wikilink" | "markdown"
  includeFrontmatter: true,
  addTag: "x",
  aiEnabled: false,
  aiProvider: "openai", // "openai" | "perplexity" | "openrouter"
  aiModel: "",
};

// OpenAI-kompatible Chat-Completions-Endpunkte
const AI_PROVIDERS = {
  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4o-mini",
  },
  perplexity: {
    url: "https://api.perplexity.ai/chat/completions",
    defaultModel: "sonar",
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    defaultModel: "openai/gpt-4o-mini",
  },
};

/* ----------------------------------------------------------- Einstellungen */

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  // API-Schlüssel bewusst nur lokal (nicht synchronisiert)
  const local = await chrome.storage.local.get({ aiApiKey: "" });
  return { ...DEFAULTS, ...stored, ...local };
}

/* ------------------------------------------------------------------- Utils */

function sanitize(name) {
  return (name || "")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ") // in Datei-/Obsidian-untaugliche Zeichen
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizePathSegment(name) {
  return sanitize(name).replace(/^\.+/, "").slice(0, 120) || "Beitrag";
}

function slugifyTitle(text, max = 60) {
  const t = (text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[\\/:*?"<>|#^[\]\n\r]/g, "")
    .trim();
  return t;
}

function formatDateParts(iso) {
  const d = iso ? new Date(iso) : new Date();
  const dd = isNaN(d.getTime()) ? new Date() : d;
  const pad = (n) => String(n).padStart(2, "0");
  return `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`;
}

function buildArticleFolderName(tweet) {
  const handle = (tweet.authorHandle || "").replace(/^@/, "") || "x";
  const date = formatDateParts(tweet.isoDate || tweet.capturedAt);
  const title = slugifyTitle(tweet.text, 40);
  const parts = [handle, date];
  if (title) parts.push(title);
  return sanitizePathSegment(parts.join(" - "));
}

function extFromUrlOrType(url, contentType) {
  try {
    const u = new URL(url);
    const fmt = u.searchParams.get("format");
    if (fmt) return fmt.toLowerCase().replace("jpeg", "jpg");
  } catch (e) {
    /* ignore */
  }
  if (contentType) {
    const map = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
    };
    const key = contentType.split(";")[0].trim();
    if (map[key]) return map[key];
  }
  return "jpg";
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/* ----------------------------------------------------------------- ZIP */
/* Minimale ZIP-Implementierung (Store-Methode, UTF-8-Dateinamen). */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

// entries: [{ name: "pfad/datei.ext", data: Uint8Array }]
function buildZip(entries) {
  const encoder = new TextEncoder();
  const { time, date } = dosDateTime();
  const parts = [];
  const centralParts = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = encoder.encode(e.name);
    const data = e.data;
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flags: UTF-8
    lv.setUint16(8, 0, true); // method: store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    parts.push(local, data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true); // flags: UTF-8
    cv.setUint16(10, 0, true); // method: store
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true); // local header offset
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length + data.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const all = [...parts, ...centralParts, eocd];
  const total = all.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of all) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/* --------------------------------------------------------------- Downloads */

function download(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
}

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) return false;
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: "src/offscreen.html",
        reasons: ["BLOBS"],
        justification:
          "ZIP-Datei als Blob-URL bereitstellen, damit große Downloads zuverlässig funktionieren",
      });
    }
    return true;
  } catch (e) {
    console.warn("Offscreen-Dokument nicht verfügbar:", e);
    return false;
  }
}

// Lädt die ZIP herunter – bevorzugt über eine Blob-URL (Offscreen-Dokument,
// robust bei großen Dateien), mit Data-URL als Fallback.
async function downloadZip(zipBytes, filename) {
  const base64 = bytesToBase64(zipBytes);

  try {
    if (await ensureOffscreenDocument()) {
      const res = await chrome.runtime.sendMessage({
        type: "X2OBS_CREATE_BLOB_URL",
        base64,
        mime: "application/zip",
      });
      if (res && res.ok && res.url) {
        await download({
          url: res.url,
          filename,
          conflictAction: "uniquify",
          saveAs: false,
        });
        return;
      }
    }
  } catch (e) {
    console.warn("Blob-Download fehlgeschlagen, nutze Data-URL:", e);
  }

  await download({
    url: `data:application/zip;base64,${base64}`,
    filename,
    conflictAction: "uniquify",
    saveAs: false,
  });
}

async function fetchImage(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), ext: extFromUrlOrType(url, contentType) };
}

/* --------------------------------------------------------------- Markdown */

function buildMarkdown(tweet, settings, imageFiles) {
  const lines = [];
  const author = [tweet.authorName, tweet.authorHandle].filter(Boolean).join(" ");

  if (settings.includeFrontmatter) {
    lines.push("---");
    if (tweet.authorName) lines.push(`title: "${tweet.authorName.replace(/"/g, "'")}"`);
    if (author) lines.push(`author: "${author.replace(/"/g, "'")}"`);
    if (tweet.url) lines.push(`source: ${tweet.url}`);
    if (tweet.isoDate) lines.push(`date: ${tweet.isoDate}`);
    lines.push(`captured: ${tweet.capturedAt}`);
    if (settings.addTag) lines.push(`tags:\n  - ${settings.addTag}`);
    lines.push("---");
    lines.push("");
  }

  if (author) lines.push(`## ${author}`);
  lines.push("");

  if (tweet.text) {
    lines.push(tweet.text);
    lines.push("");
  }

  for (const f of imageFiles) {
    if (settings.embedStyle === "markdown") {
      lines.push(`![](${encodeURI(settings.imagesSubfolder + "/" + f)})`);
    } else {
      // Obsidian-Wikilink (Auflösung per Dateiname, robust beim Kopieren)
      lines.push(`![[${f}]]`);
    }
    lines.push("");
  }

  if (tweet.url) {
    lines.push(`> [!info] Quelle`);
    lines.push(`> [Originalbeitrag auf X](${tweet.url})`);
    lines.push("");
  }

  return lines.join("\n");
}

/* ------------------------------------------------------------- AI / Comet */

async function generateActionList(tweet, settings) {
  const provider = AI_PROVIDERS[settings.aiProvider] || AI_PROVIDERS.openai;
  const model = (settings.aiModel || "").trim() || provider.defaultModel;

  const system =
    "Du bist ein präziser Produktivitäts-Assistent. Der Nutzer hat gerade einen " +
    "Beitrag auf X (Twitter) gelesen und gespeichert. Erstelle eine kurze, " +
    "nummerierte Aktionsliste (3 bis 7 Punkte) mit konkreten nächsten Schritten, " +
    "die ein KI-Browser-Assistent (Comet) direkt ausführen kann – z. B. Themen " +
    "recherchieren, Quellen prüfen, Seiten öffnen, vergleichen, zusammenfassen, " +
    "Entwürfe schreiben. Formuliere jeden Punkt als klare Anweisung. Antworte " +
    "ausschließlich mit der nummerierten Liste auf Deutsch, ohne Einleitung.";

  const user =
    `Autor: ${[tweet.authorName, tweet.authorHandle].filter(Boolean).join(" ")}\n` +
    `Quelle: ${tweet.url || "-"}\n\n` +
    `Beitrag:\n${(tweet.text || "").slice(0, 4000)}`;

  const res = await fetch(provider.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.aiApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.4,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI-API ${res.status}: ${body.slice(0, 140)}`);
  }
  const data = await res.json();
  const text =
    data && data.choices && data.choices[0] && data.choices[0].message
      ? (data.choices[0].message.content || "").trim()
      : "";
  if (!text) throw new Error("Leere Antwort der AI-API");
  return text;
}

function buildCometPrompt(tweet, actionList) {
  const author = [tweet.authorName, tweet.authorHandle].filter(Boolean).join(" ");
  return [
    "Du bist der Assistent im Comet-Browser.",
    "",
    "Bevor du beginnst: Sage mir in 2–3 Sätzen kurz, was du gleich tun wirst",
    "und was ich selbst übernehmen muss. Arbeite danach die folgende",
    "Aktionsliste Schritt für Schritt ab und melde dich nach jedem Schritt kurz.",
    "",
    "## Aktionsliste",
    actionList,
    "",
    "## Kontext (gespeicherter X-Beitrag)",
    author ? `Autor: ${author}` : null,
    tweet.url ? `Quelle: ${tweet.url}` : null,
    "",
    "Beitrag:",
    (tweet.text || "").slice(0, 4000),
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/* ------------------------------------------------------------------ Save */

async function saveTweet(tweet) {
  if (!tweet) throw new Error("Kein Beitrag gefunden");
  const settings = await getSettings();

  const folderName = buildArticleFolderName(tweet);
  const noteName = folderName;
  const base = sanitizePathSegment(settings.baseFolder) || "X to Obsidian";
  const imgDir = sanitize(settings.imagesSubfolder) || "Bilder";

  // 1) Bilder laden
  const imageEntries = [];
  const imageFiles = [];
  let failed = 0;
  for (let i = 0; i < tweet.images.length; i++) {
    try {
      const { bytes, ext } = await fetchImage(tweet.images[i]);
      const filename = `${noteName} - ${String(i + 1).padStart(2, "0")}.${ext}`;
      imageEntries.push({ name: `${folderName}/${imgDir}/${filename}`, data: bytes });
      imageFiles.push(filename);
    } catch (e) {
      failed++;
      console.warn("Bild konnte nicht geladen werden:", tweet.images[i], e);
    }
  }

  // 2) Markdown erstellen
  const markdown = buildMarkdown(tweet, settings, imageFiles);
  const mdEntry = {
    name: `${folderName}/${noteName}.md`,
    data: new TextEncoder().encode(markdown),
  };

  // 3) Alles in EINE ZIP-Datei packen und einmal herunterladen
  const zipBytes = buildZip([mdEntry, ...imageEntries]);
  await downloadZip(zipBytes, `${base}/${folderName}.zip`);

  let message = `Gespeichert: „${folderName}.zip"`;
  if (imageFiles.length) {
    message += ` (${imageFiles.length} Bild${imageFiles.length === 1 ? "" : "er"})`;
  }
  if (failed) message += ` – ${failed} Bild(er) fehlgeschlagen`;

  // 4) Optional: AI-Aktionsliste erzeugen und als Comet-Prompt mitliefern
  let cometPrompt = null;
  if (settings.aiEnabled && settings.aiApiKey) {
    try {
      const list = await generateActionList(tweet, settings);
      cometPrompt = buildCometPrompt(tweet, list);
    } catch (e) {
      console.warn("AI-Aktionsliste fehlgeschlagen:", e);
      message += ` – AI-Liste fehlgeschlagen (${e.message || e})`;
    }
  }

  return {
    ok: true,
    message,
    zip: `${base}/${folderName}.zip`,
    images: imageFiles.length,
    failed,
    cometPrompt,
  };
}

/* --------------------------------------------------------------- Messaging */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "SAVE_TWEET") {
    saveTweet(msg.tweet)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, message: err.message || String(err) }));
    return true; // asynchron
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  // Standardwerte initialisieren, falls noch nicht gesetzt
  const current = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  const toSet = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (current[k] === undefined) toSet[k] = v;
  }
  if (Object.keys(toSet).length) await chrome.storage.sync.set(toSet);
});
