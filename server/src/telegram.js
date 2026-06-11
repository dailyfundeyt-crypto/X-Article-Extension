/*
 * XCapture Telegram-Agent
 *
 * - Verknüpfung per 6-stelligem Code (aus Extension/Konto-Seite)
 * - Benachrichtigt bei neuen Artikeln und legt sie per AI in Ordner ab
 * - /list, /folders, /search, /plan – und freier Chat über die Savings
 */
import {
  consumeLinkCode,
  linkTelegramChat,
  userForChat,
  chatsForUser,
  listArticles,
  listFolders,
  getArticle,
  getSettings,
} from "./db.js";
import { aiConfigFor, generatePlan, chatAboutArticles } from "./ai.js";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const API = `https://api.telegram.org/bot${TOKEN}`;

export const telegramEnabled = () => Boolean(TOKEN);

export async function sendMessage(chatId, text) {
  if (!TOKEN) return;
  // Telegram begrenzt Nachrichten auf 4096 Zeichen
  for (let i = 0; i < text.length; i += 4000) {
    await fetch(`${API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 4000) }),
    }).catch((e) => console.warn("Telegram sendMessage:", e.message));
  }
}

export async function notifyNewArticle(userId, article) {
  const chats = chatsForUser(userId);
  for (const chatId of chats) {
    await sendMessage(
      chatId,
      `📥 Neuer Artikel gespeichert\n\n„${article.title}"\n` +
        `Von: ${article.author || article.handle || "?"}\n` +
        `Ordner: ${article.folder}\n` +
        (article.url ? `Quelle: ${article.url}\n` : "") +
        `\nFrag mich dazu oder nutze /plan ${article.id}`
    );
  }
}

/* ------------------------------------------------------------ Kommandos */

const HELP = [
  "🪨 XCapture-Agent – deine gespeicherten X-Artikel",
  "",
  "/code 123456 – Konto verknüpfen",
  "/list – letzte Artikel",
  "/folders – Ordnerübersicht",
  "/search <Begriff> – Artikel suchen",
  "/plan <Nr> – Umsetzungsplan für einen Artikel",
  "",
  "Oder schreib mir einfach eine Frage zu deinen gespeicherten Artikeln.",
].join("\n");

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  if (!text) return;

  // /start [code] und /code <code>
  const codeMatch = text.match(/^\/(?:start|code)\s*(\d{6})?/);
  if (codeMatch) {
    if (codeMatch[1]) {
      const userId = consumeLinkCode(codeMatch[1]);
      if (userId) {
        linkTelegramChat(chatId, userId);
        await sendMessage(chatId, "✅ Konto verknüpft! " + HELP);
      } else {
        await sendMessage(chatId, "❌ Code ungültig oder abgelaufen. Erzeuge in den XCapture-Einstellungen einen neuen.");
      }
    } else {
      await sendMessage(chatId, HELP);
    }
    return;
  }

  const userId = userForChat(chatId);
  if (!userId) {
    await sendMessage(
      chatId,
      "Bitte verknüpfe zuerst dein Konto: Erzeuge in den XCapture-Einstellungen einen Code und sende ihn mir mit /code 123456"
    );
    return;
  }

  if (text === "/list") {
    const items = listArticles(userId, { limit: 10 });
    if (!items.length) return sendMessage(chatId, "Noch keine Artikel gespeichert.");
    return sendMessage(
      chatId,
      "🗂 Deine letzten Artikel:\n\n" +
        items
          .map((a) => `#${a.id} [${a.folder}] „${a.title}" – ${a.author || a.handle || "?"}`)
          .join("\n")
    );
  }

  if (text === "/folders") {
    const folders = listFolders(userId);
    if (!folders.length) return sendMessage(chatId, "Noch keine Ordner vorhanden.");
    return sendMessage(
      chatId,
      "📁 Deine Ordner:\n\n" + folders.map((f) => `${f.folder} (${f.count})`).join("\n")
    );
  }

  const search = text.match(/^\/search\s+(.+)/);
  if (search) {
    const items = listArticles(userId, { q: search[1], limit: 10 });
    if (!items.length) return sendMessage(chatId, `Nichts gefunden zu „${search[1]}".`);
    return sendMessage(
      chatId,
      `🔎 Treffer zu „${search[1]}":\n\n` +
        items.map((a) => `#${a.id} [${a.folder}] „${a.title}"`).join("\n")
    );
  }

  const plan = text.match(/^\/plan\s+#?(\d+)/);
  if (plan) {
    const article = getArticle(userId, Number(plan[1]));
    if (!article) return sendMessage(chatId, "Artikel nicht gefunden. Nutze /list für die Übersicht.");
    const settings = getSettings(userId);
    const cfg = aiConfigFor(settings);
    if (!cfg.apiKey)
      return sendMessage(chatId, "Kein AI-Schlüssel im Konto. Aktiviere in den XCapture-Einstellungen die Option 'Schlüssel im Konto speichern'.");
    await sendMessage(chatId, "⏳ Erstelle Plan…");
    try {
      const result = await generatePlan(cfg, article, settings.businessContext || "");
      return sendMessage(chatId, `📋 Plan zu „${article.title}":\n\n${result}`);
    } catch (e) {
      return sendMessage(chatId, `❌ AI-Fehler: ${e.message}`);
    }
  }

  if (text === "/help") return sendMessage(chatId, HELP);

  // Freier Chat über die gespeicherten Artikel
  const settings = getSettings(userId);
  const cfg = aiConfigFor(settings);
  if (!cfg.apiKey) {
    return sendMessage(
      chatId,
      "Für den Chat brauche ich einen AI-Schlüssel. Aktiviere in den XCapture-Einstellungen die Option 'Schlüssel im Konto speichern'."
    );
  }
  // Kontext: passende + neueste Artikel
  const matches = listArticles(userId, { q: text.slice(0, 60), limit: 5 });
  const recent = listArticles(userId, { limit: 5 });
  const seen = new Set();
  const context = [...matches, ...recent]
    .filter((a) => !seen.has(a.id) && seen.add(a.id))
    .slice(0, 8)
    .map((a) => getArticle(userId, a.id));
  try {
    const answer = await chatAboutArticles(cfg, text, context);
    await sendMessage(chatId, answer);
  } catch (e) {
    await sendMessage(chatId, `❌ AI-Fehler: ${e.message}`);
  }
}

/* ---------------------------------------------------------- Long Polling */

let offset = 0;
let running = false;

export function startTelegramBot() {
  if (!TOKEN) {
    console.log("Telegram: TELEGRAM_BOT_TOKEN nicht gesetzt – Bot deaktiviert.");
    return;
  }
  if (running) return;
  running = true;
  console.log("Telegram-Agent gestartet (Long Polling).");
  (async function poll() {
    while (running) {
      try {
        const res = await fetch(`${API}/getUpdates?timeout=50&offset=${offset}`, {
          signal: AbortSignal.timeout(60000),
        });
        const data = await res.json();
        if (data.ok) {
          for (const update of data.result) {
            offset = update.update_id + 1;
            if (update.message) {
              handleMessage(update.message).catch((e) =>
                console.warn("Telegram handleMessage:", e.message)
              );
            }
          }
        }
      } catch (e) {
        if (e.name !== "TimeoutError") {
          console.warn("Telegram poll:", e.message);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  })();
}
