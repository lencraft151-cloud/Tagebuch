# Reisearchiv – Urlaubs-Tagebuch

Ein persönliches digitales Reisearchiv als statische Website für **GitHub Pages** –
inklusive Verwaltungsbereich zum Anlegen, Bearbeiten und Veröffentlichen von Urlauben.

* **Öffentliche Website** – Übersicht aller Reisen, Detailseiten mit chronologischen
  Tagebuch-Einträgen, Bildergalerien mit Lightbox, Suche, Jahresfilter, Dark Mode.
* **Verwaltungsbereich** unter `/admin/` – Urlaube anlegen, bearbeiten, duplizieren,
  löschen, veröffentlichen, verstecken, archivieren, Tage sortieren, Bilder hochladen.
* **Kein eigener Server nötig.** Inhalte liegen als JSON im Repository, Bilder im
  Ordner `content/media`. Der Admin-Bereich schreibt direkt über die GitHub-API.

---

## Inhalt

1. [Schnellstart](#schnellstart)
2. [Wie die Speicherung funktioniert](#wie-die-speicherung-funktioniert)
3. [Verwaltungsbereich benutzen](#verwaltungsbereich-benutzen) – [Änderungen veröffentlichen](#änderungen-veröffentlichen)
4. [Veröffentlichungsstatus und Ablaufzeiten](#veröffentlichungsstatus-und-ablaufzeiten)
5. [Wichtig zur Sichtbarkeit](#wichtig-zur-sichtbarkeit)
6. [Website anpassen](#website-anpassen)
7. [Lokal entwickeln](#lokal-entwickeln)
8. [Datenformat](#datenformat)
9. [Eigene Domain](#eigene-domain)
10. [Fehlerbehebung](#fehlerbehebung)
11. [Projektstruktur](#projektstruktur)

---

## Schnellstart

### 1. Code ins Repository bringen

Der Code liegt im Branch dieses Pull Requests. Nach dem Merge nach `main` geht es weiter.

### 2. GitHub Pages

Nichts zu tun – der Workflow schaltet Pages beim ersten Lauf selbst ein
(`enablement: true` bei `actions/configure-pages`) und stellt die Quelle auf
**GitHub Actions**.

> Falls die Organisation das Aktivieren per Workflow untersagt, einmalig manuell:
> **Settings → Pages → Build and deployment → Source: `GitHub Actions`**.

### 3. Ersten Build abwarten

Unter **Actions → „Website bauen und veröffentlichen“** läuft der Workflow automatisch
bei jedem Push auf den **Standard-Branch** des Repositories (egal ob er `main`,
`master` oder anders heißt). Nach etwa einer Minute ist die Seite erreichbar:

```
https://<benutzername>.github.io/<repository>/
```

Für dieses Repository: <https://lencraft151-cloud.github.io/Tagebuch/>

### 4. `site.config.json` anpassen

Titel, Untertitel, Beschreibung und Autor eintragen. `siteUrl` und `basePath` müssen
nur angepasst werden, wenn du **lokal** die richtigen Links sehen willst – im Workflow
werden beide Werte automatisch von GitHub gesetzt.

### 5. Loslegen

Verwaltungsbereich öffnen: `https://<benutzername>.github.io/<repository>/admin/`

PIN eingeben – voreingestellt ist **`151013`**. Mehr braucht es nicht:
kein Token, kein Konto, keine Einrichtung.

---

## Wie die Speicherung funktioniert

GitHub Pages liefert nur statische Dateien aus – es gibt keine Datenbank und keinen
Server, der Formulare entgegennehmen könnte. Deshalb ist **GitHub selbst die
Datenbank**:

```
Verwaltungsbereich (Browser)
        │  liest ohne Anmeldung: raw.githubusercontent.com + data/manifest.json
        │  ändert nur lokal:     IndexedDB dieses Browsers
        │
        │  „Veröffentlichen" → ZIP mit dem Ordner content/
        ▼
GitHub – Hochladen-Seite (dort bist du angemeldet)
        │  Commit
        ▼
Repository:  content/trips/*.json   ← ein JSON je Urlaub
             content/media/*.jpg    ← Bilder (Vollbild + Vorschau)
        │
        ▼
GitHub Actions:  aufräumen  →  prüfen  →  bauen  →  dist/
        │        (führt vorgemerkte Löschungen aus und
        │         entfernt nicht mehr verwendete Bilder)
        ▼
GitHub Pages:  fertige HTML-Seiten, ~1 Minute nach dem Commit live
```

**Warum so?**

| Anforderung | Lösung |
| --- | --- |
| Dauerhafte Speicherung ohne Server | Git-Repository als Datenspeicher – versioniert, mit vollständiger Historie und Wiederherstellung |
| Bilder ablegen | Direkt im Repository unter `content/media`; im Browser vorher auf max. 2000 px verkleinert |
| Verwalten ohne Zugangsschlüssel | Lesen geht ohne Anmeldung (öffentliches Repository); geschrieben wird über die Hochladen-Seite von GitHub, wo du ohnehin angemeldet bist |
| Funktionierende Vorschaubilder beim Teilen | Der Build erzeugt **pro Reise eine echte HTML-Seite** mit Open-Graph-Metadaten – eine reine Single-Page-App könnte das nicht |
| Zeitgesteuerte Veröffentlichung | Sichtbarkeit wird zusätzlich im Browser gegen die aktuelle Uhrzeit geprüft, plus ein Neubau alle 6 Stunden |

**Keine Geheimnisse, nirgends:** Im ausgelieferten Code steht kein Passwort, kein
Token und kein Schlüssel – nur der öffentliche Repository-Name. Es gibt auch
nichts zu hinterlegen: Der Verwaltungsbereich kann von sich aus gar nichts ins
Repository schreiben.

**Bildverkleinerung:** Ein 8-MB-Handyfoto würde das Repository aufblähen und die
Website auf dem Smartphone lahmlegen. Beim Hochladen wird deshalb im Browser
erzeugt: Vollbild (max. 2000 px, JPEG), Vorschau (max. 800 px) und ein winziger
Base64-Platzhalter für den weichen Ladeeffekt.

---

## Verwaltungsbereich benutzen

Erreichbar unter `.../admin/`. **Es gibt bewusst keinen Link dorthin** – normale
Besucher sehen den Bereich nicht. Lege dir ein Lesezeichen an.

### Anmeldung

Der Verwaltungsbereich fragt nur nach einer **PIN** – voreingestellt `151013`.
Kein GitHub-Token, kein Konto, keine Einrichtung.

Das geht, weil der Bereich **nichts schreibt**:

* **Lesen** – GitHub liefert die Dateien öffentlicher Repositories über
  `raw.githubusercontent.com` frei aus, mit CORS-Freigabe. Der Browser holt sich
  die Reisen also direkt, auch Entwürfe. Welche Dateien es gibt, steht in
  `data/manifest.json`, das der Build miterzeugt.
* **Ändern** – alles Bearbeitete bleibt zunächst in der IndexedDB deines
  Browsers. Nichts davon geht ins Netz.
* **Veröffentlichen** – zwei Klicks: ZIP herunterladen, bei GitHub ablegen.

Zur PIN, ehrlich gesagt: Sie ist ein Riegel gegen versehentliches Verstellen,
keine Zugangssperre. Sie schützt kein Geheimnis, denn veröffentlichen kann
ohnehin nur, wer bei GitHub Schreibrechte auf das Repository hat. Im Code steht
nur ein gesalzener SHA-256-Hash, damit die Ziffern nicht offen herumliegen –
eine sechsstellige Zahl ließe sich aber in Sekunden durchprobieren. Verlass dich
also nicht darauf, dass sie jemanden ernsthaft aufhält.

Andere PIN setzen:

```bash
npm run set-pin -- 240719
```

Danach die geänderte `site.config.json` committen.

### Was automatisch aufgeräumt wird

Der Verwaltungsbereich im Browser kann Dateien nur hinzufügen, nicht entfernen.
Alles, was gelöscht gehört, übernimmt deshalb ein Aufräum-Schritt in GitHub
Actions – er läuft bei jedem Build vor dem Bauen:

| Fall | Was passiert |
| --- | --- |
| Urlaub gelöscht | Die Datei wird als `{"deleted": true}` markiert hochgeladen und danach wirklich gelöscht |
| Adresse geändert | Die Datei unter der alten Adresse wird automatisch mitentfernt |
| Bild aus einem Tag entfernt | Wird es von keiner Reise mehr verwendet, verschwindet auch die Datei |

Das Aufräumen wird als eigener Commit von `github-actions[bot]` festgehalten –
in der Historie ist also jederzeit nachvollziehbar (und wiederherstellbar), was
entfernt wurde.

Zwei Dinge dazu:

* Der Build **überspringt markierte Dateien ohnehin**. Selbst wenn das Aufräumen
  einmal scheitert (etwa bei einem geschützten Branch), ist die Website sofort
  korrekt – nur im Repository liegt die Datei dann noch.
* Bilder, die in `content/media` liegen, aber von keiner Reise verwendet werden,
  gelten als verwaist und werden entfernt. Legst du Bilder manuell dort ab, um
  sie später zu verwenden, schalte das ab:

  ```jsonc
  "cleanup": { "unusedMedia": false }
  ```

Von Hand prüfen, was passieren würde:

```bash
npm run cleanup -- --dry-run
```

### Änderungen veröffentlichen

1. Oben rechts auf **Veröffentlichen**.
2. **ZIP herunterladen** – darin liegt der Ordner `content` mit genau den
   geänderten Dateien.
3. ZIP entpacken, **Hochladen-Seite öffnen** und den Ordner `content`
   hineinziehen, dann *Commit changes*.
4. Zurück im Verwaltungsbereich auf **Erledigt** – das verwirft die lokale
   Merkliste.

Nach etwa einer Minute ist alles live. Löschungen und verwaiste Bilder räumt
GitHub Actions dabei von selbst weg.

**Löschen läuft mit.** Hochladen kann keine Datei entfernen – deshalb schreibt
der Verwaltungsbereich stattdessen eine Löschmarkierung. GitHub Actions führt
das Löschen beim nächsten Build wirklich aus und committet das Aufräumen selbst.
Für dich ändert sich nichts: löschen, veröffentlichen, fertig.

> **Achtung:** Die offenen Änderungen liegen nur in **diesem** Browser. Leerst du
> die Browserdaten, bevor du veröffentlicht hast, sind sie weg. Für längere
> Arbeit lieber zwischendurch einmal hochladen.

### Was du dort tun kannst

| Aktion | Wo |
| --- | --- |
| Neuen Urlaub anlegen | Übersicht → **Neuer Urlaub** |
| Bearbeiten | Übersicht → **Bearbeiten** |
| Veröffentlichen / verstecken | Übersicht → **Veröffentlichen** bzw. **Verstecken** |
| Archivieren | Übersicht → Archiv-Symbol |
| Duplizieren | Übersicht → Kopier-Symbol (Kopie wird als Entwurf angelegt) |
| Löschen | Übersicht → Papierkorb (mit Rückfrage) |
| Tage hinzufügen / löschen | Editor → **Tag hinzufügen** bzw. Papierkorb am Tag |
| Reihenfolge der Tage ändern | Pfeiltasten am Tag oder Griff-Symbol zum Ziehen |
| Chronologisch sortieren | Editor → **Sortieren** |
| Bilder hochladen | Editor → Tag aufklappen → Ablagefeld (auch per Drag & Drop) |
| Bildunterschriften | Feld unter jedem Bild |
| Bild als Titelbild setzen | Stern-Symbol auf dem Bild |
| Bilder sortieren / entfernen | Pfeil- und Papierkorb-Symbole auf dem Bild |

Entfernte Bilder werden beim **Speichern** auch als Datei aus dem Repository
gelöscht – aber nur, wenn sie von keiner anderen Reise mehr verwendet werden.
So bleibt das Repository schlank, ohne dass ein noch benötigtes Bild verschwindet.
| Adresse (URL) ändern | Editor → **URL-Kürzel** |

Tastenkürzel: <kbd>Strg</kbd>/<kbd>Cmd</kbd> + <kbd>S</kbd> speichert.

Nach dem Speichern zeigt eine Leiste oben den Status des Website-Builds an.
Die Änderung ist typischerweise nach **etwa einer Minute** öffentlich sichtbar.

---

## Veröffentlichungsstatus und Ablaufzeiten

Jeder Urlaub hat einen **Status**:

| Status | Bedeutung |
| --- | --- |
| **Entwurf** | Wird gar nicht erst auf die Website gebaut. Auch der direkte Link führt ins Leere. |
| **Veröffentlicht** | Erscheint in der Übersicht und ist über den direkten Link erreichbar. |
| **Archiviert** | Nicht mehr in der Übersicht, aber im Bereich „Archiv“ und über den direkten Link. |

Zusätzlich lässt sich pro Urlaub ein **Veröffentlichungszeitraum** setzen:

```
Sichtbar ab:      01.08.2026 12:00
Ausblenden am:    31.08.2026 23:59
Nach Ablauf:      ausblenden  |  ins Archiv verschieben
```

* Vor dem Startzeitpunkt ist der Urlaub für Besucher nicht sichtbar.
* Nach dem Endzeitpunkt wird er automatisch ausgeblendet oder archiviert.
* Ohne Zeitangaben bleibt der Urlaub dauerhaft verfügbar.

Die Zeitpunkte greifen **sofort**, ohne dass ein neuer Build nötig wäre: Die Website
prüft die Sichtbarkeit beim Laden und danach jede Minute erneut gegen die aktuelle
Uhrzeit. Der geplante Neubau alle sechs Stunden hält zusätzlich Sitemap und
Meta-Daten aktuell.

---

## Wichtig zur Sichtbarkeit

Ein Punkt, der bei statischem Hosting oft übersehen wird:

* **Entwürfe** werden nicht mit veröffentlicht – ihr Inhalt landet nie in `dist/`
  und ist über die Website nicht erreichbar.
* **Geplante und archivierte Urlaube** liegen dagegen als fertige HTML-Seite auf dem
  Server, weil sie ja pünktlich erscheinen bzw. per Direktlink erreichbar sein sollen.
  Die Zeitsteuerung ist damit eine **Anzeigelogik, kein Zugriffsschutz**. Wer die
  Adresse errät und den JavaScript-Check umgeht, kann den Inhalt sehen.
* Ist das Repository **öffentlich**, sind ohnehin alle Dateien unter `content/`
  auf GitHub einsehbar – auch Entwürfe.

**Empfehlung:** Alles, was wirklich niemand sehen soll, bleibt **Entwurf**, bis es
so weit ist. Für vertrauliche Inhalte ein **privates Repository** verwenden
(GitHub Pages aus privaten Repositories erfordert einen bezahlten Plan) – der
Verwaltungsbereich funktioniert damit unverändert.

---

## Website anpassen

Alles Wesentliche steht in `site.config.json`:

```jsonc
{
  "title": "Reisearchiv",              // Name der Website
  "tagline": "Unser digitales …",      // kleiner Text unter dem Namen
  "description": "…",                  // Beschreibung für Startseite und Suchmaschinen
  "author": "Lennox",
  "siteUrl": "https://…",              // wird im Workflow automatisch gesetzt
  "basePath": "/Tagebuch/",            // dito
  "repo": {
    "owner": "lencraft151-cloud",
    "name": "Tagebuch",
    "branch": "main",
    "contentDir": "content/trips",
    "mediaDir": "content/media"
  },
  "theme": {
    "defaultMode": "system",           // "system" | "light" | "dark"
    "accent": "#c2683a",               // Akzentfarbe (auch für Icons)
    "useGoogleFonts": true             // false = nur System-Schriften
  },
  "footer": { "note": "…" }
}
```

Farben und Abstände liegen als CSS-Variablen ganz oben in `src/assets/css/site.css`.

### Demo-Inhalte entfernen

Die mitgelieferten Reisen und Bilder sind Beispiele. Zum Aufräumen:

```bash
rm content/trips/*.json
rm content/media/*.png
```

Danach im Verwaltungsbereich den ersten eigenen Urlaub anlegen.

---

## Lokal entwickeln

Voraussetzung: **Node.js 18 oder neuer**. Es gibt keine Abhängigkeiten –
kein `npm install` nötig.

```bash
npm run dev       # baut, startet http://127.0.0.1:4173/Tagebuch/ und beobachtet Dateien
npm run build     # baut einmalig nach dist/
npm run preview   # baut und startet ohne Datei-Beobachtung
npm run check     # prüft alle Inhalte auf Fehler
npm run cleanup   # führt vorgemerkte Löschungen aus (--dry-run zeigt nur an)
npm run set-pin   # setzt die Admin-PIN, z. B.: npm run set-pin -- 240719
npm run clean     # löscht dist/
```

Der Verwaltungsbereich funktioniert auch lokal (`…/admin/`) und schreibt dann
direkt ins echte Repository auf GitHub.

---

## Datenformat

Eine Datei je Urlaub unter `content/trips/<adresse>.json`. Die Dateien lassen sich
auch von Hand bearbeiten – `npm run check` prüft sie anschließend.

```jsonc
{
  "id": "trip-sommer-2026",
  "slug": "sommerurlaub-2026",          // ergibt /reisen/sommerurlaub-2026/
  "title": "Sommerurlaub 2026",
  "location": "Italien",                // optional
  "startDate": "2026-07-12",
  "endDate": "2026-07-26",
  "description": "Fließtext …",         // Absätze mit Leerzeile trennen
  "status": "published",                // draft | published | archived
  "featured": true,                     // groß auf der Startseite hervorheben
  "publishFrom": "",                    // z. B. "2026-08-01T12:00"
  "publishUntil": "",                   // z. B. "2026-08-31T23:59"
  "onExpire": "hide",                   // hide | archive
  "createdAt": "2026-07-27T09:00:00.000Z",
  "updatedAt": "2026-08-02T18:30:00.000Z",

  "coverImage": {
    "id": "img-001",
    "src": "media/strand.jpg",          // relativ zu content/media
    "thumb": "media/strand-thumb.jpg",  // optional
    "alt": "Sonnenuntergang am Meer",
    "caption": "",
    "width": 2000,
    "height": 1333,
    "placeholder": "data:image/jpeg;base64,…"   // optional, weicher Ladeeffekt
  },

  "entries": [
    {
      "id": "e-s1",
      "date": "2026-07-12",
      "time": "18:40",                  // optional
      "title": "Ankunft an der Küste",
      "location": "Sestri Levante",     // optional
      "text": "Absatz eins.\n\nAbsatz zwei.",
      "images": [ /* wie coverImage */ ]
    }
  ]
}
```

Eine Datei mit `{"deleted": true}` ist eine **Löschmarkierung**: Der Build
übergeht sie, der Aufräum-Schritt entfernt sie beim nächsten Lauf.

Im Text sind einfache Auszeichnungen möglich:
`**fett**`, `*kursiv*`, `` `Code` ``, `[Text](https://…)`, `> Zitat`,
`- Aufzählung`, `1. nummeriert`, `## Zwischenüberschrift`.

---

## Eigene Domain

1. Domain unter **Settings → Pages → Custom domain** eintragen.
2. In `site.config.json` ergänzen: `"cname": "reisen.example.com"`
   (oder im Workflow die Umgebungsvariable `SITE_CNAME` setzen).

Der Build legt dann automatisch eine `CNAME`-Datei an; `basePath` wird zu `/`.

---

## Fehlerbehebung

| Problem | Ursache und Lösung |
| --- | --- |
| Workflow bricht mit „Get Pages site failed“ ab | **Settings → Pages → Source** auf **GitHub Actions** stellen |
| Workflow läuft, baut aber nichts | Der Push ging auf einen Nebenzweig. Veröffentlicht wird nur der Standard-Branch (**Settings → Branches**) |
| Website zeigt 404 | Erster Build noch nicht durch, oder `basePath` passt nicht. Im Workflow wird er automatisch gesetzt |
| Bilder und Styles fehlen | Meist ein falscher `basePath`. Lokal muss er zum Ordner passen (`/Tagebuch/`) |
| „PIN falsch“ | Tippfehler – oder die PIN wurde mit `npm run set-pin` geändert |
| Reisen werden nicht geladen | Das Repository muss öffentlich sein (sonst gibt GitHub die Rohdateien nicht heraus) und der erste Build muss durch sein |
| Offene Änderungen sind verschwunden | Sie lagen in der IndexedDB dieses Browsers. Nach dem Leeren der Browserdaten oder in einem privaten Fenster sind sie weg |
| Hochgeladenes ZIP legt Dateien falsch ab | Das ZIP muss **entpackt** und der Ordner `content` hineingezogen werden – nicht das ZIP selbst |
| Gelöschte Reise liegt noch im Repository | Der Aufräum-Schritt konnte nicht pushen (geschützter Branch?). Die Website ist trotzdem korrekt; im Actions-Protokoll steht der Grund |
| Ein Bild wurde ungewollt gelöscht | Es war von keiner Reise verwendet. Über die Commit-Historie wiederherstellen und `cleanup.unusedMedia` auf `false` setzen |
| Änderung nicht sichtbar | Build läuft noch (Statusleiste im Admin) oder Browser-Cache. Einmal hart neu laden |
| Hochgeladenes Bild erscheint nicht sofort | Roh-Dateien von GitHub sind kurz verzögert. Im Editor greift eine lokale Vorschau |
| Ein Urlaub fehlt in der Übersicht | Status prüfen (Entwurf?) und Veröffentlichungszeitraum kontrollieren |

Fehlerhafte Inhalte findest du am schnellsten mit:

```bash
npm run check
```

---

## Projektstruktur

```
.
├── .github/workflows/deploy.yml   Build und Veröffentlichung
├── site.config.json               Zentrale Konfiguration
├── content/
│   ├── trips/*.json               Ein Urlaub je Datei  ← die eigentlichen Daten
│   └── media/                     Bilder (Vollbild + Vorschau)
├── src/
│   ├── build.mjs                  Statischer Generator
│   ├── check-content.mjs          Inhaltsprüfung
│   ├── cleanup.mjs                Löschungen ausführen, verwaiste Bilder entfernen
│   ├── set-pin.mjs                Admin-PIN setzen
│   ├── dev-server.mjs             Lokale Vorschau
│   ├── lib/                       Von Build und Browser gemeinsam genutzt
│   │   ├── trips.mjs              Datenmodell, Sichtbarkeitslogik
│   │   ├── format.mjs             Datums- und Textformatierung
│   │   └── icon.mjs               Icon-Erzeugung (SVG + PNG)
│   ├── templates/                 HTML-Bausteine der öffentlichen Seiten
│   ├── admin/index.html           Gerüst des Verwaltungsbereichs
│   └── assets/
│       ├── css/                   site.css, admin.css
│       └── js/
│           ├── site.js            Suche, Filter, Theme, Navigation
│           ├── lightbox.mjs       Bildansicht
│           └── admin/             Repo-Lesen, lokale Ablage, ZIP, Editor
└── dist/                          Build-Ergebnis (nicht eingecheckt)
```

Die Sichtbarkeitslogik steht bewusst **einmal** in `src/lib/trips.mjs` und wird
sowohl beim Bauen als auch im Browser verwendet – so können Server- und
Client-Sicht nicht auseinanderlaufen.

---

## Lizenz

MIT – siehe `LICENSE`.
