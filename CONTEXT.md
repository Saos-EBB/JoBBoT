# CONTEXT — Domänensprache

Die ubiquitäre Sprache dieses Projekts. Begriffe hier gelten für Code, Kommentare und
Commits. Architektur-Entscheidungen liegen in `docs/adr/`.

## Begriffe

- **Job** — eine gescrapte Stellenanzeige plus ihr Bewerbungs-Zustand. Ein
  `{id}.json` pro Job (`storage/json-store.ts`). `id` = 16-Hex-SHA-256 aus
  normalisiertem `[title, company]`.

- **Status** — die Bewerbungs-Zustandsmaschine eines Jobs:
  `new → triaged → generated → freigegeben → postausgang → gesendet`, mit
  `geloescht`, `fehler`, `offline` als Seitenzuständen. Das Filter-Urteil selbst
  lebt NICHT im Status, sondern im Feld **Fit**.

- **Fit** — das Filter-Urteil: `matched` | `offstack` | `brutal`. Eigenständiges,
  manuell überschreibbares Feld; der Filter-Lauf setzt nur den Startwert.

- **Anschreiben** (auch **Brief**) — das generierte Bewerbungsanschreiben. Bewusst
  eine eigene `.md`-Datei neben dem Job-JSON, angesprochen über die Storage-
  Schnittstelle (`getBrief`/`saveBrief`), nicht Teil des Job-Records. Siehe
  [ADR-0001](docs/adr/0001-anschreiben-storage.md). Lookup ausschließlich über das
  id-Präfix, nie über den (Datum-tragenden) Dateinamen.

- **Adapter / Seam** — siehe `.claude/skills/codebase-design`. Portale hängen als
  `ScraperAdapter` an einem Seam; der Mail-Versand an `MailTransport`
  (`mail/transport.ts`); der Ollama-Zugriff an `chat()` (`lib/ollama.ts`).
