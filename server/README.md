# XCapture Server

Backend für die XCapture-Extension: **Konten, Settings-Sync, Artikel-Speicher,
AI-Aktionen und Telegram-Agent.**

## Funktionen

- **Ein Konto für alles:** Registrierung/Anmeldung auf der Konto-Seite und in
  der Extension mit denselben Zugangsdaten (JWT). Einstellungen und
  Personalisierungen folgen dem Konto.
- **Artikel-Speicher:** Die Extension lädt jeden gespeicherten X-Beitrag hoch.
- **AI-Ablage:** Neue Artikel werden per AI automatisch in passende Ordner
  einsortiert (Fallback: `Inbox`).
- **AI-Aktionen:** Umsetzungsplan zu einem Artikel (optional mit
  Unternehmenskontext), Prompt-Weiterleitung an andere KI-Agenten
  (OpenAI / Perplexity / OpenRouter – mit dem im Konto hinterlegten Schlüssel).
- **Telegram-Agent:** benachrichtigt bei neuen Artikeln, legt sie in Ordner ab
  und beantwortet Fragen zu deinen Savings (`/list`, `/folders`, `/search`,
  `/plan`, freier Chat).

## Start

Voraussetzung: Node.js ≥ 22.5 (eingebautes SQLite).

```bash
cd server
npm install
cp .env.example .env   # JWT_SECRET setzen, optional TELEGRAM_BOT_TOKEN
npm start
```

Konto-Seite: `http://localhost:8787` · Health-Check: `GET /healthz`

## Telegram-Bot anlegen

1. In Telegram [@BotFather](https://t.me/botfather) öffnen → `/newbot` →
   Namen vergeben.
2. Den Token in `.env` als `TELEGRAM_BOT_TOKEN` eintragen, Server neu starten.
3. In der Extension (Einstellungen → Konto) oder auf der Konto-Seite einen
   **Verknüpfungscode** erzeugen.
4. Dem Bot `/code 123456` senden – fertig.

## API (Auszug)

| Methode | Pfad | Beschreibung |
| --- | --- | --- |
| POST | `/api/auth/register` | Konto erstellen `{email, password}` |
| POST | `/api/auth/login` | Anmelden → `{token}` |
| GET | `/api/auth/me` | Kontodaten |
| GET/PUT | `/api/settings` | Einstellungen lesen/speichern (Merge) |
| POST | `/api/articles` | Artikel speichern (AI-Ordner-Ablage) |
| GET | `/api/articles?q=&folder=` | Artikel auflisten/suchen |
| POST | `/api/ai/plan` | Umsetzungsplan `{articleId | article, context?}` |
| POST | `/api/ai/forward` | Prompt an andere KI `{prompt, provider?, model?}` |
| POST | `/api/telegram/link-code` | Telegram-Verknüpfungscode erzeugen |

Alle geschützten Endpunkte erwarten `Authorization: Bearer <token>`.

## Deployment

Beliebiger Node-Host (Render, Railway, VPS …). Wichtig:

- `JWT_SECRET` setzen (lange Zufallszeichenkette)
- Persistentes Verzeichnis für `DB_PATH` (SQLite-Datei)
- HTTPS verwenden; die Server-URL dann in den Extension-Einstellungen unter
  „Konto" eintragen
