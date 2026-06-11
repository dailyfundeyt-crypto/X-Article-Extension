import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/xcapture.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    folder TEXT NOT NULL DEFAULT 'Inbox',
    title TEXT NOT NULL,
    author TEXT,
    handle TEXT,
    url TEXT,
    text TEXT,
    images_json TEXT NOT NULL DEFAULT '[]',
    markdown TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_articles_user ON articles(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS telegram_link_codes (
    code TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_chats (
    chat_id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

/* ------------------------------------------------------------------ Users */

export function createUser(email, passHash) {
  const r = db
    .prepare("INSERT INTO users (email, pass_hash) VALUES (?, ?)")
    .run(email, passHash);
  return Number(r.lastInsertRowid);
}

export function findUserByEmail(email) {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email);
}

export function findUserById(id) {
  return db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(id);
}

/* --------------------------------------------------------------- Settings */

export function getSettings(userId) {
  const row = db.prepare("SELECT json FROM settings WHERE user_id = ?").get(userId);
  return row ? JSON.parse(row.json) : {};
}

export function putSettings(userId, obj) {
  db.prepare(
    `INSERT INTO settings (user_id, json, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`
  ).run(userId, JSON.stringify(obj));
}

/* --------------------------------------------------------------- Articles */

export function insertArticle(userId, a) {
  const r = db
    .prepare(
      `INSERT INTO articles (user_id, folder, title, author, handle, url, text, images_json, markdown)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      userId,
      a.folder || "Inbox",
      a.title || "Beitrag",
      a.author || "",
      a.handle || "",
      a.url || "",
      a.text || "",
      JSON.stringify(a.images || []),
      a.markdown || ""
    );
  return Number(r.lastInsertRowid);
}

export function listArticles(userId, { folder, q, limit = 50 } = {}) {
  let sql = "SELECT id, folder, title, author, handle, url, created_at FROM articles WHERE user_id = ?";
  const params = [userId];
  if (folder) {
    sql += " AND folder = ?";
    params.push(folder);
  }
  if (q) {
    sql += " AND (title LIKE ? OR text LIKE ? OR author LIKE ?)";
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function getArticle(userId, id) {
  const row = db
    .prepare("SELECT * FROM articles WHERE user_id = ? AND id = ?")
    .get(userId, id);
  if (row) row.images = JSON.parse(row.images_json || "[]");
  return row;
}

export function setArticleFolder(userId, id, folder) {
  db.prepare("UPDATE articles SET folder = ? WHERE user_id = ? AND id = ?").run(
    folder,
    userId,
    id
  );
}

export function listFolders(userId) {
  return db
    .prepare(
      "SELECT folder, COUNT(*) AS count FROM articles WHERE user_id = ? GROUP BY folder ORDER BY count DESC"
    )
    .all(userId);
}

/* --------------------------------------------------------------- Telegram */

export function createLinkCode(userId) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 10 * 60 * 1000; // 10 Minuten gültig
  db.prepare(
    "INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET user_id = excluded.user_id, expires_at = excluded.expires_at"
  ).run(code, userId, expires);
  return code;
}

export function consumeLinkCode(code) {
  const row = db
    .prepare("SELECT * FROM telegram_link_codes WHERE code = ?")
    .get(String(code).trim());
  if (!row) return null;
  db.prepare("DELETE FROM telegram_link_codes WHERE code = ?").run(row.code);
  if (row.expires_at < Date.now()) return null;
  return row.user_id;
}

export function linkTelegramChat(chatId, userId) {
  db.prepare(
    "INSERT INTO telegram_chats (chat_id, user_id) VALUES (?, ?) ON CONFLICT(chat_id) DO UPDATE SET user_id = excluded.user_id"
  ).run(String(chatId), userId);
}

export function userForChat(chatId) {
  const row = db
    .prepare("SELECT user_id FROM telegram_chats WHERE chat_id = ?")
    .get(String(chatId));
  return row ? row.user_id : null;
}

export function chatsForUser(userId) {
  return db
    .prepare("SELECT chat_id FROM telegram_chats WHERE user_id = ?")
    .all(userId)
    .map((r) => r.chat_id);
}
