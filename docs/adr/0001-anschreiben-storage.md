# ADR-0001: Das Anschreiben bleibt eine eigene Datei, hinter der Storage-Schnittstelle

Status: Angenommen — 2026-09-13

## Kontext

Ein Job (`data/jobs/{id}.json`) und sein Anschreiben (`data/anschreiben/{slug}_{id8}.md`)
sind zwei getrennte Dateien. Das Anschreiben ist langer, von Hand editierbarer Fließtext,
der im UI direkt in der Textarea bearbeitet wird — kein strukturiertes Feld.

Historisch leiteten vier Stellen (lib/anschreiben.ts, die alte scripts/ui-server.ts zweimal,
mail/gmail.ts) den `.md`-Pfad selbst aus `jobBasename(job)` ab — der trug **Titel, Firma,
Datum und id-Präfix**. Das Datum ist aber kein Teil der Identität: ein Re-Scrape (neues
`postedAt`) oder ein Duplikat-Merge (`keep.scrapedAt` wird das des ältesten Zwillings,
siehe `planMerge`) änderte den Dateinamen, und der bereits geschriebene Brief wurde für
seinen eigenen Job unsichtbar. Am 2026-09-04 betraf das 46 von 101 Dateien. Behoben durch
Lookup ausschließlich über das id-Präfix (`lib/anschreiben-datei.ts`).

## Entscheidung

1. Das Anschreiben bleibt **bewusst** eine eigene `.md`-Datei — nicht Teil des Job-JSON.
   Ein großer Freitext-Blob im Record würde die Job-Datei aufblähen und strukturierte
   Felder mit editierbarem Text vermischen.
2. Der Zugriff läuft über die **Storage-Schnittstelle** (`getBrief` / `saveBrief`), nicht
   mehr über eine von jedem Aufrufer nachgebaute Slug-/id-Suffix-Konvention und direkten
   Dateisystem-Zugriff an `JsonStore` vorbei. Die `.md`-Datei und der id-Präfix-Lookup
   bleiben die Implementierung dahinter.

## Konsequenzen

- Eine Stelle besitzt das Lesen/Schreiben des Briefs; die id-Präfix-Regel lebt weiter in
  `lib/anschreiben-datei.ts` als Implementierung von `JsonStore`.
- Der Split (`.md` neben JSON) bleibt — dieses ADR hält fest, dass er gewollt ist, damit
  ein künftiger Architektur-Durchlauf ihn nicht als Zufall behandelt.
- Verbleibende Direkt-Zugriffe (mail/gmail composeEmail, lib/anschreiben saveAnschreiben,
  der Brief-Übertrag beim Duplikat-Merge) wandern schrittweise auf `getBrief`/`saveBrief`;
  sie sind heute noch nicht migriert.
