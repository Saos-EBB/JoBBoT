# Schema pro Portal — wo lebt es, wie sieht es aus

Type: grilling
Status: resolved

## Question

`SourceQuery` ist heute `Record<string, string>` (`lib/sources.ts`) — jede Anfrage darf
jeden Schlüssel tragen. Tatsächlich benutzen die fünf Portale vier verschiedene
Schlüsselsätze, und `keyword` hat je nach Portal zwei unvereinbare Formate (URL-Slug bei
karriere.at/jobs.at, natürliche Sprache bei linkedin/ams).

Ein Formular kann ohne ein explizites Schema nicht gebaut werden: es muss wissen, welche
Felder ein Portal hat, welches davon Pflicht ist und welches Format gilt.

Zu entscheiden:

- **Wo lebt das Schema?** Neue Datei (`config/source-schema.json`), Konstante im Code, oder
  am jeweiligen Adapter (`scrapers/*.ts`) — die kennen ihr Format ohnehin.
- **Wird `SourceQuery` typisiert**, oder bleibt es `Record<string,string>` und das Schema
  liegt nur daneben?
- **Wer erzwingt das Format** — nur die UI, oder auch die Scraper beim Lesen?
- **Was passiert mit einem Portal ohne Schema-Eintrag?** Formular ausblenden, generisch
  behandeln, oder Fehler?

Dieses Ticket ist die Wurzel: Formularaufbau, Speicher-Endpunkt und der Roh-JSON-Notausgang
hängen alle daran.

## Answer

**Das Schema lebt am Adapter.** `ScraperAdapter` bekommt ein Pflichtfeld
`querySchema: QueryField[]`. Pflicht heißt: TypeScript erzwingt, dass jeder der fünf
Adapter es deklariert — ein Portal ohne Schema kann gar nicht erst entstehen. Begründung:
der Adapter ist der Einzige, der sein Format wirklich kennt (karriere.at slugifiziert
selbst, LinkedIn encodiert), jede andere Ablage wäre eine zweite Wahrheit, die stumm
auseinanderläuft.

**Die Registry ist die Wahrheit über die Portalliste.** `sources.json` konfiguriert nur,
was es im Code gibt; sie kann kein Portal erfinden. Konkret:

- `/api/scrape/sources` liefert künftig aus der Registry statt aus `loadSources()`.
- Ein Eintrag in `sources.json` ohne Adapter wird als verwaist **angezeigt**, aber nicht als
  auswählbares Portal angeboten.
- Das behebt nebenbei zwei bestehende Fehler: den Widerspruch zwischen CLI
  (`run-scrape.ts:20` geht von der Registry aus) und UI (`ui-server.ts:359` geht von der
  Datei aus), sowie den ungeprüften Zugriff `registry[name].kind` in
  `lib/scrape-runner.ts:76`, der bei einem unbekannten Namen eine nichtssagende abgelehnte
  Promise erzeugt.

**`SourceQuery` wird typisiert.** Weil der Code die Portalliste festlegt, gibt es einen
festen Satz Felder je Portal, gegen den sich typisieren lässt — `Record<string, string>`
entfällt.

**Durchsetzung ist zweistufig.** Die UI lässt nichts Ungültiges durch. Zusätzlich meldet der
Adapter beim Lesen, wenn er eine Anfrage überspringt: aus dem heutigen stillen
`const keyword = query.keyword ?? ''; if (!keyword) continue;` wird eine Warnung mit
Portalname, Position und erwartetem Schlüssel. Der Lauf bricht nicht ab. Das schützt auch
`npm run scrape` und Handedits an der Datei — den Weg, auf dem die heutige `sources.json`
überhaupt entstanden ist.

### Korrektur einer Annahme aus dem Abstecken

Beim Charten stand als Fakt in den Notes, ein falsch formatiertes Suchwort führe still zu
null Treffern (`"junior developer"` bei karriere.at). **Das stimmt nicht.** Beide
Slug-Portale normalisieren selbst: `scrapers/karriere-at.ts:63`
(`s.toLowerCase().replace(/\s+/g, '-')`) und `scrapers/jobs-at.ts:121` (`slugify()` aus
`lib/slugify.ts`). Die Notes der Karte sind entsprechend berichtigt.

Was beim Nachlesen stattdessen herauskam:

1. **Zwei verschiedene Slug-Funktionen.** karriere.at ersetzt nur Leerzeichen und lässt
   Umlaute stehen; `lib/slugify.ts` macht `ä→ae`, wirft Nicht-Alphanumerisches weg und
   kürzt bei 40 Zeichen. Dasselbe Suchwort wird je Portal verschieden übersetzt.
   → eigenes Ticket.
2. **Die Falle läuft andersherum.** LinkedIn und AMS `encodeURIComponent` den Rohstring;
   ein dort eingetragener Slug sucht wörtlich nach Bindestrichen. Die heutige Datei tappt
   nicht hinein, ein einheitlich aussehendes Formular lädt aber dazu ein — das ist die
   Formatregel, die `querySchema` tatsächlich tragen muss.
3. **Das eigentliche stille Versagen ist der Schlüssel, nicht der Wert.** `keywords` statt
   `keyword` wirft die Anfrage kommentarlos weg. Dagegen schützt das Schema.
