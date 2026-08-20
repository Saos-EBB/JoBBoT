# Zwei Slug-Funktionen — eine daraus machen?

Type: grilling
Status: resolved

## Question

Die beiden Slug-Portale übersetzen dasselbe Suchwort verschieden:

- `scrapers/karriere-at.ts:63` — lokale Funktion, `s.toLowerCase().replace(/\s+/g, '-')`.
  Ersetzt nur Leerzeichen. **Umlaute bleiben stehen**, Satzzeichen auch.
- `scrapers/jobs-at.ts:121` — `slugify()` aus `lib/slugify.ts`. Macht `ä→ae`, wirft alles
  Nicht-Alphanumerische raus, **kürzt bei 40 Zeichen**.

„Bürokauffrau (m/w/d)" wird bei karriere.at zu `bürokauffrau-(m/w/d)`, bei jobs.at zu
`buerokauffrau-m-w-d`. Mindestens eine der beiden ist falsch, und niemand weiß welche —
das steht nirgends geprüft.

Das wird jetzt relevant, weil `querySchema` (siehe *Schema pro Portal*) einen
Format-Bezeichner pro Feld tragen soll. Zwei Slug-Varianten heißen zwei Bezeichner, und die
Seite müsste dem Nutzer zwei verschiedene Vorschauen zeigen — für etwas, das aus seiner
Sicht dasselbe ist.

Zu entscheiden:

- **Sind es wirklich zwei, oder ist eine davon schlicht ein Versehen?** Vorab zu klären:
  Was akzeptiert karriere.at tatsächlich in der URL — Umlaute oder nicht? Das ist eine
  Faktenfrage, nachprüfbar an den Fixtures unter `test/fixtures/` oder mit einem einzelnen
  Abruf.
- **Wenn eine reicht:** `lib/slugify.ts` für beide, oder eine dritte, gemeinsame
  Such-Slug-Funktion? `slugify()` kürzt bei 40 Zeichen — für Dateinamen sinnvoll, für eine
  Such-URL fragwürdig.
- **Wenn es zwei bleiben müssen:** Wie heißen die beiden Formate im `querySchema`, und
  zeigt die Seite den Unterschied oder verschweigt sie ihn?

## Answer

**Zuerst die Faktenfrage, die das Ticket aufwirft — sie ist beantwortet.** Zwei Abrufe
gegen die echte Such-URL:

```
/jobs/bürokauffrau    → 200, Titel "Bürokauffrau Jobs | aktuell 630+ offen"
/jobs/buerokauffrau   → 200, Titel "Buerokauffrau Jobs | aktuell 630+ offen"
```

Identische Trefferzahl. **karriere.at normalisiert den Slug selbst und ist gegenüber
Umlauten gleichgültig.** Der Unterschied zwischen den beiden Funktionen ist also
folgenlos — die Sorge des Tickets war unbegründet.

**Trotzdem wird vereinheitlicht, aus einem anderen Grund.** Übrig bleibt ein echter
Unterschied: `lib/slugify.ts` **kürzt bei 40 Zeichen**. Das ist für Dateinamen richtig und
für Suchbegriffe falsch — „junior fullstack javascript typescript entwickler" würde still
abgeschnitten.

Also: eine neue `searchSlug()` in `lib/slugify.ts` — wie `slugify()`, aber ohne die
Längengrenze. Beide Portale benutzen sie. `slugify()` bleibt unverändert für `jobBasename()`.

Der eigentliche Gewinn liegt im Schema: **ein** Formatbezeichner `'slug'` im `querySchema`
statt zweier, die aus Nutzersicht dasselbe bedeuten.
