/*
 * X to Obsidian – Background Service Worker
 *
 * Lädt einen X-Beitrag als fertiges Obsidian-"Paket" herunter:
 *
 *   <Basisordner>/<Artikel-Ordner>/<Artikel>.md
 *   <Basisordner>/<Artikel-Ordner>/<Bilder-Unterordner>/<bild-1.jpg> ...
 *
 * Im Markdown werden die Bilder wie in Obsidian eingebettet (![[bild-1.jpg]]),
 * sodass der komplette Ordner einfach in den Vault kopiert werden kann.
 */

const DEFAULTS = {
  baseFolder: "X to Obsidian",
  imagesSubfolder: "Bilder",
  embedStyle: "wikilink", // "wikilink" | "markdown"
  includeFrontmatter: true,
  addTag: "x",
};

/* ----------------------------------------------------------- Einstellungen */

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...stored };
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
  const valid = !isNaN(d.getTime());
  const dd = valid ? d : new Date();
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

function buildNoteName(tweet, folderName) {
  // Notiz-Dateiname identisch zum Ordnernamen für einfache Lesbarkeit
  return sanitizePathSegment(folderName);
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
    if (map[contentType.split(";")[0].trim()]) return map[contentType.split(";")[0].trim()];
  }
  return "jpg";
}

function arrayBufferToDataUrl(buf, mime) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime || "application/octet-stream"};base64,${btoa(binary)}`;
}

function textToDataUrl(text) {
  // UTF-8-sichere Kodierung
  const utf8 = new TextEncoder().encode(text);
  return arrayBufferToDataUrl(utf8.buffer, "text/markdown;charset=utf-8");
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

async function fetchImage(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  const buf = await res.arrayBuffer();
  const ext = extFromUrlOrType(url, contentType);
  const mime = contentType.split(";")[0].trim() || `image/${ext === "jpg" ? "jpeg" : ext}`;
  return { dataUrl: arrayBufferToDataUrl(buf, mime), ext };
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

/* ------------------------------------------------------------------ Save */

async function saveTweet(tweet) {
  if (!tweet) throw new Error("Kein Beitrag gefunden");
  const settings = await getSettings();

  const folderName = buildArticleFolderName(tweet);
  const noteName = buildNoteName(tweet, folderName);
  const base = sanitizePathSegment(settings.baseFolder) || "X to Obsidian";
  const imgDir = sanitize(settings.imagesSubfolder) || "Bilder";

  const articlePath = `${base}/${folderName}`;

  // 1) Bilder laden und herunterladen
  const imageFiles = [];
  let failed = 0;
  for (let i = 0; i < tweet.images.length; i++) {
    const url = tweet.images[i];
    try {
      const { dataUrl, ext } = await fetchImage(url);
      const filename = `${noteName} - ${String(i + 1).padStart(2, "0")}.${ext}`;
      await download({
        url: dataUrl,
        filename: `${articlePath}/${imgDir}/${filename}`,
        conflictAction: "uniquify",
        saveAs: false,
      });
      imageFiles.push(filename);
    } catch (e) {
      failed++;
      console.warn("Bild konnte nicht geladen werden:", url, e);
    }
  }

  // 2) Markdown erstellen und herunterladen
  const markdown = buildMarkdown(tweet, settings, imageFiles);
  await download({
    url: textToDataUrl(markdown),
    filename: `${articlePath}/${noteName}.md`,
    conflictAction: "uniquify",
    saveAs: false,
  });

  let message = `Gespeichert: „${folderName}"`;
  if (imageFiles.length) message += ` (${imageFiles.length} Bild${imageFiles.length === 1 ? "" : "er"})`;
  if (failed) message += ` – ${failed} Bild(er) fehlgeschlagen`;
  return { ok: true, message, folder: articlePath, images: imageFiles.length, failed };
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
