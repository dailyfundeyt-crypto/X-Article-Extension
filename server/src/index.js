/*
 * XCapture Server
 *
 * - Konten (Registrieren/Anmelden, JWT) – gleiche Zugangsdaten für
 *   Landing Page und Extension
 * - Settings-Sync (Personalisierung folgt dem Konto)
 * - Artikel-Speicher (die Extension lädt jeden gespeicherten Beitrag hoch)
 * - AI-Aktionen: Umsetzungsplan, Prompt-Weiterleitung an andere KI-Agenten
 * - Telegram-Agent: Benachrichtigung, automatische Ordner-Ablage, Chat
 */
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createUser,
  findUserByEmail,
  findUserById,
  getSettings,
  putSettings,
  insertArticle,
  listArticles,
  getArticle,
  setArticleFolder,
  listFolders,
  createLinkCode,
} from "./db.js";
import { aiConfigFor, chatCompletion, generatePlan, categorizeArticle, AI_PROVIDERS } from "./ai.js";
import { startTelegramBot, notifyNewArticle, telegramEnabled } from "./telegram.js";

const PORT = Number(process.env.PORT || 8787);
const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
  console.error("FEHLER: JWT_SECRET muss gesetzt sein (z. B. in .env / Umgebung).");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "2mb" }));

// CORS – die Extension (chrome-extension://…) und die Landing Page rufen die API auf
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

/* ------------------------------------------------------------------ Auth */

function tokenFor(userId) {
  return jwt.sign({ uid: userId }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Nicht angemeldet" });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).uid;
    next();
  } catch {
    res.status(401).json({ error: "Sitzung abgelaufen – bitte neu anmelden" });
  }
}

app.post("/api/auth/register", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !/.+@.+\..+/.test(email))
    return res.status(400).json({ error: "Gültige E-Mail erforderlich" });
  if (!password || password.length < 8)
    return res.status(400).json({ error: "Passwort: mindestens 8 Zeichen" });
  if (findUserByEmail(email.toLowerCase()))
    return res.status(409).json({ error: "E-Mail bereits registriert" });
  const userId = createUser(email.toLowerCase(), await bcrypt.hash(password, 10));
  res.json({ token: tokenFor(userId), email: email.toLowerCase() });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  const user = email ? findUserByEmail(email.toLowerCase()) : null;
  if (!user || !(await bcrypt.compare(password || "", user.pass_hash)))
    return res.status(401).json({ error: "E-Mail oder Passwort falsch" });
  res.json({ token: tokenFor(user.id), email: user.email });
});

app.get("/api/auth/me", auth, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) return res.status(404).json({ error: "Konto nicht gefunden" });
  res.json({ ...user, telegram: telegramEnabled() });
});

/* -------------------------------------------------------------- Settings */

app.get("/api/settings", auth, (req, res) => {
  res.json(getSettings(req.userId));
});

app.put("/api/settings", auth, (req, res) => {
  const incoming = req.body || {};
  // Vorhandene Einstellungen mit den neuen zusammenführen, damit z. B. ein
  // Client ohne AI-Schlüssel den gespeicherten Schlüssel nicht löscht.
  const merged = { ...getSettings(req.userId), ...incoming };
  putSettings(req.userId, merged);
  res.json({ ok: true });
});

/* -------------------------------------------------------------- Articles */

app.post("/api/articles", auth, async (req, res) => {
  const a = req.body || {};
  if (!a.title && !a.text)
    return res.status(400).json({ error: "Artikel ohne Inhalt" });

  // Automatische Ordner-Ablage per AI (fällt auf "Inbox" zurück)
  const settings = getSettings(req.userId);
  const cfg = aiConfigFor(settings);
  let folder = a.folder || "Inbox";
  if (!a.folder && cfg.apiKey) {
    try {
      const folders = listFolders(req.userId).map((f) => f.folder);
      folder = await categorizeArticle(cfg, a, folders);
    } catch (e) {
      console.warn("Kategorisierung fehlgeschlagen:", e.message);
    }
  }

  const id = insertArticle(req.userId, { ...a, folder });
  const article = getArticle(req.userId, id);
  notifyNewArticle(req.userId, article).catch(() => {});
  res.json({ ok: true, id, folder });
});

app.get("/api/articles", auth, (req, res) => {
  res.json(
    listArticles(req.userId, {
      folder: req.query.folder,
      q: req.query.q,
      limit: Math.min(Number(req.query.limit) || 50, 200),
    })
  );
});

app.get("/api/articles/:id", auth, (req, res) => {
  const article = getArticle(req.userId, Number(req.params.id));
  if (!article) return res.status(404).json({ error: "Nicht gefunden" });
  res.json(article);
});

app.put("/api/articles/:id/folder", auth, (req, res) => {
  setArticleFolder(req.userId, Number(req.params.id), req.body?.folder || "Inbox");
  res.json({ ok: true });
});

app.get("/api/folders", auth, (req, res) => {
  res.json(listFolders(req.userId));
});

/* ------------------------------------------------------------------- AI */

// Umsetzungsplan für einen gespeicherten Artikel (optional mit Unternehmenskontext)
app.post("/api/ai/plan", auth, async (req, res) => {
  const settings = getSettings(req.userId);
  const cfg = aiConfigFor(settings);
  const article = req.body?.articleId
    ? getArticle(req.userId, Number(req.body.articleId))
    : req.body?.article;
  if (!article) return res.status(400).json({ error: "Artikel fehlt" });
  try {
    const plan = await generatePlan(
      cfg,
      article,
      req.body?.context || settings.businessContext || ""
    );
    res.json({ plan });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Prompt an eine andere KI weiterleiten (mit dem hinterlegten API-Schlüssel)
app.post("/api/ai/forward", auth, async (req, res) => {
  const settings = getSettings(req.userId);
  const { prompt, provider, model } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Prompt fehlt" });
  const cfg = aiConfigFor(settings);
  if (provider && AI_PROVIDERS[provider]) cfg.provider = provider;
  if (model) cfg.model = model;
  try {
    const answer = await chatCompletion(cfg, [{ role: "user", content: prompt }]);
    res.json({ answer });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

/* -------------------------------------------------------------- Telegram */

app.post("/api/telegram/link-code", auth, (req, res) => {
  if (!telegramEnabled())
    return res.status(503).json({ error: "Telegram ist auf dem Server nicht konfiguriert" });
  res.json({ code: createLinkCode(req.userId), expiresInMinutes: 10 });
});

/* ------------------------------------------------------------- Web-Seite */

app.use(express.static(join(__dirname, "..", "public")));

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`XCapture-Server läuft auf Port ${PORT}`);
  startTelegramBot();
});
