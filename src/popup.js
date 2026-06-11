const $ = (id) => document.getElementById(id);

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
  try {
    const tab = await getActiveTab();
    if (!tab || !/https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
      setStatus("Bitte einen Beitrag auf x.com öffnen.", false);
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
      setStatus("Kein Beitrag gefunden.", false);
      return;
    }
    setStatus("Speichere…", true);
    const res = await chrome.runtime.sendMessage({ type: "SAVE_TWEET", tweet: extract.tweet });
    if (res && res.ok) {
      if (res.cometPrompt) {
        try {
          await navigator.clipboard.writeText(res.cometPrompt);
          setStatus("Gespeichert ✓ Comet-Prompt kopiert – in Comet einfügen.", true);
        } catch (e) {
          setStatus("Gespeichert ✓ (Prompt-Kopieren fehlgeschlagen)", true);
        }
        setTimeout(() => window.close(), 2200);
      } else {
        setStatus("Gespeichert ✓", true);
        setTimeout(() => window.close(), 1200);
      }
    } else {
      setStatus((res && res.message) || "Fehler beim Speichern.", false);
    }
  } catch (err) {
    setStatus("Fehler: " + (err.message || err), false);
  } finally {
    btn.disabled = false;
  }
}

$("saveCurrent").addEventListener("click", saveCurrent);
$("openOptions").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("openChat").addEventListener("click", async () => {
  const win = await chrome.windows.getCurrent();
  await chrome.sidePanel.open({ windowId: win.id });
  window.close();
});
