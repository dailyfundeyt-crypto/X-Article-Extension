/*
 * X to Obsidian – Content Script
 * Fügt in jeden X-Beitrag einen "Obsidian"-Button ein und extrahiert
 * beim Klick den kompletten Beitrag inkl. aller Fotos.
 */
(() => {
  "use strict";

  const BUTTON_CLASS = "x2obs-btn";
  const PROCESSED_ATTR = "data-x2obs";

  /* ---------------------------------------------------------------- Utils */

  function upscaleImageUrl(url) {
    try {
      const u = new URL(url, location.href);
      // twimg-Medien: höchste Auflösung erzwingen
      if (u.hostname.includes("twimg.com") && u.searchParams.has("format")) {
        u.searchParams.set("name", "orig");
        return u.toString();
      }
      // profile_images / sonstige
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function collectImages(article) {
    const urls = new Set();
    // Foto-Medien
    article
      .querySelectorAll('[data-testid="tweetPhoto"] img, [data-testid="tweetPhoto"] image')
      .forEach((img) => {
        const src = img.getAttribute("src") || img.getAttribute("xlink:href");
        if (src && src.includes("twimg.com/media")) urls.add(upscaleImageUrl(src));
      });
    // Video-Poster als Bild mitnehmen
    article.querySelectorAll("video[poster]").forEach((v) => {
      const p = v.getAttribute("poster");
      if (p && p.includes("twimg.com")) urls.add(upscaleImageUrl(p));
    });
    return [...urls];
  }

  function getTweetText(article) {
    const node = article.querySelector('[data-testid="tweetText"]');
    if (!node) return "";
    // Emojis sind <img alt="😀">; alt-Text wieder einsetzen
    let out = "";
    node.childNodes.forEach((n) => (out += nodeToText(n)));
    return out.trim();
  }

  function nodeToText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node;
    if (el.tagName === "IMG") return el.getAttribute("alt") || "";
    if (el.tagName === "BR") return "\n";
    let out = "";
    el.childNodes.forEach((n) => (out += nodeToText(n)));
    return out;
  }

  function getAuthor(article) {
    const nameBlock = article.querySelector('[data-testid="User-Name"]');
    let name = "";
    let handle = "";
    if (nameBlock) {
      const spans = nameBlock.querySelectorAll("span");
      for (const s of spans) {
        const t = s.textContent.trim();
        if (t.startsWith("@") && !handle) handle = t;
        else if (t && !name && !t.startsWith("@") && !t.includes("·")) name = t;
      }
    }
    return { name, handle };
  }

  function getPermalinkAndDate(article) {
    let url = location.href;
    let isoDate = "";
    const timeEl = article.querySelector("time");
    if (timeEl) {
      isoDate = timeEl.getAttribute("datetime") || "";
      const a = timeEl.closest("a");
      if (a && a.href) url = a.href;
    }
    // status-URL bereinigen (Tracking-Parameter entfernen)
    try {
      const u = new URL(url);
      url = `${u.origin}${u.pathname}`;
    } catch (e) {
      /* ignore */
    }
    return { url, isoDate };
  }

  function extractTweet(article) {
    const { name, handle } = getAuthor(article);
    const { url, isoDate } = getPermalinkAndDate(article);
    return {
      text: getTweetText(article),
      authorName: name,
      authorHandle: handle,
      url,
      isoDate,
      images: collectImages(article),
      capturedAt: new Date().toISOString(),
    };
  }

  /* ---------------------------------------------------------------- UI */

  function showToast(message, ok = true) {
    let toast = document.getElementById("x2obs-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "x2obs-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = ok ? "x2obs-ok" : "x2obs-err";
    toast.classList.add("x2obs-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("x2obs-show"), 4000);
  }

  function makeButton(article) {
    const btn = document.createElement("button");
    btn.className = BUTTON_CLASS;
    btn.type = "button";
    btn.title = "In Obsidian speichern";
    btn.setAttribute("aria-label", "In Obsidian speichern");
    btn.innerHTML = obsidianIcon();
    btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      btn.classList.add("x2obs-loading");
      try {
        const tweet = extractTweet(article);
        const res = await chrome.runtime.sendMessage({ type: "SAVE_TWEET", tweet });
        if (res && res.ok) {
          btn.classList.add("x2obs-done");
          showToast(res.message || "In Obsidian gespeichert ✓", true);
        } else {
          showToast((res && res.message) || "Fehler beim Speichern", false);
        }
      } catch (err) {
        showToast("Fehler: " + (err && err.message ? err.message : err), false);
      } finally {
        btn.classList.remove("x2obs-loading");
        setTimeout(() => btn.classList.remove("x2obs-done"), 2000);
      }
    });
    return btn;
  }

  function obsidianIcon() {
    // Download-Icon im nativen X-Stil (Gegenstück zum Teilen-Icon von X)
    return (
      '<svg viewBox="0 0 24 24" width="18.75" height="18.75" aria-hidden="true">' +
      '<g><path fill="currentColor" d="M12 17.41l-5.7-5.7 1.41-1.42L11 13.59V3h2v10.59l3.29-3.3 1.41 1.42-5.7 5.7zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z"/></g>' +
      "</svg>"
    );
  }

  function injectButton(article) {
    if (article.getAttribute(PROCESSED_ATTR)) return;
    article.setAttribute(PROCESSED_ATTR, "1");

    // Aktionsleiste des Tweets finden
    const actionBar = article.querySelector('[role="group"]');
    const btn = makeButton(article);
    if (actionBar) {
      const wrapper = document.createElement("div");
      wrapper.className = "x2obs-wrap";
      const inner = document.createElement("div");
      inner.className = "x2obs-inner";
      inner.appendChild(btn);
      wrapper.appendChild(inner);

      // Direkt neben dem Lesezeichen-(Save-)Button einfügen
      const bookmark = actionBar.querySelector(
        '[data-testid="bookmark"], [data-testid="removeBookmark"]'
      );
      let anchor = null;
      if (bookmark) {
        anchor = bookmark;
        while (anchor.parentElement && anchor.parentElement !== actionBar) {
          anchor = anchor.parentElement;
        }
      }
      if (anchor && anchor.parentElement === actionBar) {
        actionBar.insertBefore(wrapper, anchor.nextSibling);
      } else {
        actionBar.appendChild(wrapper);
      }
    } else {
      // Fallback: oben rechts im Artikel
      btn.classList.add("x2obs-floating");
      article.style.position = article.style.position || "relative";
      article.appendChild(btn);
    }
  }

  function scan(root = document) {
    root.querySelectorAll('article[data-testid="tweet"]').forEach(injectButton);
  }

  /* ---------------------------------------------------------------- Observe */

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== Node.ELEMENT_NODE) return;
        if (n.matches && n.matches('article[data-testid="tweet"]')) injectButton(n);
        else scan(n);
      });
    }
  });

  function start() {
    scan();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Vom Popup angefragt: Haupt-Tweet der aktuellen Seite extrahieren
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "EXTRACT_MAIN_TWEET") {
      const article = document.querySelector('article[data-testid="tweet"]');
      sendResponse({ tweet: article ? extractTweet(article) : null });
      return true;
    }
    if (msg && msg.type === "SHOW_TOAST") {
      showToast(msg.message, msg.ok !== false);
    }
  });

  if (document.body) start();
  else window.addEventListener("DOMContentLoaded", start);
})();
