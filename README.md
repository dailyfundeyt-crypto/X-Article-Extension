# X to Obsidian

**Landing Page / Download:** Die Projektseite liegt unter [`docs/`](docs/) und
kann über GitHub Pages gehostet werden (Repo-Einstellungen → Pages → Branch
`main`, Ordner `/docs`). Dort gibt es einen Download-Button für die Extension.

Eine Chrome-Erweiterung, mit der du einen Beitrag/Artikel auf **X (Twitter)**
inklusive **aller Fotos** mit einem Klick als fertiges **Obsidian-Paket**
herunterlädst. Du bekommst einen Ordner mit der Markdown-Datei und einem
Unterordner `Bilder`, in dem die Fotos liegen – im Markdown bereits wie in
Obsidian eingebettet. Diesen Ordner kopierst du einfach in deinen Vault und
liest den Artikel dort.

## Was die Erweiterung erzeugt

Pro Beitrag genau **eine ZIP-Datei** (nur ein Download):

```
📁 X to Obsidian/                                     (Basisordner, frei wählbar)
   🗜️ elonmusk - 2026-06-09 - Mein Beitrag.zip       (eine ZIP pro Artikel)
      📁 elonmusk - 2026-06-09 - Mein Beitrag/
         📄 elonmusk - 2026-06-09 - Mein Beitrag.md   (der kopierte Artikel)
         📁 Bilder/                                    (alle Fotos des Artikels)
            🖼️ elonmusk - 2026-06-09 - Mein Beitrag - 01.jpg
            🖼️ elonmusk - 2026-06-09 - Mein Beitrag - 02.jpg
```

ZIP entpacken, den Ordner in den Vault kopieren – fertig.

Im Markdown sind die Bilder als Obsidian-Wikilinks eingebettet
(`![[… - 01.jpg]]`), sodass sie nach dem Kopieren in den Vault sofort
angezeigt werden. Zusätzlich enthält die Notiz optional ein YAML-Frontmatter
mit Autor, Quelle, Datum und Tag.

## Installation

1. Lade dieses Repository herunter bzw. klone es.
2. Öffne in Chrome `chrome://extensions`.
3. Aktiviere oben rechts den **Entwicklermodus**.
4. Klicke auf **„Entpackte Erweiterung laden"** und wähle den Projektordner
   (den Ordner mit der `manifest.json`).
5. Die Erweiterung „X to Obsidian" erscheint nun in der Symbolleiste.

> Die Erweiterung funktioniert auf `x.com` und `twitter.com`.

## Benutzung

**Variante A – direkt am Beitrag:**
Unter jedem Beitrag erscheint in der Aktionsleiste – direkt neben dem
Lesezeichen-(Save-)Button – ein Download-Button im nativen X-Design.
Ein Klick darauf lädt den Beitrag samt Fotos herunter.

**Variante B – über das Popup:**
Öffne einen Beitrag (Status-Seite) und klicke auf das Erweiterungssymbol. Es
erscheint ein minimalistisches Popup im Apple-Stil mit genau zwei Knöpfen:
**Speichern** und **Einstellungen**.

Anschließend findest du die ZIP-Datei in deinem Download-Verzeichnis unter dem
eingestellten Basisordner. ZIP entpacken und den Artikel-Ordner in deinen
Obsidian-Vault kopieren – fertig.

## Einstellungen

Rechtsklick auf das Symbol → **Optionen**, oder im Popup auf
**„Einstellungen öffnen"**:

| Einstellung           | Beschreibung                                                        |
| --------------------- | ------------------------------------------------------------------ |
| **Basisordner**       | Ordner im Download-Verzeichnis, in dem alle Artikel landen.        |
| **Bilder-Unterordner**| Name des Unterordners für die Fotos (Standard: `Bilder`).          |
| **Bild-Einbettung**   | Obsidian-Wikilink `![[…]]` (empfohlen) oder relativer Markdown-Link.|
| **Frontmatter**       | YAML-Kopf mit Autor, Quelle, Datum und Tag ein-/ausschalten.       |
| **Tag**               | Tag, der im Frontmatter gesetzt wird.                              |

## Hinweise

- Fotos werden in höchster verfügbarer Auflösung geladen (`name=orig`).
- Bei Beiträgen mit Video wird das Vorschaubild als Foto gesichert.
- Damit der Download nicht jedes Mal nachfragt, kann in Chrome unter
  `chrome://settings/downloads` die Option „Vor dem Download von Dateien immer
  nachfragen" deaktiviert werden.
- Wikilinks lösen Bilder über den Dateinamen auf – sie funktionieren also auch,
  wenn der Ordner an eine beliebige Stelle im Vault kopiert wird.

## Technik

- Manifest V3, kein zusätzliches Obsidian-Plugin nötig.
- Reine Vanilla-JS-Erweiterung ohne externe Abhängigkeiten.
- Markdown + Bilder werden im Service Worker zu einer ZIP-Datei gepackt
  (eigene minimale ZIP-Implementierung, Store-Methode, UTF-8-Dateinamen) und
  mit einem einzigen Aufruf der `chrome.downloads`-API gespeichert.

### Dateien

| Datei                 | Aufgabe                                                       |
| --------------------- | ------------------------------------------------------------ |
| `manifest.json`       | Erweiterungs-Manifest (MV3).                                 |
| `src/content.js`      | Fügt den ◈-Button ein und liest Beitrag + Fotos aus.         |
| `src/background.js`   | Baut Markdown, lädt Bilder und speichert das Ordner-Paket.   |
| `src/popup.*`         | Popup zum Speichern des aktuellen Beitrags.                  |
| `src/options.*`       | Einstellungsseite.                                           |
| `icons/`              | Symbole der Erweiterung.                                     |
