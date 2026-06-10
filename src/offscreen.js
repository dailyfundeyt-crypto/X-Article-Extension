/*
 * XCapture – Offscreen-Dokument
 * Erstellt aus ZIP-Bytes (Base64) eine Blob-URL, damit auch große Dateien
 * zuverlässig über chrome.downloads heruntergeladen werden können.
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "X2OBS_CREATE_BLOB_URL") {
    try {
      const binary = atob(msg.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(
        new Blob([bytes], { type: msg.mime || "application/zip" })
      );
      sendResponse({ ok: true, url });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
    return true;
  }
});
