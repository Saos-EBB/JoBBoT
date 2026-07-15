# HANDOFF — Gmail-Anbindung (Drafts / Direktversand)

Stand: 2026-07-08. Ergebnis einer Grilling-Session, noch nicht implementiert.
Ziel: Aus der UI heraus für einen Job entweder (a) einen fertigen, sendebereiten
Gmail-Entwurf per Klick erzeugen, oder (b) die Bewerbung direkt aus der UI über
Gmail verschicken.

## Entschiedene Punkte

### 1. Auth: SMTP + IMAP mit Gmail App-Passwort (nicht OAuth)

- Kein Google-Cloud-Projekt, keine OAuth-Consent-Screen, kein Token-Refresh.
- Voraussetzung: 2-Step-Verification an, App-Passwort unter
  `myaccount.google.com/apppasswords` erzeugen (im normalen Security-Menü
  nicht mehr verlinkt, Google hat den Link versteckt).
- Versand: SMTP (`smtp.gmail.com:465`) über `nodemailer` — landet automatisch
  im eigenen Gmail-Sent-Ordner.
- Entwurf erzeugen: IMAP `APPEND` auf `[Gmail]/Drafts` über `imapflow` — landet
  als echter, editierbarer Entwurf in der Gmail-UI.
- Zwei neue Dependencies (`nodemailer`, `imapflow`), keine neue Auth-Infrastruktur.
- Credentials in `.env` (bereits gitignored): vermutlich `GMAIL_USER`,
  `GMAIL_APP_PASSWORD` (Namen noch nicht final festgelegt).

### 2. E-Mail-Adresse der Firma: mehrstufige Ermittlung

`Job` hat aktuell **kein** E-Mail-Feld (`scrapers/interface.ts`). Pipeline:

1. Regex + De-Obfuscation auf `description` (`(at)`, `[at]` etc. normalisieren,
   dann `xxx@xxx.xx` matchen). Trifft selten — die meisten Postings verlinken
   nur auf ein Bewerbungsformular, kein Klartext-Mail.
2. **Fallback: firmenabc.at-Lookup** (siehe Testdaten unten) — Firmenname aus
   dem Job in die Suche eingeben, Kandidaten per Namensabgleich filtern,
   `mailto:`-Link von der Firmenprofilseite ziehen.
3. Bleibt beides erfolglos: Feld leer, manuelle Eingabe in der UI (immer
   editierbar, egal ob automatisch befüllt oder nicht).

**Kein** OAuth-Suchdienst, kein Google-Scraping, keine SMTP-Verifikation
(siehe "Verworfene Optionen").

### 3. firmenabc.at-Details

- Braucht Playwright (Bot-Check ist ein generisches "One moment please",
  kein Cloudflare-Turnstile — mit `chromium.launch({headless:true})` in
  ~3s durchlaufen). Playwright ist bereits Dependency, 2 der 5 bestehenden
  Scraper nutzen es schon (`kind: 'browser'` in `ams.ts`, `devjobs-at.ts`).
- Suche: Formular auf `firmenabc.at/`, Feld `#whatSearchField`, Enter drücken
  (die naive `GET /suche/ergebnisse?...sword=...`-URL funktioniert NICHT,
  liefert 0 Treffer — TYPO3-Suche braucht wohl Session-State/cHash aus der
  echten Formular-Interaktion).
- Kandidaten-Links matchen `firmenabc\.at\/[a-z0-9-]+_[A-Za-z0-9]+$`.
- **Wichtig:** NIE den ersten Treffer blind nehmen. Bei mehrdeutigen Namen
  (z.B. "E + E Elektronik") kann Treffer #1 eine komplett falsche Firma sein
  — stiller Fehlversand-Risiko. Fix: Kandidaten-Anzeigename normalisieren
  (lowercase, `GmbH`/`Ges.m.b.H.`/`AG`/`KG`/`Group`/`Engineering`/
  `Beteiligungs` etc. per Regex entfernen, Non-Alphanumerisches strippen)
  und nur akzeptieren wenn normalisierter Kandidat und normalisierter
  Job-Firmenname sich gegenseitig als Substring enthalten. Kein Treffer
  unter den ersten ~15 Kandidaten → wie "keine Kandidaten" behandeln
  (manueller Fallback), NICHT raten.
- Kein robots.txt (liefert dieselbe Bot-Check-Seite), Lookup ist Einzelabfrage
  pro Job bei privater Nutzung (kein Bulk-Scraping/Republishing) — geringes
  rechtliches Risiko, vergleichbar mit den bestehenden 5 Portal-Scrapern.

### 4. Wann läuft der Lookup?

Nicht pro gescraptem Job (Verschwendung, die meisten werden `filtered_out`).
Sondern als Schritt in `scripts/run-anschreiben.ts` — der Job-Filter dort
(`matched`/`uncertain`) ist bereits genau die Menge, für die ein Lookup sich
lohnt. Ergebnis wird auf dem `Job`-Record gecacht, UI muss nicht warten.

### 5. E-Mail-Inhalt

Anschreiben-Dateien (`data/anschreiben/*.md`) enthalten nur Argument-Absätze,
keine Anrede, keine Signatur. Für eine vollständige Mail:

```
Sehr geehrte Damen und Herren,

{Anschreiben-Body aus der .md-Datei}

Mit freundlichen Grüßen
{profile.name}

Lebenslauf: {profile.links.website}
```

- Keine personalisierte Anrede (kein Ansprechpartner-Name aus irgendeiner
  Quelle verfügbar).
- Kein Anhang — Kevin hat einen Link zu einem Repo/einer Seite, auf der der
  Lebenslauf in mehreren Designs herunterladbar ist. Ziel: diesen Link in
  `config/profile.json` → `links.website` eintragen (aktuell noch
  `"TODO: deine Website-URL"`-Platzhalter) und im Signatur-Block referenzieren.
  Kein Attachment-Handling nötig, kein CV-File im Repo.

## Verworfene Optionen (mit Begründung)

- **Google-Suchergebnisse scrapen** — verstößt gegen Googles ToS, blockt
  schnell die eigene Heim-IP auch für normale Google-Suchen (nicht nur für
  den Scraper). Deutlich höheres Risiko als firmenabc.at.
- **Brave Search API** — Signup verlangt Kreditkarte selbst für den
  "kostenlosen" Tarif. Verworfen, bevor überhaupt getestet wurde.
- **SMTP-"Ping" (RCPT TO ohne DATA) zur Adressverifikation** — empirisch
  getestet: TCP-Connect zu Port 25 (z.B. `dynell-at.mail.protection.outlook.com`)
  gelingt, aber kein SMTP-Banner kommt zurück (Timeout) — Port 25 ist
  gefiltert. Zusätzlich: viele Mailserver laufen im Catch-All-Modus und
  antworten immer mit 250 OK, unabhängig davon ob die Adresse existiert.
  Fazit: unzuverlässig und technisch nicht nutzbar von hier aus. Stattdessen:
  der bestehende `reviewed`-Status in der Job-Pipeline (Mensch schaut drüber
  bevor `drafted`/`sent`) ist die Verifikation.
- **Portal-Bewerbungsformulare automatisieren** (LinkedIn Easy Apply, AMS,
  Personio/Workday etc.) — komplett anderes, viel größeres Feature.
  Unterschiedliches Formularschema pro Portal, Login-Wände, CAPTCHAs,
  echtes ToS-/Sperr-Risiko. Explizit außerhalb des Scopes dieser Gmail-Anbindung.
  Für Jobs ohne auffindbare E-Mail bleibt es bei manueller Bewerbung über den
  gespeicherten `url`-Link.
- **firmenabc.at-eigenes Impressum / karriere.at-Firmenprofil als Quelle
  für die Firmen-Website** — verworfen, weil karriere.at auf der Detailseite
  keinen externen Link zur echten Firmen-Website hat (nur einen internen
  `/f/{slug}`-Profil-Link innerhalb von karriere.at selbst). Kein
  verlässlicher Weg, von dort auf die echte Domain zu kommen.

### 6. Betreffzeile

Fixes Template, kein LLM-Call: `Bewerbung als {title} bei {company}`.

### 7. Status-Gate für Draft/Send-Buttons

`reviewed` ist im Code aktuell nur definiert, wird aber nirgends automatisch
gesetzt — reine manuelle Checkbox über das bestehende Status-Dropdown.
CLAUDE.md dokumentiert die Pipeline explizit als
`generated → reviewed → drafted → sent` mit "human-in-the-loop before
anything goes out". Entscheidung: Draft-/Send-Buttons erscheinen auf der
Job-Seite **erst wenn Status = `reviewed`** (manuell gesetzt). Das erzwingt
einen expliziten "ich hab's gelesen"-Schritt bevor irgendwas Richtung Gmail
geht.

### 8. E-Mail-Vorschau + Bestätigung vor Versand

Job-Seite zeigt (ab Status `reviewed`) einen permanenten
"E-Mail-Vorschau"-Block (To/Betreff/Body, gleicher `<pre>`-Stil wie
Beschreibung/Anschreiben heute schon). Der Inhalt ist damit vor dem Klick
sichtbar. "Entwurf erzeugen" braucht keine Bestätigung (Entwurf ist in Gmail
jederzeit löschbar/editierbar). "Direkt senden" bekommt einen einfachen
`confirm()`-Dialog ("Wirklich an {email} senden?") als letzte
Fehlklick-Bremse — keine zweite Vorschau-Seite, die Vorschau ist ja schon
auf der Seite sichtbar.

### 9. Status-Übergänge nach Aktion

"Entwurf erzeugen" → Status wird auf `drafted` gesetzt.
"Direkt senden" → Status wird auf `sent` gesetzt (Endzustand).

### 10. Build-Reihenfolge

Beides (Draft-Erzeugung via IMAP APPEND, Direktversand via SMTP) in einem
Zug bauen, nicht gestaffelt — die komponierte Mail (To/Betreff/Body) ist für
beide identisch, nur der Transport unterscheidet sich
(`imapflow.append()` vs. `nodemailer.sendMail()`). Beide hängen ohnehin am
selben `reviewed`-Gate und demselben Confirm-Dialog fürs Senden, kein
Sicherheitsgewinn durchs Staffeln.

## Offene Punkte (noch nicht entschieden)

- Exakter Feldname für die E-Mail-Adresse auf `Job` (z.B. `email?: string | null`)
  und ob ein `emailSource`-Feld (description/firmenabc/manual) sinnvoll ist
  oder unnötiges Tracking (YAGNI-Verdacht) — Implementierungsdetail, keine
  Grundsatzentscheidung mehr.
- Finale `.env`-Variablennamen für die Gmail-Credentials (Vorschlag:
  `GMAIL_USER`, `GMAIL_APP_PASSWORD`).
- `config/profile.json` → `links.website` muss noch mit dem echten
  Lebenslauf-Link befüllt werden (aktuell TODO-Platzhalter) — das ist ein
  Fakt, den nur Kevin liefern kann, kein technisches Offen-Punkt.

## Testdaten — firmenabc.at-Lookup, echte Jobs aus `data/jobs/`

Unbiased Stichprobe, 15 Firmen aus den echten gescrapten Jobs (nicht
handverlesen). Zwei Testläufe: erst "ersten Treffer nehmen" (naiv, unsicher),
dann mit Namensabgleich (Fix).

### Lauf 1 — naiv, erster Treffer

| Firma | Kandidaten | Ergebnis |
|---|---|---|
| TANNPAPIER GmbH | 1 | ✅ info@tanngroup.com |
| Dynatrace Austria GmbH | 1 | ✅ office.linz@dynatrace.com |
| TGW Logistics | 1 | ✅ tgw@tgw-group.com |
| Dynell GmbH | 2 | ✅ office@dynell.at |
| BMW Group | 0 | ⚪ kein Treffer |
| VectaCore | 3 | ✅ office@vectacore.com |
| efinio IT & Engineering | 0 | ⚪ kein Treffer (`&` bricht vermutlich die Query) |
| Wacker Neuson | 16 | ✅ office@wackerneuson.com |
| CELUM GmbH | 3 | ✅ office@celum.com |
| EREMA Group | 1 | ✅ contact@erema-group.com |
| World-Direct eBusiness solutions GmbH | 0 | ⚪ kein Treffer |
| eurofunk Kappacher GmbH | 5 | ✅ office@eurofunk.com |
| Dynatrace GmbH | 1 | ✅ office.linz@dynatrace.com |
| E + E Elektronik Ges.m.b.H. | 50 | ❌ **office@handshake.at — falsche Firma!** |
| E+E Elektronik Ges.m.b.H | 0 | ⚪ kein Treffer |

11/15 (73%) fanden irgendeine Mail — aber 1 davon war eine **falsche Firma**
(stiller Fehlversand-Fall). Das hat den Namensabgleich-Fix ausgelöst.

### Lauf 2 — mit Namensabgleich (finaler Ansatz)

| Firma | Gewählter Kandidat | Ergebnis |
|---|---|---|
| TANNPAPIER GmbH | TANNPAPIER GmbH | ✅ info@tanngroup.com |
| Dynatrace Austria GmbH | Dynatrace Austria GmbH | ✅ office.linz@dynatrace.com |
| TGW Logistics | TGW Logistics GmbH | ✅ tgw@tgw-group.com |
| Dynell GmbH | Dynell GmbH | ✅ office@dynell.at |
| BMW Group | — | ⚪ kein Kandidat, manueller Fallback |
| VectaCore | VectaCore Engineering GmbH | ✅ office@vectacore.com |
| efinio IT & Engineering | — | ⚪ kein Kandidat, manueller Fallback |
| Wacker Neuson | Wacker Neuson Beteiligungs GmbH | ✅ office@wackerneuson.com |
| CELUM GmbH | celum gmbh | ✅ office@celum.com |
| EREMA Group | EREMA Group GmbH | ✅ contact@erema-group.com |
| World-Direct eBusiness solutions GmbH | — | ⚪ kein Kandidat, manueller Fallback |
| eurofunk Kappacher GmbH | eurofunk Kappacher GmbH | ✅ office@eurofunk.com |
| Dynatrace GmbH | Dynatrace Austria GmbH | ✅ office.linz@dynatrace.com |
| E + E Elektronik Ges.m.b.H. | — | ⚪ **kein sicherer Match** (50 Kandidaten, keiner passt) — vorher fälschlich `handshake.at` |
| E+E Elektronik Ges.m.b.H | — | ⚪ kein Kandidat, manueller Fallback |

**Ergebnis: 10/15 (67%) automatisch korrekt, 5/15 (33%) sauberer manueller
Fallback, 0% falsche Treffer.** Der E+E-Fall, der vorher die falsche Firma
lieferte, wird jetzt korrekt als "kein Match" erkannt statt zu raten.

### Normalisierungs-/Matching-Logik (verifiziert, wiederverwendbar)

```js
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/ges\.?\s*m\.?\s*b\.?\s*h\.?/g, 'gmbh')
    .replace(/\b(gmbh|ag|kg|e\.?u\.?|co|group|holding|beteiligungs|engineering)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isMatch(scraped, candidate) {
  const a = normalize(scraped);
  const b = normalize(candidate);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}
```

Suchablauf pro Firma: Formular auf `firmenabc.at/` ausfüllen (`#whatSearchField`
+ Enter), bis zu 15 eindeutige Kandidaten-Links sammeln
(`firmenabc\.at\/[a-z0-9-]+_[A-Za-z0-9]+$`), ersten Kandidaten nehmen für den
`isMatch()` true liefert, dessen Profilseite laden, `a[href^="mailto:"]`
auslesen.

## Umsetzungs-Checkliste

Vorbedingung: `config/profile.json` → `links.website` mit echtem
Lebenslauf-Link befüllen (aktuell TODO-Platzhalter).

### 0. Setup

- [ ] Gmail App-Passwort erzeugen (`myaccount.google.com/apppasswords`,
      braucht 2-Step-Verification — ist bei Kevin schon an)
- [ ] `.env` anlegen (bisher nicht vorhanden, aber schon gitignored):
      `GMAIL_USER=...`, `GMAIL_APP_PASSWORD=...`
- [ ] `npm install nodemailer imapflow` (+ `npm install -D @types/nodemailer`,
      `imapflow` hat eigene Types)
- [ ] `config/profile.json` → `links.website` mit echtem CV-Link befüllen

### 1. Job-Schema

- [ ] `scrapers/interface.ts`: `Job` um `email?: string | null` erweitern
- [ ] Optional: `emailSource?: 'description' | 'firmenabc' | 'manual'` —
      nur wenn beim Bauen ein echter Bedarf auftaucht, sonst weglassen (YAGNI)
- [ ] `storage/json-store.ts` / `storage/index.ts` prüfen ob `update()` das
      neue Feld automatisch mitschreibt (sollte es, da generisches
      `Partial<Job>`-Patch) — kurz verifizieren, kein Umbau erwartet

### 2. E-Mail-Ermittlung

- [ ] Neues Modul, z.B. `lib/find-email.ts`:
  - [ ] `extractFromDescription(description: string): string | null` —
        De-Obfuscation (`(at)`, `[at]`, `AT`, `(dot)` etc. normalisieren)
        + Regex `xxx@xxx.xx`
  - [ ] `normalize(name: string): string` — Legal-Form-Suffixe strippen
        (siehe verifizierte Funktion im Abschnitt "Testdaten" oben, 1:1
        übernehmen)
  - [ ] `isMatch(scraped: string, candidate: string): boolean` — ebenfalls
        1:1 aus den Testdaten übernehmen
  - [ ] `findViaFirmenabc(company: string): Promise<string | null>` —
        Playwright-Flow: `firmenabc.at/` öffnen, Cookie-Banner wegklicken,
        `#whatSearchField` befüllen + Enter, bis zu 15 eindeutige
        Kandidaten-Links sammeln, ersten `isMatch`-Treffer nehmen, Profilseite
        laden, `a[href^="mailto:"]` auslesen
  - [ ] Ein **einziger** Playwright-Browser pro Lauf (nicht pro Job neu
        starten) — Batch übergibt eine offene `Page`/`Browser`-Instanz durch
  - [ ] `findEmail(job): Promise<string | null>` — orchestriert:
        description-Regex → firmenabc-Fallback → `null`
- [ ] Unit-Test für `normalize`/`isMatch` mit den bekannten Fällen aus den
      Testdaten (inkl. des E+E/Handshake-Falls als Negativ-Test — muss
      `false`/`null` liefern, nicht raten)

### 3. Integration in `run-anschreiben.ts`

- [ ] Nach erfolgreicher Anschreiben-Generierung: falls `job.email` noch
      leer, `findEmail(job)` aufrufen und Ergebnis per `storage.update()`
      persistieren
- [ ] Playwright-Browser einmal am Anfang des Laufs starten, am Ende
      schließen (nicht pro Job)
- [ ] Bestehenden `sleep(1000)`-Rhythmus zwischen Jobs beibehalten,
      firmenabc-Lookup zählt als Teil der Job-Verarbeitungszeit

### 4. Mail-Versand-Modul

- [ ] `mail/gmail.ts` (bisher nur `.gitkeep` im Ordner):
  - [ ] `composeEmail(job, profile): { to, subject, text }` — Subject-Template
        `Bewerbung als {title} bei {company}`, Body = Anschreiben-Datei
        einlesen + Anrede/Signatur-Wrapper (siehe Template oben) +
        `profile.links.website`
  - [ ] `createDraft(email): Promise<void>` — `imapflow`, `APPEND` auf
        `[Gmail]/Drafts`, rohe MIME-Message bauen (Header + Body)
  - [ ] `sendMail(email): Promise<void>` — `nodemailer`, `service: 'gmail'`
        Preset, `auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }`
  - [ ] Beide Funktionen werfen bei Fehler (kein Silent-Fail) — Aufrufer
        entscheidet über Status-Update
- [ ] `data/mail-log.md`: `appendLog(job, action: 'drafted' | 'sent')` —
      gleiches Pattern wie `ANSCHREIBEN_LOG_PATH` in `lib/anschreiben.ts`

### 5. UI-Server (`scripts/ui-server.ts`)

- [ ] E-Mail-Feld auf der Job-Detailseite: editierbares `<input>`
      (vorbefüllt aus `job.email`, falls vorhanden), eigenes kleines
      `<form>` mit POST-Route zum Speichern (analog zum bestehenden
      Status-Formular)
- [ ] E-Mail-Vorschau-Block (`<pre>`, gleicher Stil wie Beschreibung/
      Anschreiben): rendert `composeEmail()`-Ergebnis live, nur sichtbar
      wenn `job.status === 'reviewed'` (oder später in der Kette) **und**
      `job.email` gesetzt ist
- [ ] Button "Gmail-Entwurf erstellen": POST-Route, ruft `createDraft()`,
      bei Erfolg Status → `drafted` + Log-Eintrag, bei Fehler Fehlermeldung
      anzeigen und Status **nicht** ändern
- [ ] Button "Direkt senden": clientseitiger `confirm("Wirklich an {email}
      senden?")` vor dem Submit, POST-Route ruft `sendMail()`, bei Erfolg
      Status → `sent` + Log-Eintrag, bei Fehler Fehlermeldung anzeigen und
      Status **nicht** ändern
- [ ] Beide Buttons nur rendern wenn Status `reviewed` ist (nicht bei
      `generated`, `drafted` oder `sent` — verhindert Doppel-Versand über die
      UI; ein zweiter Klick nach erfolgtem Senden zeigt keinen Button mehr,
      weil Status inzwischen `sent` ist)
- [ ] Fehlender `job.email` beim Erreichen von `reviewed`: Hinweistext
      "Keine E-Mail gefunden — über Portal bewerben oder manuell eintragen"
      statt der Buttons

### 6. Doku

- [ ] `.env.example` (falls noch nicht vorhanden) um `GMAIL_USER` /
      `GMAIL_APP_PASSWORD` ergänzen
- [ ] `README.md` / `README.en.md`: kurzer Abschnitt zur Gmail-Anbindung
      (Setup des App-Passworts, was `--data=`-Flags o.ä. betrifft falls
      relevant)
- [ ] `CLAUDE.md`: Pipeline-Beschreibung um den neuen Mail-Schritt ergänzen
      falls sich die Job-Status-Lifecycle-Beschreibung dadurch ändert

### 7. Verifikation vor "fertig"

- [ ] `npm run typecheck` sauber
- [ ] `npm test` sauber (inkl. neuer Tests für `normalize`/`isMatch`)
- [ ] Manueller End-to-End-Test mit **einem echten Job**: Anschreiben
      generieren → E-Mail wird gefunden/eingetragen → Status auf `reviewed`
      → Entwurf erstellen → Entwurf taucht in Gmail auf und ist inhaltlich
      korrekt → (separat) Testversand an die eigene Adresse prüfen bevor der
      erste echte Versand an eine Firma passiert
