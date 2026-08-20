# Wohin die Warnung des Adapters geht

Type: grilling
Status: resolved

## Question

Entschieden ist (siehe *Schema pro Portal*): Der Adapter warnt beim Lesen, statt eine
ungültige Anfrage still zu überspringen. Offen ist, **wo diese Warnung landet**.

Die beiden Wege sehen verschieden aus:

- **CLI** (`npm run scrape`): eine Zeile auf stdout reicht, das Muster gibt es schon
  (`run-scrape.ts` loggt bereits „[name] deaktiviert — übersprungen").
- **UI**: der Lauf meldet über SSE ans Lade-Grid und füllt am Ende
  `result.perSource[].error`. Eine übersprungene Anfrage ist aber **kein** Fehlschlag der
  Quelle — die anderen sechs Anfragen laufen ja. Es gibt heute keinen Kanal für „lief
  durch, aber unvollständig".

Zu entscheiden:

- **Braucht die UI den Hinweis überhaupt**, oder reicht es, dass das Formular ungültige
  Eingaben von vornherein verhindert? Gegenargument: Handedits an der Datei und Altbestände
  umgehen das Formular.
- **Wenn ja, welcher Kanal?** Ein dritter Zustand neben ok/Fehler in `perSource`? Eine
  eigene Warnliste im Ergebnis? Ein Toast? Ein Quadrat im Lade-Grid?
- **Und zeigt die Einstellungsseite selbst es an** — also beim Öffnen: „Anfrage 3 bei
  karriere.at hat einen unbekannten Schlüssel"? Das wäre die Stelle, an der man es auch
  reparieren kann.

## Answer

**Zwei Orte, keiner davon im Scrape-Lauf.**

1. **CLI:** eine Zeile auf stdout, nach dem vorhandenen Muster („[name] deaktiviert —
   übersprungen" in `run-scrape.ts`). Mit Portalname, Position der Anfrage und erwartetem
   Schlüssel.
2. **Einstellungsseite:** ein Hinweis oben im Suchgebiet-Abschnitt, sobald die Seite eine
   Anfrage findet, die kein Adapter akzeptieren würde — mit „Reparieren"- und
   „Entfernen"-Knopf.

Der zweite Ort ist der wichtige: Die Warnung erscheint dort, wo man sie **beheben** kann,
statt dort, wo sie einen beim Arbeiten unterbricht. Die Seite prüft ohnehin gegen das
Schema, sie weiß es also ohne zusätzliche Verkabelung.

**Der Scrape-Lauf bekommt keinen neuen Zustand.** Ein dritter Wert neben ok und Fehler in
`perSource` hätte sich durch Runner, SSE-Broadcast und Lade-Grid gezogen — für einen
Zustand, der nach Einführung der Seite fast nur noch bei Handedits entsteht. Ein Lauf
meldet weiterhin „gelaufen" oder „fehlgeschlagen".

**Konsequenz, die man kennen sollte:** Wer eine Datei von Hand kaputtmacht und *nur* die
Scrape-Ansicht benutzt, erfährt es weiterhin nicht — er erfährt es beim nächsten Öffnen der
Einstellungsseite. Das ist der bewusst in Kauf genommene Rest.
