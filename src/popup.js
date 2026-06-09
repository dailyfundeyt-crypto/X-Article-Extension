const DEFAULTS = {
  baseFolder: "X to Obsidian",
  imagesSubfolder: "Bilder",
};

const $ = (id) => document.getElementById(id);

async function loadInfo() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $("folderInfo").textContent = s.baseFolder || DEFAULTS.baseFolder;
  $("imgInfo").textContent = s.imagesSubfolder || DEFAULTS.imagesSubfolder;
}

function setStatus(message, ok) {
  const el = $("status");
  el.hidden = false;
  el.textContent = message;
  el.className = "status " + (ok ? "ok" : "err");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function saveCurrent() {
  const btn = $("saveCurrent");
  btn.disabled = true;
  btn.textContent = "Speichere…";
  try {
    const tab = await getActiveTab();
    if (!tab || !/https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
      setStatus("Bitte öffne einen Beitrag auf x.com.", false);
      return;
    }
    let extract;
    try {
      extract = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_MAIN_TWEET" });
    } catch (e) {
      setStatus("Seite neu laden und erneut versuchen.", false);
      return;
    }
    if (!extract || !extract.tweet) {
      setStatus("Kein Beitrag auf der Seite gefunden.", false);
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: "SAVE_TWEET", tweet: extract.tweet });
    if (res && res.ok) setStatus(res.message || "Gespeichert ✓", true);
    else setStatus((res && res.message) || "Fehler beim Speichern.", false);
  } catch (err) {
    setStatus("Fehler: " + (err.message || err), false);
  } finally {
    btn.disabled = false;
    btn.textContent = "Aktuellen Beitrag speichern";
  }
}

$("saveCurrent").addEventListener("click", saveCurrent);
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());

loadInfo();
