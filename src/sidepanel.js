/*
 * XCapture Assistent – AI-Chat im Browser-Side-Panel
 *
 * Modi:
 *  - Allgemein:     direkter Chat mit dem AI-Anbieter (lokaler API-Schlüssel),
 *                   optional mit angehängtem X-Artikel der aktuellen Seite
 *  - Meine Savings: Chat über die im XCapture-Konto gespeicherten Artikel
 *                   (läuft über den Server, wie der Telegram-Agent)
 */

const AI_PROVIDERS = {
  openai: { url: "https://api.openai.com/v1/chat/completions", defaultModel: "gpt-4o-mini" },
  perplexity: { url: "https://api.perplexity.ai/chat/completions", defaultModel: "sonar" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", defaultModel: "openai/gpt-4o-mini" },
};

const $ = (id) => document.getElementById(id);
const messagesEl = $("messages");
const inputEl = $("input");

let history = []; // {role, content}
let articleContext = null; // angehängter X-Artikel
let busy = false;

/* ----------------------------------------------------------------- Utils */

async function getConfig() {
  const sync = await chrome.storage.sync.get({
    aiProvider: "openai",
    aiModel: "",
    businessContext: "",
  });
  const local = await chrome.storage.local.get({
    aiApiKey: "",
    serverUrl: "",
    serverToken: "",
  });
  return { ...sync, ...local };
}

function setHint(msg, isError = false) {
  const el = $("hint");
  el.textContent = msg || "";
  el.className = "hint" + (isError ? " err" : "");
}

function addMsg(role, text, cls = "") {
  $("empty")?.remove();
  const div = document.createElement("div");
  div.className = `msg ${role}${cls ? " " + cls : ""}`;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

/* ------------------------------------------------------------ AI-Aufrufe */

function systemPrompt(cfg) {
  let s =
    "Du bist der XCapture-Assistent in der Browser-Seitenleiste. Antworte " +
    "hilfreich, präzise und auf Deutsch. Halte Antworten kompakt.";
  if (cfg.businessContext) s += ` Unternehmenskontext des Nutzers: ${cfg.businessContext}.`;
  if (articleContext) {
    s +=
      `\n\nDer Nutzer hat folgenden X-Artikel angehängt:\n` +
      `Autor: ${[articleContext.authorName, articleContext.authorHandle].filter(Boolean).join(" ")}\n` +
      `Quelle: ${articleContext.url || "-"}\n` +
      `Text: ${(articleContext.text || "").slice(0, 4000)}`;
  }
  return s;
}

async function askProvider(cfg) {
  if (!cfg.aiApiKey) {
    throw new Error("Kein AI-Schlüssel hinterlegt – in den Einstellungen unter 'KI & Comet' eintragen.");
  }
  const p = AI_PROVIDERS[cfg.aiProvider] || AI_PROVIDERS.openai;
  const res = await fetch(p.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.aiApiKey}`,
    },
    body: JSON.stringify({
      model: cfg.aiModel || p.defaultModel,
      messages: [{ role: "system", content: systemPrompt(cfg) }, ...history.slice(-12)],
      temperature: 0.5,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI-API ${res.status}: ${body.slice(0, 120)}`);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Leere Antwort der AI-API");
  return text;
}

async function askSavings(cfg, question) {
  if (!cfg.serverUrl || !cfg.serverToken) {
    throw new Error("Nicht angemeldet – melde dich in den Einstellungen unter 'Konto & Telegram' an.");
  }
  const res = await fetch(`${cfg.serverUrl.replace(/\/+$/, "")}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.serverToken}`,
    },
    body: JSON.stringify({ question }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Server ${res.status}`);
  return data.answer;
}

/* ----------------------------------------------------------------- Chat */

async function send() {
  const text = inputEl.value.trim();
  if (!text || busy) return;
  busy = true;
  $("send").disabled = true;
  inputEl.value = "";
  autosize();
  setHint("");

  addMsg("user", text);
  history.push({ role: "user", content: text });

  const thinking = addMsg("assistant", "…", "thinking");
  try {
    const cfg = await getConfig();
    const answer =
      $("mode").value === "savings" ? await askSavings(cfg, text) : await askProvider(cfg);
    thinking.remove();
    addMsg("assistant", answer);
    history.push({ role: "assistant", content: answer });
  } catch (e) {
    thinking.remove();
    addMsg("assistant", e.message || String(e), "error");
    history.pop(); // fehlgeschlagene Frage nicht im Verlauf behalten
  } finally {
    busy = false;
    $("send").disabled = false;
    inputEl.focus();
  }
}

/* ----------------------------------------------- Artikel-Kontext anhängen */

async function attachArticle() {
  if (articleContext) {
    clearContext();
    return;
  }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/https:\/\/(x|twitter)\.com\//.test(tab.url || "")) {
      setHint("Öffne zuerst einen Beitrag auf x.com.", true);
      return;
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_MAIN_TWEET" });
    if (!res || !res.tweet) {
      setHint("Kein Beitrag auf der Seite gefunden.", true);
      return;
    }
    articleContext = res.tweet;
    const who = articleContext.authorHandle || articleContext.authorName || "Artikel";
    $("ctxLabel").textContent = `Artikel von ${who} angehängt`;
    $("ctxChip").hidden = false;
    $("attach").classList.add("active");
    setHint("");
  } catch (e) {
    setHint("Seite neu laden und erneut versuchen.", true);
  }
}

function clearContext() {
  articleContext = null;
  $("ctxChip").hidden = true;
  $("attach").classList.remove("active");
}

/* ------------------------------------------------------------------- UI */

function autosize() {
  inputEl.style.height = "auto";
  inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + "px";
}

inputEl.addEventListener("input", autosize);
inputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$("send").addEventListener("click", send);
$("attach").addEventListener("click", attachArticle);
$("ctxRemove").addEventListener("click", clearContext);

$("mode").addEventListener("change", async () => {
  if ($("mode").value === "savings") {
    const cfg = await getConfig();
    if (!cfg.serverToken) {
      setHint("Für 'Meine Savings' zuerst in den Einstellungen anmelden.", true);
    } else {
      setHint("");
    }
  } else {
    setHint("");
  }
});

inputEl.focus();
