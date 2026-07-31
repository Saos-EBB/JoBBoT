# HANDOFF — Bewerbungs-Kalender (Prototyp)

Stand: 2026-07-31. Branch `tryout`, HEAD `54ffd89`, **nicht gepusht, nicht nach `main` gemerged**.
Auftrag kam als workmode-Auftrag ("CC-Auftrag: jobbot — Bewerbungs-Kalender (Prototyp)")
direkt im Chat, ist nirgends sonst als Datei hinterlegt — Kernpunkte deshalb hier
kompakt zusammengefasst, damit eine neue Session ohne Chat-Historie weiterarbeiten kann.

## Ziel des Features

Kalender-Ansicht in der UI, die zeigt, wann Bewerbungen rausgingen (`sentAt`) und
wann Antworten zurückkamen (`replyReceivedAt`) — Tag = Quadrat, Woche = Zeile,
Monat = Block, in derselben Quadrat-Optik wie das bestehende Lade-Grid (eigene
Ansicht, gleiche Styling-Tokens).

## Was in dieser Session gebaut wurde (alle Steps abgeschlossen)

Reihenfolge und Commits, git-Hashes sind real und nachschlagbar (`git show <hash>`):

| Commit | Was |
|---|---|
| `5e413dc` | Vorab: uncommittete Alt-Änderungen reingenommen (Lade-Grid: sicher/unsicher/raus → match/offstack/brutal-Terminologie, klickbare Quadrate) |
| `516f588` | Vorab: `.gitignore`-Lücke gefixt — `data/jobs/*.json` erfasste die Fit-Unterordner (`matched/offstack/brutal`) nicht, 134 lokale Job-Dateien tauchten als untracked auf |
| — | **Step 1 (Recon):** kein Sende-Zeitstempel vorhanden, nur Status-String `gesendet`. `updatedAt` als Ersatz unsicher (wird bei jedem `storage.update()` überschrieben, auch bei Reply-Match). `replyReceivedAt` bestätigt (ISO-Datum, `scrapers/interface.ts:40`). Lokaler Altbestand: **0** Jobs mit Status `gesendet`/`postausgang` — Kalender ist initial leer. |
| `e5d959d` | **Step 2:** neues `Job.sentAt` (ISO-Datum), gesetzt an beiden Sendestellen in `scripts/ui-server.ts` (`/api/jobs/:id/send`, `/job/:id/send`) |
| `b55e8d5` | **Step 3:** `GET /api/calendar` — read-only, reduziert Jobs auf flache Ereignisliste `{date, type: 'sent'\|'reply', jobId, title, company}` |
| `54ffd89` | **Steps 4+5 (zusammengefasst):** Sidebar-Tab „Kalender" (`ui/app.tsx`), Monatsblöcke neuester zuerst, 7-Spalten-Wochenraster, Farbcodierung (blau=gesendet, grün=Antwort, diagonal=beides), eigenes Hover-Element, Klick-Popup mit Tageseinträgen + Sprung zur Job-Detailansicht, Pfeiltasten (←/→ Tag mit Aktivität, ↑/↓ scrollen, Esc) |

Details, Begründungen und explizite "Nicht gebaut"-Punkte pro Step stehen in
`docs/build-log.md` (oben, Einträge vom 2026-07-31) — nicht hier dupliziert.

**Verifiziert:** `npm run typecheck` sauber, `npm test` 250/250 grün, `npm run build:ui`
erfolgreich. Funktional per Playwright gegen echte (temporär geseedete, danach
zurückgesetzte) Jobdaten getestet: Diagonal-Split, Hover-Card, Monatsreihenfolge,
Pfeiltasten-Sprung über leere Tage, Klick-Jump zur Job-Detailansicht.

## Bekannte Einschränkung (kein Blocker)

Die Antwort-Seite des Kalenders ist nur so vollständig wie das Gmail-Matching in
`/api/mail/replies/fetch` — läuft aktuell über E-Mail+Betreff-Abgleich statt
Message-ID und trifft laut Auftrag nur einen Teil der echten Antworten. Wenig
grüne Quadrate sind also erwartbar, kein Bug. Message-ID-Matching ist ein
separater, noch nicht angefangener Auftrag.

## Offene Punkte für die nächste Session

- **Nichts technisch Unfertiges** — alle 5 geplanten Steps sind committed und
  verifiziert. Der Auftrag war explizit ein "Prototyp", noch keine Freigabe zum
  Mergen nach `main` erteilt.
- Lokal aktuell keine `gesendet`-Jobs → Kalender zeigt "Noch keine Aktivität".
  Erst nach dem nächsten echten Versand über die UI gibt es etwas zu sehen —
  ggf. beim nächsten Mal direkt mit einer echten Bewerbung durchtesten, statt
  nur mit den (schon wieder zurückgesetzten) Playwright-Testdaten.
- Kein Trailing-Padding der letzten Kalenderwoche, kein rollierendes
  Zeitfenster/Jahres-Navigation, keine Statusfilter/Suche im Kalender —
  bewusst YAGNI, nur bei explizitem Bedarf nachziehen.
- Entscheidung offen, ob/wann `tryout` nach `main` gemerged wird.

## Suggested skills für den Wiedereinstieg

- `workmode` — falls im selben Stil weitergearbeitet werden soll (YAGNI-Gate,
  ein Commit pro Step, docs/ im selben Commit).
- `run` — um die UI schnell zu starten und den Kalender-Tab zu zeigen
  (`npm run build:ui && npm run ui`, danach Sidebar → „Kalender").

## Wie ansehen

```
npm run build:ui && npm run ui
```
Sidebar → „Kalender" öffnen.
